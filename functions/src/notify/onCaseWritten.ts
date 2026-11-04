// 事例の書き込みで知らせる（M-02、契約 4.1、6.3）。I が cases を書く → ここ。I はメールを呼ばない。
import { getAuth } from "firebase-admin/auth";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type { GeoStore } from "@hpai/shared/geo";
import { diffDays, jstDateOf } from "@hpai/shared/dates";
import { currentSeason } from "@hpai/shared/season";
import { diffCaseEvents, eventDateOf, planCaseNotices, reviewingCoveredMembers, type Notice, type SentNotice } from "@hpai/shared/notices";
import type { Case, Farm } from "@hpai/shared/types";
import { db } from "../admin";
import { loadGeoStore } from "../geo/loadGeo";
import { APP_URL, GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET } from "../secrets";
import { dispatchNotices, type NotifyDeps } from "./dispatch";
import { sendMail } from "./send";

/** 段階の日付がこれより古い変化は知らせない（日数）。 */
export const MAX_EVENT_AGE_DAYS = 14;

/** Firestore の in の上限。 */
const IN_LIMIT = 30;

/**
 * 同じ県の確認中が開いている間に、すでに確認中の知らせを受け取った会員（Q-m）。「開いている」は cases にある別の確認中の事例（同じ県、同じ季）。
 * 読み込みが失敗したら空にする（続報を黙らせず、送る側に倒す）。同時に書かれた 2 件は互いの記録がまだないので、どちらも送る（多いほうに倒れる）。
 */
async function coveredByOpenReviewing(deps: NotifyDeps, after: Case): Promise<Set<string>> {
  try {
    const open = await deps.db.collection("cases").where("confirmState", "==", "reviewing").where("prefCode", "==", after.prefCode).get();
    const openIds = open.docs.filter((d) => d.id !== after.id && (d.data() as Case).season === after.season).map((d) => d.id);
    if (openIds.length === 0) return new Set();
    const records: SentNotice[] = [];
    for (let k = 0; k < openIds.length; k += IN_LIMIT) {
      const snap = await deps.db.collection("sentNotices").where("subjectId", "in", openIds.slice(k, k + IN_LIMIT)).get();
      for (const d of snap.docs) records.push(d.data() as SentNotice);
    }
    return reviewingCoveredMembers({ openIds: new Set(openIds), records, now: deps.now() });
  } catch (e) {
    console.error("[notify] 開いている確認中を読めないので、確認中の知らせを黙らせずに送ります", { code: typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code).slice(0, 40) : "unknown" });
    return new Set();
  }
}

/**
 * 事例の変化から出る出来事ごとに宛先を決め、まとめて dispatchNotices に渡す。
 * after が null（削除）、再現、今季でない事例、段階の日付が 14 日より前の変化は何もしない。
 * 先に県を読む。prefsToLoad は否定を除くので使わない（否定された事例でも距離を測る）。県の欄とコードがずれていても、形が見つかる県を読む。
 */
export async function handleCaseWrite(deps: NotifyDeps, before: Case | null, after: Case | null, geo: GeoStore): Promise<void> {
  if (after === null) return;
  // 今季の新しい出来事だけ。前季の事例（取り込み、突き合わせ、古い事例の確定）で、今の会員に昔の発生を知らせない。
  const now = deps.now();
  if (after.season !== currentSeason(now)) return;
  const today = jstDateOf(now);
  const events = diffCaseEvents(before, after).filter((e) => {
    const date = eventDateOf(e, after);
    return date === null || diffDays(today, date) <= MAX_EVENT_AGE_DAYS;
  });
  if (events.length === 0) return;

  const prefs = new Set<string>([after.prefCode]);
  if (after.muniCode) prefs.add(after.muniCode.slice(0, 2));
  await geo.ensurePrefs([...prefs]);

  const farms = (await deps.db.collection("farms").get()).docs.map((d) => ({ id: d.id, ...(d.data() as Farm) }));
  const alreadySent = (await deps.db.collection("sentNotices").where("subjectId", "==", after.id).get()).docs.map((d) => d.data() as SentNotice);

  // 確認中は、同じ県の確認中が開いている間は最初の 1 通だけ（Q-m）。確定、区域の知らせなどは減らさない
  const reviewingCovered = events.includes("reviewing") ? await coveredByOpenReviewing(deps, after) : undefined;
  const notices: Notice[] = [];
  for (const event of events) notices.push(...planCaseNotices({ event, caseDoc: after, farms, geo, alreadySent, reviewingCovered }));
  if (notices.length > 0) await dispatchNotices(deps, notices);
}

/** cases/{caseId} の作成、更新、削除。削除（after がない）は無視する。再試行しない（二重送信を避ける。取りこぼしは M-13 の送り直しが拾う）。 */
export const onCaseWritten = onDocumentWritten(
  {
    document: "cases/{caseId}",
    retry: false,
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET],
  },
  async (event) => {
    const read = (snap: { exists: boolean; data(): unknown } | undefined): Case | null =>
      snap?.exists ? { ...(snap.data() as Case), id: event.params.caseId } : null;
    const before = read(event.data?.before);
    const after = read(event.data?.after);
    if (after === null) return;
    const deps: NotifyDeps = {
      db,
      mailer: sendMail,
      emailOf: async (uid) => {
        try {
          return (await getAuth().getUser(uid)).email ?? null;
        } catch {
          return null;
        }
      },
      appUrl: APP_URL.value(),
      unsubscribeSecret: UNSUBSCRIBE_SECRET.value(),
      now: () => new Date(),
    };
    await handleCaseWrite(deps, before, after, await loadGeoStore());
  },
);
