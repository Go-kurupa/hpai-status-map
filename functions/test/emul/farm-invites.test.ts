import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Farm, Invite } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { generateInviteCode, hashInviteCode, MAX_FAILURES_PER_HOUR } from "../../src/farm/inviteCode";
import { handleCreateFarmInvite, type CreateFarmInviteDeps } from "../../src/farm/createFarmInvite";
import { handleRedeemInvite, type RedeemDeps } from "../../src/farm/redeemInvite";
import { handleOp } from "../../src/ops/handlers";
import { farmFixture } from "../../../shared/test/helpers/mFixtures";

const PROJECT = "demo-hpai";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;
const T0 = new Date("2026-11-06T10:00:00+09:00");

let clock = T0;
const auth = getAuth();
const deps: RedeemDeps = { db, auth, now: () => clock };
const farmDeps: CreateFarmInviteDeps = { db, now: () => clock, appUrl: "https://hpai.example.test" };

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  clock = T0;
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST!;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
});

async function newUser(claims?: Record<string, unknown>): Promise<string> {
  const u = await auth.createUser({ email: `u${Math.random().toString(36).slice(2)}@example.test` });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  return u.uid;
}

async function seedInvite(over: Partial<Invite> = {}): Promise<string> {
  const code = generateInviteCode();
  const invite: Invite = { kind: "signup", farmId: null, maxUses: 5, usedBy: [], expiresAt: null, ...over };
  await db.collection("invites").doc(hashInviteCode(code)).set(invite);
  return code;
}

const inviteOf = async (code: string) => (await db.collection("invites").doc(hashInviteCode(code)).get()).data() as Invite;
const attemptsOf = async (uid: string) =>
  (await db.collection("invites").doc("_attempts").collection("uids").doc(uid).get()).data() as
    | { failures: number; windowStart: string }
    | undefined;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}

describe("inviteCode", () => {
  it("指紋は sha256(code.trim()) の 16 進小文字で、opsAdmin の create-invite と同じ", async () => {
    expect(hashInviteCode("  abc \n")).toBe(sha256("abc"));
    expect(hashInviteCode("abc")).toMatch(/^[0-9a-f]{64}$/);

    const res = await handleOp({ op: "create-invite", kind: "signup", maxUses: 1 });
    if (!res.ok || !("code" in res)) throw new Error("code が返るはず");
    const uid = await newUser();
    expect(await handleRedeemInvite(deps, uid, ` ${res.code} `)).toEqual({ farmId: null });
  });

  it("生成するコードは base64url の 16 バイトで、毎回違う", () => {
    const a = generateInviteCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateInviteCode()).not.toBe(a);
  });
});

describe("redeemInvite", () => {
  it("正しいコードで member が付き、既存の claim を残す。平文は保存しない", async () => {
    const uid = await newUser({ operator: true, keep: "me" });
    const code = await seedInvite();

    expect(await handleRedeemInvite(deps, uid, code)).toEqual({ farmId: null });

    expect((await auth.getUser(uid)).customClaims).toEqual({ operator: true, keep: "me", member: true });
    expect((await inviteOf(code)).usedBy).toEqual([uid]);
    const all = await db.collection("invites").get();
    expect(all.docs.map((d) => d.id + JSON.stringify(d.data())).join("")).not.toContain(code);
  });

  it("前後の空白は無視する", async () => {
    const uid = await newUser();
    const code = await seedInvite();
    await handleRedeemInvite(deps, uid, `  ${code}\n`);
    expect((await auth.getUser(uid)).customClaims).toEqual({ member: true });
  });

  it("opsAdmin の create-invite で作ったコードが通る", async () => {
    const res = await handleOp({ op: "create-invite", kind: "signup", maxUses: 2 });
    if (!res.ok || !("code" in res)) throw new Error("code が返るはず");
    const uid = await newUser();
    await handleRedeemInvite(deps, uid, res.code);
    expect((await auth.getUser(uid)).customClaims).toEqual({ member: true });
  });

  it("回数の上限は failed-precondition。上限に達した後の別の人は入れない", async () => {
    const code = await seedInvite({ maxUses: 1 });
    const a = await newUser();
    const b = await newUser();
    await handleRedeemInvite(deps, a, code);
    expect(await codeOf(handleRedeemInvite(deps, b, code))).toBe("failed-precondition");
    expect((await auth.getUser(b)).customClaims ?? {}).toEqual({});
    expect((await inviteOf(code)).usedBy).toEqual([a]);
    // 正しいコードの失敗は、試行の失敗に数えない
    expect(await attemptsOf(b)).toBeUndefined();
  });

  it("期限切れは failed-precondition", async () => {
    const uid = await newUser();
    const code = await seedInvite({ expiresAt: "2026-11-06T09:59:59+09:00" });
    expect(await codeOf(handleRedeemInvite(deps, uid, code))).toBe("failed-precondition");
    expect((await inviteOf(code)).usedBy).toEqual([]);
  });

  it("期限の前なら通る（表記が +09:00 でも時刻で比べる）", async () => {
    const uid = await newUser();
    const code = await seedInvite({ expiresAt: "2026-11-06T10:00:01+09:00" });
    await handleRedeemInvite(deps, uid, code);
    expect((await inviteOf(code)).usedBy).toEqual([uid]);
  });

  it("同じ人の 2 回目は成功し、1 回に数える（使い切った 1 回限りでも）", async () => {
    const uid = await newUser();
    const code = await seedInvite({ maxUses: 1 });
    await handleRedeemInvite(deps, uid, code);
    expect(await handleRedeemInvite(deps, uid, code)).toEqual({ farmId: null });
    expect((await inviteOf(code)).usedBy).toEqual([uid]);
  });

  it("claim の付与に失敗して途中で止まった人も、2 回目で member が付く", async () => {
    const uid = await newUser();
    const code = await seedInvite({ maxUses: 1 });
    await db.collection("invites").doc(hashInviteCode(code)).update({ usedBy: [uid] }); // 記録だけ済んだ状態
    await handleRedeemInvite(deps, uid, code);
    expect((await auth.getUser(uid)).customClaims).toEqual({ member: true });
  });

  it("農場の招待は usedBy と memberUids を同じトランザクションで足し、farmId を返す", async () => {
    const owner = await newUser({ member: true });
    await db.collection("farms").doc("f1").set(farmFixture(owner));
    const code = await seedInvite({ kind: "farm", farmId: "f1", maxUses: 1 });
    const uid = await newUser();

    expect(await handleRedeemInvite(deps, uid, code)).toEqual({ farmId: "f1" });

    const farm = (await db.collection("farms").doc("f1").get()).data() as Farm;
    expect(farm.memberUids).toEqual([owner, uid]);
    expect(farm.unsubscribedUids).toEqual([]);
    expect((await inviteOf(code)).usedBy).toEqual([uid]);
    expect((await auth.getUser(uid)).customClaims).toEqual({ member: true });
    // 1 会員 1 農場の鍵に、入った農場を残す（Firestore のルールが、入った農場がある間は自分の農場を作らせない）
    const lock = (await db.collection("invites").doc("_membership").collection("uids").doc(uid).get()).data();
    expect(lock?.farmId).toBe("f1");
    expect(typeof lock?.touchedAt).toBe("string");
  });

  it("農場がなければ not-found で、usedBy も増やさない", async () => {
    const code = await seedInvite({ kind: "farm", farmId: "gone", maxUses: 1 });
    const uid = await newUser();
    expect(await codeOf(handleRedeemInvite(deps, uid, code))).toBe("not-found");
    expect((await inviteOf(code)).usedBy).toEqual([]);
    expect((await auth.getUser(uid)).customClaims ?? {}).toEqual({});
  });

  it("1 会員 1 農場: 農場 A の会員が農場 B の招待を使うと拒否する。何も変えず、試行にも数えない", async () => {
    const uid = await newUser({ member: true });
    const ownerB = await newUser({ member: true });
    await db.collection("farms").doc("fa").set(farmFixture(uid));
    await db.collection("farms").doc("fb").set(farmFixture(ownerB));
    const code = await seedInvite({ kind: "farm", farmId: "fb", maxUses: 1 });

    expect(await codeOf(handleRedeemInvite(deps, uid, code))).toBe("failed-precondition");

    expect(((await db.collection("farms").doc("fb").get()).data() as Farm).memberUids).toEqual([ownerB]);
    expect(((await db.collection("farms").doc("fa").get()).data() as Farm).memberUids).toEqual([uid]);
    expect((await inviteOf(code)).usedBy).toEqual([]);
    expect(await attemptsOf(uid)).toBeUndefined();
  });

  it("同じ農場の招待なら、すでに会員でも成功する。signup のコードは影響を受けない", async () => {
    const uid = await newUser({ member: true });
    await db.collection("farms").doc("fa").set(farmFixture(uid));
    const same = await seedInvite({ kind: "farm", farmId: "fa", maxUses: 1 });
    expect(await handleRedeemInvite(deps, uid, same)).toEqual({ farmId: "fa" });
    expect(((await db.collection("farms").doc("fa").get()).data() as Farm).memberUids).toEqual([uid]);

    const signup = await seedInvite();
    expect(await handleRedeemInvite(deps, uid, signup)).toEqual({ farmId: null });
  });

  it("1 会員 1 農場: 同時に 2 つの農場の招待を使っても、入れるのは 1 農場だけ", async () => {
    for (let round = 0; round < 3; round++) {
      const ownerA = await newUser({ member: true });
      const ownerB = await newUser({ member: true });
      const fa = `ra${round}`;
      const fb = `rb${round}`;
      await db.collection("farms").doc(fa).set(farmFixture(ownerA));
      await db.collection("farms").doc(fb).set(farmFixture(ownerB));
      const codeA = await seedInvite({ kind: "farm", farmId: fa, maxUses: 1 });
      const codeB = await seedInvite({ kind: "farm", farmId: fb, maxUses: 1 });
      const guest = await newUser();

      const results = await Promise.all([codeOf(handleRedeemInvite(deps, guest, codeA)), codeOf(handleRedeemInvite(deps, guest, codeB))]);

      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "failed-precondition")).toHaveLength(1);
      const joined = (await db.collection("farms").where("memberUids", "array-contains", guest).get()).size;
      expect(joined).toBe(1);
    }
  });

  it("存在しないコードは failed-precondition で、invites/_attempts/uids/{uid} に数える", async () => {
    const uid = await newUser();
    expect(await codeOf(handleRedeemInvite(deps, uid, "no-such-code"))).toBe("failed-precondition");
    expect(await attemptsOf(uid)).toEqual({ failures: 1, windowStart: "2026-11-06T10:00:00+09:00" });
    expect(await codeOf(handleRedeemInvite(deps, uid, "another"))).toBe("failed-precondition");
    expect((await attemptsOf(uid))?.failures).toBe(2);
    expect((await attemptsOf(uid))?.windowStart).toBe("2026-11-06T10:00:00+09:00");
    // 別の人の数には混ざらない
    expect(await attemptsOf(await newUser())).toBeUndefined();
  });

  it("1 時間に 10 回失敗すると正しいコードも resource-exhausted。1 時間後に戻る（契約 8）", async () => {
    const uid = await newUser();
    const code = await seedInvite();
    for (let i = 0; i < MAX_FAILURES_PER_HOUR; i++) {
      expect(await codeOf(handleRedeemInvite(deps, uid, `wrong-${i}`))).toBe("failed-precondition");
    }
    expect(MAX_FAILURES_PER_HOUR).toBe(10);
    expect(await codeOf(handleRedeemInvite(deps, uid, code))).toBe("resource-exhausted");
    expect(await codeOf(handleRedeemInvite(deps, uid, "wrong-again"))).toBe("resource-exhausted");
    expect((await attemptsOf(uid))?.failures).toBe(10); // 止めている間は増やさない
    expect((await inviteOf(code)).usedBy).toEqual([]);

    clock = new Date(T0.getTime() + HOUR - 1);
    expect(await codeOf(handleRedeemInvite(deps, uid, code))).toBe("resource-exhausted");

    clock = new Date(T0.getTime() + HOUR);
    expect(await handleRedeemInvite(deps, uid, code)).toEqual({ farmId: null });
  });

  it("1 時間たった後の失敗は、新しい窓の 1 回目から数える", async () => {
    const uid = await newUser();
    for (let i = 0; i < 3; i++) await codeOf(handleRedeemInvite(deps, uid, `wrong-${i}`));
    clock = new Date(T0.getTime() + HOUR + 1000);
    await codeOf(handleRedeemInvite(deps, uid, "wrong-late"));
    expect(await attemptsOf(uid)).toEqual({ failures: 1, windowStart: "2026-11-06T11:00:01+09:00" });
  });

  it("未ログインは unauthenticated。コードの型が違えば invalid-argument で数えない", async () => {
    const code = await seedInvite();
    expect(await codeOf(handleRedeemInvite(deps, null, code))).toBe("unauthenticated");
    expect(await codeOf(handleRedeemInvite(deps, undefined, code))).toBe("unauthenticated");
    const uid = await newUser();
    expect(await codeOf(handleRedeemInvite(deps, uid, 123))).toBe("invalid-argument");
    expect(await codeOf(handleRedeemInvite(deps, uid, "x".repeat(300)))).toBe("invalid-argument");
    expect(await attemptsOf(uid)).toBeUndefined();
  });

  it("同じコードを同時に使っても、回数の上限を超えない", async () => {
    const code = await seedInvite({ maxUses: 2 });
    const users = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
    const results = await Promise.all(users.map((u) => codeOf(handleRedeemInvite(deps, u, code))));
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect((await inviteOf(code)).usedBy).toHaveLength(2);
  });
});

describe("createFarmInvite", () => {
  it("農場の会員が呼ぶと、7 日で切れ 1 回だけの農場の招待を指紋で保存し、平文は返り値だけ", async () => {
    const uid = await newUser({ member: true });
    await db.collection("farms").doc("f1").set(farmFixture(uid));

    const res = await handleCreateFarmInvite(farmDeps, { uid, member: true }, "f1");

    expect(res.url).toBe(`https://hpai.example.test/join/${res.code}`);
    const saved = await inviteOf(res.code);
    expect(saved).toEqual({
      kind: "farm",
      farmId: "f1",
      maxUses: 1,
      usedBy: [],
      expiresAt: "2026-11-13T10:00:00+09:00",
    } satisfies Invite);
    const all = await db.collection("invites").get();
    expect(all.size).toBe(1);
    expect(all.docs.map((d) => d.id + JSON.stringify(d.data())).join("")).not.toContain(res.code);
    expect(all.docs[0]!.id).toBe(hashInviteCode(res.code));
  });

  it("末尾の / は重ねない", async () => {
    const uid = await newUser({ member: true });
    await db.collection("farms").doc("f1").set(farmFixture(uid));
    const res = await handleCreateFarmInvite({ ...farmDeps, appUrl: "https://hpai.example.test/" }, { uid, member: true }, "f1");
    expect(res.url).toBe(`https://hpai.example.test/join/${res.code}`);
  });

  it("作った招待で別の人が農場の会員になれる（通し）", async () => {
    const owner = await newUser({ member: true });
    await db.collection("farms").doc("f1").set(farmFixture(owner));
    const { code } = await handleCreateFarmInvite(farmDeps, { uid: owner, member: true }, "f1");
    const guest = await newUser();
    expect(await handleRedeemInvite(deps, guest, code)).toEqual({ farmId: "f1" });
    expect(((await db.collection("farms").doc("f1").get()).data() as Farm).memberUids).toEqual([owner, guest]);
    // 1 回だけ
    expect(await codeOf(handleRedeemInvite(deps, await newUser(), code))).toBe("failed-precondition");
  });

  it("会員でない、農場の会員でない、未ログインは断る。農場がなければ not-found", async () => {
    const owner = await newUser({ member: true });
    await db.collection("farms").doc("f1").set(farmFixture(owner));
    const other = await newUser({ member: true });
    const plain = await newUser();

    expect(await codeOf(handleCreateFarmInvite(farmDeps, null, "f1"))).toBe("unauthenticated");
    expect(await codeOf(handleCreateFarmInvite(farmDeps, { uid: plain, member: false }, "f1"))).toBe("permission-denied");
    expect(await codeOf(handleCreateFarmInvite(farmDeps, { uid: other, member: true }, "f1"))).toBe("permission-denied");
    expect(await codeOf(handleCreateFarmInvite(farmDeps, { uid: owner, member: true }, "nope"))).toBe("not-found");
    expect(await codeOf(handleCreateFarmInvite(farmDeps, { uid: owner, member: true }, 42))).toBe("invalid-argument");
    expect(await codeOf(handleCreateFarmInvite(farmDeps, { uid: owner, member: true }, "a/b"))).toBe("invalid-argument");
    expect((await db.collection("invites").get()).size).toBe(0);
  });
});
