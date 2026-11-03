// 近隣への説明文を、会員 1 人が 1 日に頼める回数（M-19 レビュー指摘 2）。usage/neighbor-calls-{YYYY-MM-DD}-{uid}（日付は日本時間）。
// インスタンスは状態を持たないので、数えるのは Firestore の取引の中。確認と加算を 1 つの取引で行うので、同時に呼ばれても上限を越えない。
// uid と日付と回数だけを持つ。入力した文は持たない。
import { jstDateOf } from "@hpai/shared/dates";
import { db } from "../admin";

/** 文書の path。uid は Firebase の uid（英数字）。 */
export const neighborCallPath = (uid: string, now: Date): string => `usage/neighbor-calls-${jstDateOf(now)}-${uid}`;

/** 1 回分を確保する。確保できたら true（回数を進めた）、上限なら false（何も書かない）。 */
export async function reserveNeighborCall(uid: string, now: Date, limit: number): Promise<boolean> {
  if (uid === "" || uid.includes("/")) throw new RangeError("uid が違います");
  const ref = db.doc(neighborCallPath(uid, now));
  return db.runTransaction(async (tx) => {
    const raw = (await tx.get(ref)).get("count");
    const count = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
    if (count >= limit) return false;
    tx.set(ref, { count: count + 1, date: jstDateOf(now), uid });
    return true;
  });
}
