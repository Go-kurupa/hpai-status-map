// 死亡数の書き込みで、死亡率の基準に当たったら同じ農場の会員へすぐ知らせる（M-13、設計書 §6、§8）。
// 計算は computeMortality（Claude を使わない）。診断はしない。入力を直しても、送ったメールは取り消せない。
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { addDays, jstDateOf } from "@hpai/shared/dates";
import { computeMortality, toMortalityDays } from "@hpai/shared/mortality";
import { mortalityNotices } from "@hpai/shared/notices";
import type { DeathRecord, Farm } from "@hpai/shared/types";
import { GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET } from "../secrets";
import { dispatchNotices, type NotifyDeps } from "./dispatch";
import { liveDeps } from "./liveDeps";

/** 対象期間 21 日（除外の日と記録のない日を飛ばして遡る）のために読む日数。M-07 の最大 120 日。 */
const LOOKBACK_DAYS = 120;

/**
 * 記録 1 件の書き込みで、その鶏舎だけを計算して、基準に当たれば会員全員へすぐ知らせる。
 * - 削除、除外の日、昨日より古い日付、文書 id が date_houseId と合わない記録では何もしない。
 * - 当たるのは evaluated で hit のときだけ（insufficient、invalid_input、no_record などでは送らない）。
 * - 同じ記録は 1 人 1 通まで（sentNotices の create）。subjectId は recordId。
 */
export async function handleDeathWrite(deps: NotifyDeps, farmId: string, recordId: string, after: DeathRecord | null): Promise<void> {
  if (after === null || (after.exclusion !== null && after.exclusion !== undefined)) return;
  if (typeof after.date !== "string" || typeof after.houseId !== "string" || recordId !== `${after.date}_${after.houseId}`) return;
  let from: string;
  try {
    from = addDays(after.date, -LOOKBACK_DAYS);
    if (after.date < addDays(jstDateOf(deps.now()), -1)) return; // 昨日より古い日付の記録では知らせない
  } catch {
    return; // 日付が読めない記録は計算できない
  }

  const farmRef = deps.db.collection("farms").doc(farmId);
  const farmSnap = await farmRef.get();
  if (!farmSnap.exists) return;
  const rows = await farmRef.collection("deaths").where("date", ">=", from).where("date", "<=", after.date).get();
  const records = rows.docs.map((d) => d.data() as DeathRecord).filter((r) => r.houseId === after.houseId); // 鶏舎を混ぜない
  if (!records.some((r) => r.date === after.date)) records.push(after);

  const result = computeMortality(toMortalityDays(records), after.date);
  if (result.status !== "evaluated" || !result.hit) return;

  const notices = mortalityNotices({ id: farmId, ...(farmSnap.data() as Farm) }, recordId, after.date);
  if (notices.length > 0) await dispatchNotices(deps, notices);
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
