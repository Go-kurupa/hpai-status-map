// 事例の書き込みで知らせる（M-02、契約 4.1、6.3）。I が cases を書く → ここ。I はメールを呼ばない。
import { getAuth } from "firebase-admin/auth";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type { GeoStore } from "@hpai/shared/geo";
import { diffCaseEvents, planCaseNotices, type Notice, type SentNotice } from "@hpai/shared/notices";
import type { Case, Farm } from "@hpai/shared/types";
import { db } from "../admin";
import { loadGeoStore } from "../geo/loadGeo";
import { APP_URL, GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET } from "../secrets";
import { dispatchNotices, type NotifyDeps } from "./dispatch";
import { sendMail } from "./send";

/**
 * 事例の変化から出る出来事ごとに宛先を決め、まとめて dispatchNotices に渡す。
 * after が null（削除）と再現は何もしない。
 * 先に県を読む。prefsToLoad は否定を除くので使わない（否定された事例でも距離を測る）。県の欄とコードがずれていても、形が見つかる県を読む。
 */
export async function handleCaseWrite(deps: NotifyDeps, before: Case | null, after: Case | null, geo: GeoStore): Promise<void> {
  if (after === null) return;
  const events = diffCaseEvents(before, after);
  if (events.length === 0) return;

  const prefs = new Set<string>([after.prefCode]);
  if (after.muniCode) prefs.add(after.muniCode.slice(0, 2));
  await geo.ensurePrefs([...prefs]);

  const farms = (await deps.db.collection("farms").get()).docs.map((d) => ({ id: d.id, ...(d.data() as Farm) }));
  const alreadySent = (await deps.db.collection("sentNotices").where("subjectId", "==", after.id).get()).docs.map((d) => d.data() as SentNotice);

  const notices: Notice[] = [];
  for (const event of events) notices.push(...planCaseNotices({ event, caseDoc: after, farms, geo, alreadySent }));
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
