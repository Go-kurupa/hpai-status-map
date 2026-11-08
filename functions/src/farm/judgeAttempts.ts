// 審査員用のリンクの連打の抑え。接続元の IP ごと（sha256 の 16 進を文書 id に。IP そのものは保存しない）に、
// 1 時間の窓で「間違った文字列」の回数を数える。文書は invites/_judgeAttempts/ips/{hash}（規則の全拒否に落ち、画面からは読めず書けない）。
// 形は redeemInvite の invites/_attempts/uids/{uid} と同じ（{failures, windowStart}）。
// 2026-11-08 PM の決定: 正しい文字列は回数にかかわらず必ず通す（ここを呼ばない）。この抑えは費用とログの量のため。
import type { Firestore } from "firebase-admin/firestore";
import { toJstIso } from "@hpai/shared/dates";
import { activeAttempts, type Attempts } from "./redeemInvite";

/** 1 時間の窓で、間違いが 20 回に達した後（21 回目から）の間違いは、数えずに早く断る */
export const JUDGE_MAX_FAILURES_PER_HOUR = 20;

/**
 * 間違った文字列を 1 回記録する。
 * - blocked: 窓の中ですでに上限に達していた（数えない・書かない）
 * - reachedLimit: この 1 回でちょうど上限に達した（窓ごとに 1 回だけ要約のログを出すため）
 */
export type JudgeAttempt = (ipHash: string) => Promise<{ blocked: boolean; reachedLimit: boolean }>;

export const judgeAttemptsRef = (db: Firestore, ipHash: string) =>
  db.collection("invites").doc("_judgeAttempts").collection("ips").doc(ipHash);

/** 1 つのトランザクションで、読む → 窓の中で上限に達していれば blocked（書かない）→ 達していなければ 1 足す */
export function firestoreJudgeAttempt(db: Firestore, now: () => Date): JudgeAttempt {
  return async (ipHash) => {
    const ref = judgeAttemptsRef(db, ipHash);
    return db.runTransaction(async (tx) => {
      const at = now();
      const attempts = activeAttempts((await tx.get(ref)).data(), at.getTime());
      if (attempts && attempts.failures >= JUDGE_MAX_FAILURES_PER_HOUR) return { blocked: true, reachedLimit: false };
      const next: Attempts = {
        failures: (attempts?.failures ?? 0) + 1,
        windowStart: attempts?.windowStart ?? toJstIso(at),
      };
      tx.set(ref, next);
      return { blocked: false, reachedLimit: next.failures === JUDGE_MAX_FAILURES_PER_HOUR };
    });
  };
}
