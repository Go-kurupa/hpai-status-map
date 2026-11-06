// 対策の見直し相談の 1 日の回数。取引の中で数える（drafts/dailyLimit.ts と同じ作り）。日付は日本時間。
//  - 会員: usage/consult-calls-{YYYY-MM-DD}-{uid}。plan と followup の合計
//  - 審査員の入口: usage/consult-judge-{YYYY-MM-DD}。全体で 1 つ
// 回数と日付（と uid）だけを持つ。入力した問いの文は持たない。
import { jstDateOf } from "@hpai/shared/dates";
import type { DocumentReference } from "firebase-admin/firestore";
import { db } from "../admin";

/** 会員の文書の path。uid は Firebase の uid（英数字）。 */
export const consultCallPath = (uid: string, now: Date): string => `usage/consult-calls-${jstDateOf(now)}-${uid}`;

/** 審査員の入口の文書の path（全体で 1 つ）。 */
export const consultJudgePath = (now: Date): string => `usage/consult-judge-${jstDateOf(now)}`;

/** 確認と加算を 1 つの取引で行う。確保できたら true、上限なら false（何も書かない）。 */
async function reserveIn(ref: DocumentReference, limit: number, fields: Record<string, unknown>): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const raw = (await tx.get(ref)).get("count");
    const count = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
    if (count >= limit) return false;
    tx.set(ref, { count: count + 1, ...fields });
    return true;
  });
}

/** 会員 1 人の 1 日の分を 1 回確保する。 */
export async function reserveConsultCall(uid: string, now: Date, limit: number): Promise<boolean> {
  if (uid === "" || uid.includes("/")) throw new RangeError("uid が違います");
  return reserveIn(db.doc(consultCallPath(uid, now)), limit, { date: jstDateOf(now), uid });
}

/** 審査員の入口の、全体の 1 日の分を 1 回確保する。 */
export async function reserveJudgeCall(now: Date, limit: number): Promise<boolean> {
  return reserveIn(db.doc(consultJudgePath(now)), limit, { date: jstDateOf(now) });
}
