// 死亡数の書き込みで、死亡率の基準に当たったら同じ農場の会員へすぐ知らせる（M-13、設計書 §6、§8）。
// 計算は computeMortality（Claude を使わない）。診断はしない。入力を直しても、送ったメールは取り消せない。
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { addDays, jstDateOf } from "@hpai/shared/dates";
import { computeMortality, toMortalityDays } from "@hpai/shared/mortality";
import { mortalityNotices } from "@hpai/shared/notices";
import type { DeathRecord, Farm } from "@hpai/shared/types";
import { GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET } from "../secrets";
import { enqueueReview, reviewAlertId } from "../review/queue";
import { codeOf, dispatchNotices, type NotifyDeps } from "./dispatch";
import { liveDeps } from "./liveDeps";

/** 1 農場の、記録の日 1 日あたりの基準の知らせの数（鶏舎の数）。偽の記録や入力の誤りで、共有の Gmail の上限を使い切らせない。 */
export const MAX_HIT_NOTICES_PER_FARM_DAY = 3;

type Db = NotifyDeps["db"];
const counterRef = (db: Db, farmId: string, date: string) => db.collection("farms").doc(farmId).collection("hitCounters").doc(date);
const idsOf = (data: unknown): string[] => ((data as { recordIds?: unknown } | undefined)?.recordIds as string[] | undefined) ?? [];

/**
 * farms/{farmId}/hitCounters/{日付} に、知らせを出す記録の id を MAX_HIT_NOTICES_PER_FARM_DAY 件まで確保する（トランザクション）。
 * reserved: 新しく確保した／held: すでに確保済み（記録の直し）／full: 満杯。サーバーだけが書く（ルールは全拒否のまま）。
 */
export async function reserveHitSlot(db: Db, farmId: string, date: string, recordId: string): Promise<"reserved" | "held" | "full"> {
  const ref = counterRef(db, farmId, date);
  return db.runTransaction(async (tx) => {
    const ids = idsOf((await tx.get(ref)).data());
    if (ids.includes(recordId)) return "held" as const;
    if (ids.length >= MAX_HIT_NOTICES_PER_FARM_DAY) return "full" as const;
    tx.set(ref, { recordIds: [...ids, recordId] });
    return "reserved" as const;
  });
}

/** 確保した枠を返す（送れなかった知らせは枠を使わない）。 */
export async function releaseHitSlot(db: Db, farmId: string, date: string, recordId: string): Promise<void> {
  const ref = counterRef(db, farmId, date);
  await db.runTransaction(async (tx) => {
    const ids = idsOf((await tx.get(ref)).data());
    if (ids.includes(recordId)) tx.set(ref, { recordIds: ids.filter((i) => i !== recordId) });
  });
}

/** 対象期間 21 日（除外の日と記録のない日を飛ばして遡る）のために読む日数。M-07 の最大 120 日。 */
const LOOKBACK_DAYS = 120;

/**
 * 記録 1 件の書き込みで、その鶏舎だけを計算して、基準に当たれば会員全員へすぐ知らせる。
 * - 削除、除外の日、昨日より古い日付、未来の日付、文書 id が date_houseId と合わない記録、農場の鶏舎にない記録では何もしない。
 * - 1 農場の 1 日の基準の知らせ（送れたもの）は MAX_HIT_NOTICES_PER_FARM_DAY 件まで。上限で止めた分は capped で残し、運営者の箱に出す。
 * - 当たるのは evaluated で hit のときだけ（insufficient、invalid_input、no_record などでは送らない）。
 * - 同じ記録は 1 人 1 通まで（sentNotices の create）。subjectId は recordId。
 */
export async function handleDeathWrite(deps: NotifyDeps, farmId: string, recordId: string, after: DeathRecord | null): Promise<void> {
  if (after === null || (after.exclusion !== null && after.exclusion !== undefined)) return;
  if (typeof after.date !== "string" || typeof after.houseId !== "string" || recordId !== `${after.date}_${after.houseId}`) return;
  let from: string;
  try {
    from = addDays(after.date, -LOOKBACK_DAYS);
    const today = jstDateOf(deps.now());
    if (after.date < addDays(today, -1)) return; // 昨日より古い日付の記録では知らせない
    if (after.date > today) return; // 未来の日付の記録では知らせない
  } catch {
    return; // 日付が読めない記録は計算できない
  }

  const farmRef = deps.db.collection("farms").doc(farmId);
  const farmSnap = await farmRef.get();
  if (!farmSnap.exists) return;
  if (!(await farmRef.collection("houses").doc(after.houseId).get()).exists) return; // 農場にない鶏舎の記録（偽の記録）では知らせない
  const rows = await farmRef.collection("deaths").where("date", ">=", from).where("date", "<=", after.date).get();
  const records = rows.docs.map((d) => d.data() as DeathRecord).filter((r) => r.houseId === after.houseId); // 鶏舎を混ぜない
  if (!records.some((r) => r.date === after.date)) records.push(after);

  const result = computeMortality(toMortalityDays(records), after.date);
  if (result.status !== "evaluated" || !result.hit) return;

  const notices = mortalityNotices({ id: farmId, ...(farmSnap.data() as Farm) }, recordId, after.date);
  if (notices.length === 0) return;

  // 記録（queued）を先に作り、そのあとで 1 日の枠を確保してから送る（dispatchNotices の関門）。
  // 確保が投げたら記録を failed にして送り直しに回す。満杯なら capped にして運営者の箱に出す（黙って捨てない）。
  let reservedNew = false;
  let capped = false;
  const gate = async (): Promise<boolean> => {
    const r = await reserveHitSlot(deps.db, farmId, after.date, recordId);
    if (r === "full") {
      capped = true;
      return false;
    }
    reservedNew = r === "reserved";
    return true;
  };
  try {
    await dispatchNotices(deps, notices, gate);
  } finally {
    try {
      if (capped) {
        // 農場や鶏舎は書かない（運営者は農場のデータを見ない）。1 日 1 件
        await enqueueReview(
          { id: reviewAlertId("mortality_capped", after.date), kind: "alert", alert: "mortality_capped", prefCode: null, caseId: null, message: "基準の知らせが 1 農場の 1 日の上限で止まりました" },
          deps.now(),
        );
      } else if (reservedNew) {
        // 1 通も送れていなければ（認証の停止、宛先なしなど）枠を返す
        const rows = await deps.db.collection("sentNotices").where("subjectId", "==", recordId).get();
        const anySent = rows.docs.some((d) => {
          const n = d.data() as { farmId?: string; event?: string; state?: string };
          return n.farmId === farmId && n.event === "mortality_hit" && n.state === "sent";
        });
        if (!anySent) await releaseHitSlot(deps.db, farmId, after.date, recordId);
      }
    } catch (e) {
      console.error("[notify] 基準の知らせの後始末に失敗しました", { code: codeOf(e) });
    }
  }
}

/** farms/{farmId}/deaths/{recordId} の作成、更新、削除。再試行しない（二重送信を避ける。送れなかった分は送り直しが拾う）。 */
export const onDeathWritten = onDocumentWritten(
  {
    document: "farms/{farmId}/deaths/{recordId}",
    retry: false,
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET],
  },
  async (event) => {
    const snap = event.data?.after;
    const after = snap?.exists ? (snap.data() as DeathRecord) : null;
    await handleDeathWrite(liveDeps(), event.params.farmId, event.params.recordId, after);
  },
);
