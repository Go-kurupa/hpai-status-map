import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { toJstIso } from "@hpai/shared/dates";
import type { Farm, Invite } from "@hpai/shared/types";
import { FARM_INVITE_TTL_MS, generateInviteCode, hashInviteCode } from "./inviteCode";

export interface CreateFarmInviteDeps {
  db: Firestore;
  now: () => Date;
  /** 末尾の / はあってもなくてもよい */
  appUrl: string;
}

export interface Caller {
  uid: string;
  /** custom claim の member */
  member: boolean;
}

/**
 * 農場に会員を足す招待リンクを作る。7 日で切れ、1 回だけ使える。
 * claim の member に加えて、その農場の memberUids に入っている人だけが作れる（他の農場へ自分を足せないように）。
 * 平文は返り値だけで、保存は指紋だけ。
 */
export async function handleCreateFarmInvite(
  deps: CreateFarmInviteDeps,
  caller: Caller | null,
  farmId: unknown,
): Promise<{ code: string; url: string }> {
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.member) throw new HttpsError("permission-denied", "会員だけが招待を作れます");
  if (typeof farmId !== "string" || farmId === "" || farmId.length > 128 || farmId.includes("/")) {
    throw new HttpsError("invalid-argument", "農場の指定が違います");
  }

  const farmSnap = await deps.db.collection("farms").doc(farmId).get();
  if (!farmSnap.exists) throw new HttpsError("not-found", "農場が見つかりません");
  const farm = farmSnap.data() as Farm;
  if (!farm.memberUids.includes(caller.uid)) throw new HttpsError("permission-denied", "この農場の会員だけが招待を作れます");

  const code = generateInviteCode();
  const invite: Invite = {
    kind: "farm",
    farmId,
    maxUses: 1,
    usedBy: [],
    expiresAt: toJstIso(new Date(deps.now().getTime() + FARM_INVITE_TTL_MS)),
  };
  await deps.db.collection("invites").doc(hashInviteCode(code)).create(invite);
  return { code, url: `${deps.appUrl.replace(/\/+$/, "")}/join/${code}` };
}
