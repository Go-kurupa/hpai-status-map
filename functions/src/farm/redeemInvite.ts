import type { Auth } from "firebase-admin/auth";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { toJstIso } from "@hpai/shared/dates";
import type { Invite } from "@hpai/shared/types";
import { FAILURE_WINDOW_MS, hashInviteCode, MAX_CODE_LENGTH, MAX_FAILURES_PER_HOUR } from "./inviteCode";

export interface RedeemDeps {
  db: Firestore;
  auth: Auth;
  now: () => Date;
}

type Outcome =
  | { kind: "ok"; farmId: string | null }
  | { kind: "blocked" }
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "exhausted" }
  | { kind: "farm_missing" }
  | { kind: "other_farm" };

export interface Attempts {
  failures: number;
  windowStart: string;
}

/** 窓の中の記録だけを返す。窓を過ぎた記録は、なかったことにする。 */
export function activeAttempts(data: DocumentData | undefined, nowMs: number): Attempts | null {
  if (!data || typeof data.failures !== "number" || typeof data.windowStart !== "string") return null;
  const start = Date.parse(data.windowStart);
  if (!Number.isFinite(start) || nowMs - start >= FAILURE_WINDOW_MS) return null;
  return { failures: data.failures, windowStart: data.windowStart };
}

/**
 * 招待コードを使って会員になる。
 * - 試行の記録（invites/_attempts/uids/{uid}）が上限なら、正しいコードも resource-exhausted。
 * - 存在しない、期限切れ、回数の上限は、どれも failed-precondition（コードの有無を推測させない）。
 * - 同じ人の 2 回目は成功し、使用の回数を増やさない。
 * - 農場の招待は usedBy と memberUids を同じトランザクションで足す。
 * HttpsError はトランザクションの外で投げる（中で投げると失敗の記録も捨てられる）。
 */
export async function handleRedeemInvite(
  deps: RedeemDeps,
  uid: string | null | undefined,
  code: unknown,
): Promise<{ farmId: string | null }> {
  if (!uid) throw new HttpsError("unauthenticated", "ログインしてください");
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) throw new HttpsError("invalid-argument", "コードの形が違います");

  const { db, auth } = deps;
  const now = deps.now();
  const inviteRef = db.collection("invites").doc(hashInviteCode(code));
  // 同じ人が 2 つの農場の招待を同時に使っても 2 農場にならないための、読んで書くだけの文書
  const membershipLockRef = db.collection("invites").doc("_membership").collection("uids").doc(uid);
  const attemptsRef = db.collection("invites").doc("_attempts").collection("uids").doc(uid);

  const outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
    // 読むものを先にすべて読む（Admin SDK のトランザクションは、書く前に読む）
    const [attemptsSnap, inviteSnap] = await Promise.all([tx.get(attemptsRef), tx.get(inviteRef)]);
    const attempts = activeAttempts(attemptsSnap.data(), now.getTime());
    if (attempts && attempts.failures >= MAX_FAILURES_PER_HOUR) return { kind: "blocked" };

    if (!inviteSnap.exists) {
      const next: Attempts = {
        failures: (attempts?.failures ?? 0) + 1,
        windowStart: attempts?.windowStart ?? toJstIso(now),
      };
      tx.set(attemptsRef, next);
      return { kind: "missing" };
    }

    const invite = inviteSnap.data() as Invite;
    const farmId = invite.kind === "farm" ? invite.farmId : null;
    if (invite.usedBy.includes(uid)) return { kind: "ok", farmId };
    if (invite.expiresAt !== null && Date.parse(invite.expiresAt) <= now.getTime()) return { kind: "expired" };
    if (invite.usedBy.length >= invite.maxUses) return { kind: "exhausted" };

    if (invite.kind === "farm") {
      if (!farmId) return { kind: "farm_missing" };
      const farmRef = db.collection("farms").doc(farmId);
      const [farmSnap, mine, lockSnap] = await Promise.all([
        tx.get(farmRef),
        tx.get(db.collection("farms").where("memberUids", "array-contains", uid).limit(2)),
        tx.get(membershipLockRef),
      ]);
      void lockSnap; // 読んで書く（下）ことで、同じ人の同時の招待を直列にする
      if (!farmSnap.exists) return { kind: "farm_missing" };
      // 1 会員 1 農場。別の農場にすでに入っている人は、農場の招待を使えない（試行には数えない）
      if (mine.docs.some((d) => d.id !== farmId)) return { kind: "other_farm" };
      // farmId を残す。Firestore のルールが、入った農場がある間は自分の農場を作らせない（農場が消されたら作れる）
      tx.set(membershipLockRef, { touchedAt: toJstIso(now), farmId });
      tx.update(farmRef, { memberUids: FieldValue.arrayUnion(uid) });
    }
    tx.update(inviteRef, { usedBy: FieldValue.arrayUnion(uid) });
    return { kind: "ok", farmId };
  });

  switch (outcome.kind) {
    case "blocked":
      throw new HttpsError("resource-exhausted", "試した回数が多すぎます。1 時間ほどたってからもう一度試してください");
    case "missing":
    case "expired":
    case "exhausted":
      throw new HttpsError("failed-precondition", "このコードは使えません");
    case "other_farm":
      throw new HttpsError("failed-precondition", "すでに別の農場の会員です。1 人が入れる農場は 1 つです");
    case "farm_missing":
      throw new HttpsError("not-found", "招待された農場が見つかりません");
    case "ok":
      break;
  }

  // claim は記録の後に付ける。ここで失敗しても、同じ人の 2 回目で付き直る
  const user = await auth.getUser(uid);
  const claims = user.customClaims ?? {};
  if (claims.member !== true) await auth.setCustomUserClaims(uid, { ...claims, member: true });
  return { farmId: outcome.farmId };
}
