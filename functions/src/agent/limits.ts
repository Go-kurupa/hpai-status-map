// エージェントの道具の取得の回数の上限（X-14）。1 日に県ごと 60 回、全体で 300 回。usage/agent-calls-{YYYY-MM-DD}（日付は日本時間）。
// インスタンスは状態を持たないので、数えるのは Firestore の取引の中。取得の前に 1 回分を確保し、確保できなければ取得しない。
import { jstDateOf } from "@hpai/shared/dates";
import type { PrefCode } from "@hpai/shared/types";
import { db } from "../admin";

/** usage/agent-calls-{YYYY-MM-DD}。 */
export interface AgentCallCount {
  total: number;
  byPref: Record<PrefCode, number>;
}

export const MAX_CALLS_PER_PREF = 60;
export const MAX_CALLS_TOTAL = 300;

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** 文書の中身から回数を読む。型の違う値は 0 とする。 */
export function readCallCount(data: Record<string, unknown> | undefined): AgentCallCount {
  const by = data?.byPref;
  const byPref: Record<PrefCode, number> = {};
  if (by !== null && typeof by === "object") {
    for (const [k, v] of Object.entries(by as Record<string, unknown>)) byPref[k] = count(v);
  }
  return { total: count(data?.total), byPref };
}

/** もう 1 回取ってよいか。県ごとに 60 回を超える 61 回目、全体で 301 回目は取らない。 */
export function canTakeCall(c: AgentCallCount, prefCode: PrefCode): boolean {
  return c.total < MAX_CALLS_TOTAL && (c.byPref[prefCode] ?? 0) < MAX_CALLS_PER_PREF;
}

/** 回数の文書の id。 */
export const callCountPath = (now: Date): string => `usage/agent-calls-${jstDateOf(now)}`;

/** 1 回分を確保する。確保できたら true（回数を進めた）、上限なら false（何も書かない）。 */
export async function reserveAgentCall(prefCode: PrefCode, now: Date): Promise<boolean> {
  const ref = db.doc(callCountPath(now));
  return db.runTransaction(async (tx) => {
    const current = readCallCount((await tx.get(ref)).data());
    if (!canTakeCall(current, prefCode)) return false;
    tx.set(ref, { total: current.total + 1, byPref: { [prefCode]: (current.byPref[prefCode] ?? 0) + 1 } }, { merge: true });
    return true;
  });
}
