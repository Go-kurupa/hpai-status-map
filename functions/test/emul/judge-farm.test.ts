// 審査員用の見本の農場（ensureJudgeFarm）と、審査員用のリンクの入口（judgeSignIn）。模擬環境（demo-hpai）。
// judgeSignIn の 1 件は関数の模擬環境を HTTP で呼ぶ（Secret の解決まで確かめる）。関数の模擬環境が動いていなければ飛ばす。
// 実行の例（リポジトリの根から。先に npm run bundle -w functions）:
//   FUNCTIONS_DISCOVERY_TIMEOUT=120 flock /tmp/hpai-emulators.lock npx firebase emulators:exec --only firestore,auth,functions \
//     --project demo-hpai "npx vitest run --project functions-emul functions/test/emul/judge-farm.test.ts"
import { getAuth } from "firebase-admin/auth";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@hpai/shared/dates";
import { JUDGE_FARM_ID, JUDGE_FARM_NAME, JUDGE_UID } from "@hpai/shared/judge";
import { SELF_CHECK_ITEMS } from "@hpai/shared/reports";
import type { DeathRecord, Farm, House } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { ensureJudgeFarm, judgeDisinfectedOn } from "../../src/farm/judgeFarm";

const PROJECT = "demo-hpai";
/** 模擬環境の Secret（functions/.secret.local の JUDGE_LINK_TOKEN）。試験用の値で、本番の値ではない */
const EMULATOR_JUDGE_TOKEN = "judge-link-token-for-emulator-only";

// 日本時間 2026-11-08 の朝。範囲は 10 月 11 日〜11 月 7 日（28 日）
const T0 = new Date("2026-11-08T10:00:00+09:00");
const TODAY = "2026-11-08";
const DAY = 86_400_000;

const auth = getAuth();
const farmRef = db.collection("farms").doc(JUDGE_FARM_ID);
const ensureAt = (now: Date) => ensureJudgeFarm({ db, auth, now: () => now });

/** firestore.rules の farmShapeOk が許す項目（hasOnly） */
const FARM_KEYS = [
  "name", "memberUids", "unsubscribedUids", "meshCode", "muniCode", "prefCode",
  "frequentMuniCodes", "production", "housing", "rearing", "kahoContact", "notify",
  "selfCheckDue", "updatedAt",
];

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
});

/** 農場の下の全文書（path → 中身） */
async function snapshot(): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const farm = await farmRef.get();
  if (farm.exists) out.set(farm.ref.path, farm.data());
  for (const col of ["houses", "deaths", "checks"]) {
    for (const d of (await farmRef.collection(col).get()).docs) out.set(d.ref.path, d.data());
  }
  return out;
}

const countOf = async (col: string) => (await farmRef.collection(col).get()).size;

/** 農場・鍵・その下の全文書の更新の時刻（path → 時刻）。書き込みがあれば変わる */
async function updateTimes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const s of [await farmRef.get(), await db.doc(`invites/_membership/uids/${JUDGE_UID}`).get()]) {
    if (s.exists) out.set(s.ref.path, s.updateTime!.toDate().toISOString() + s.updateTime!.nanoseconds);
  }
  for (const col of ["houses", "deaths", "checks"]) {
    for (const d of (await farmRef.collection(col).get()).docs) out.set(d.ref.path, d.updateTime.toDate().toISOString() + d.updateTime.nanoseconds);
  }
  return out;
}

describe("ensureJudgeFarm", () => {
  it("空の模擬環境で呼ぶと、会員・農場・鶏舎 3 つ・死亡数 28 日 × 2 鶏舎・前の月の自己点検・14 日のうち 10 日の消毒ができる", async () => {
    await ensureAt(T0);

    // 会員: メールアドレスなし、claim は member と judge
    const user = await auth.getUser(JUDGE_UID);
    expect(user.email).toBeUndefined();
    expect(user.customClaims).toEqual({ member: true, judge: true });

    // 農場
    const farm = (await farmRef.get()).data() as Farm;
    expect(farm.name).toBe(JUDGE_FARM_NAME);
    expect(farm.memberUids).toEqual([JUDGE_UID]);
    expect(farm.unsubscribedUids).toEqual([]);
    expect(farm.notify).toEqual({ level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null });
    expect(Object.keys(farm.selfCheckDue).length).toBeGreaterThan(0);
    expect(farm.selfCheckDue["2026-11"]).toBe("2026-12-10");
    expect(farm).toMatchObject({ meshCode: "52346237", muniCode: "33643", prefCode: "33", production: "layer" });
    for (const k of Object.keys(farm)) expect(FARM_KEYS, k).toContain(k);
    // 1 会員 1 農場の鍵（審査員が自分の uid の農場を作れない）
    expect((await db.doc(`invites/_membership/uids/${JUDGE_UID}`).get()).get("farmId")).toBe(JUDGE_FARM_ID);

    // 鶏舎
    const houses = Object.fromEntries((await farmRef.collection("houses").get()).docs.map((d) => [d.id, d.data() as House]));
    expect(houses).toEqual({
      "house-1": { name: "1 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false },
      "house-2": { name: "2 号舎", birdType: "採卵鶏", flockSize: 800, empty: false },
      "house-3": { name: "3 号舎", birdType: "採卵鶏", flockSize: 0, empty: true },
    });

    // 死亡数: 10 月 11 日〜11 月 7 日 × 1 号舎・2 号舎。今日の分は作らない
    const deaths = (await farmRef.collection("deaths").get()).docs;
    expect(deaths).toHaveLength(56);
    for (const d of deaths) {
      const r = d.data() as DeathRecord;
      expect(d.id).toBe(`${r.date}_${r.houseId}`);
      expect(Object.keys(r).sort()).toEqual(["date", "deaths", "exclusion", "flockSizeAt", "houseId"]);
      expect(r.date >= addDays(TODAY, -28) && r.date <= addDays(TODAY, -1), r.date).toBe(true);
      expect(r.deaths).toBeGreaterThanOrEqual(0);
      expect(r.deaths).toBeLessThanOrEqual(3);
      expect(r.flockSizeAt).toBe(r.houseId === "house-1" ? 1200 : 800);
      expect(r.exclusion).toBeNull();
    }
    expect(deaths.some((d) => d.id.startsWith(TODAY))).toBe(false);

    // 点検と消毒
    const checks = Object.fromEntries((await farmRef.collection("checks").get()).docs.map((d) => [d.id, d.data()]));
    const dis = Object.entries(checks).filter(([, c]) => c.kind === "disinfection");
    expect(dis).toHaveLength(20);
    expect(new Set(dis.map(([, c]) => c.date)).size).toBe(10);
    for (const [id, c] of dis) {
      expect(id).toBe(`dis_${c.date}_${c.itemId}`);
      expect(["always-17", "always-22"]).toContain(c.itemId);
      expect(c.date >= addDays(TODAY, -14) && c.date <= addDays(TODAY, -1)).toBe(true);
      expect(Object.keys(c).sort()).toEqual(["date", "itemId", "kind"]);
    }
    const self = checks["self_2026-10"];
    expect(self).toEqual({ kind: "self_inspection", date: "2026-10-25", month: "2026-10", answers: expect.any(Object) });
    const answers = (self as { answers: Record<string, string> }).answers;
    expect(Object.keys(answers).sort()).toEqual(SELF_CHECK_ITEMS.map((i) => i.no).sort());
    expect(Object.values(answers).filter((v) => v === "ng")).toHaveLength(1);
    expect(Object.values(answers).filter((v) => v === "ok")).toHaveLength(SELF_CHECK_ITEMS.length - 1);
    expect(Object.keys(checks)).toHaveLength(21);
  });

  it("2 回呼んでも文書の数は変わらず、審査員が入れた記録や直した設定は上書きしない", async () => {
    await ensureAt(T0);
    const before = await snapshot();
    // 審査員が入れた記録と、直した設定
    await farmRef.collection("deaths").doc("2026-11-01_house-1").set({ date: "2026-11-01", houseId: "house-1", deaths: 9, flockSizeAt: 1200, exclusion: null });
    await farmRef.collection("deaths").doc(`${TODAY}_house-2`).set({ date: TODAY, houseId: "house-2", deaths: 1, flockSizeAt: 800, exclusion: null });
    await farmRef.update({ name: "直した名前", "notify.level1": true });
    await farmRef.collection("houses").doc("house-1").update({ flockSize: 1100 });

    await ensureAt(new Date(T0.getTime() + 60_000));
    const after = await snapshot();
    expect(after.size).toBe(before.size + 1); // 審査員が入れた今日の 1 件だけ
    expect(after.get(`farms/${JUDGE_FARM_ID}/deaths/2026-11-01_house-1`)).toMatchObject({ deaths: 9 });
    expect(after.get(`farms/${JUDGE_FARM_ID}/deaths/${TODAY}_house-2`)).toMatchObject({ deaths: 1 });
    expect(after.get(`farms/${JUDGE_FARM_ID}`)).toMatchObject({ name: "直した名前", notify: { level1: true } });
    expect(after.get(`farms/${JUDGE_FARM_ID}/houses/house-1`)).toMatchObject({ flockSize: 1100 });
    expect(await countOf("deaths")).toBe(57);
    expect((await auth.getUser(JUDGE_UID)).customClaims).toEqual({ member: true, judge: true });
  });

  it("同時に 2 回呼んでも、1 回と同じ数", async () => {
    await Promise.all([ensureAt(T0), ensureAt(T0)]);
    expect(await countOf("houses")).toBe(3);
    expect(await countOf("deaths")).toBe(56);
    expect(await countOf("checks")).toBe(21);
    expect((await db.collection("farms").where("memberUids", "array-contains", JUDGE_UID).get()).size).toBe(1);
  });

  it("翌日に呼ぶと、前日の分だけが足される", async () => {
    await ensureAt(T0);
    const before = await snapshot();
    await ensureAt(new Date(T0.getTime() + DAY));
    const after = await snapshot();
    const added = [...after.keys()].filter((k) => !before.has(k)).map((k) => k.split("/").slice(2).join("/")).sort();
    const expected = [`deaths/${TODAY}_house-1`, `deaths/${TODAY}_house-2`];
    if (judgeDisinfectedOn(TODAY)) expected.push(`checks/dis_${TODAY}_always-17`, `checks/dis_${TODAY}_always-22`);
    expect(added).toEqual(expected.sort());
    // 前からの文書は変わらない
    for (const [k, v] of before) expect(after.get(k), k).toEqual(v);
  });

  it("同じ日の 2 回目は、1 回の読み込み（getAll）だけで戻り、何も書かない（M-2）", async () => {
    await ensureAt(T0);
    const before = await updateTimes();
    const getAll = vi.spyOn(db, "getAll");
    const create = vi.spyOn(Object.getPrototypeOf(farmRef) as { create: (...a: unknown[]) => unknown }, "create");
    try {
      await ensureAt(new Date(T0.getTime() + 60_000));
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    } finally {
      getAll.mockRestore();
      create.mockRestore();
    }
    // 記録の数も、文書の更新の時刻も変わらない
    expect(await updateTimes()).toEqual(before);
    // 審査員の claim の付け直しは近道でも行う
    await auth.setCustomUserClaims(JUDGE_UID, { member: true });
    await ensureAt(new Date(T0.getTime() + 120_000));
    expect((await auth.getUser(JUDGE_UID)).customClaims).toEqual({ member: true, judge: true });
  });

  it("近道の間は、範囲の中の古い記録を消しても作り直さない。前日の分が欠けた回（翌日）に作り直す", async () => {
    await ensureAt(T0);
    const old = farmRef.collection("deaths").doc(`${addDays(TODAY, -10)}_house-1`);
    await old.delete();
    await ensureAt(new Date(T0.getTime() + 60_000));
    expect((await old.get()).exists).toBe(false);
    await ensureAt(new Date(T0.getTime() + DAY));
    expect((await old.get()).exists).toBe(true);
  });

  it("1 会員 1 農場の鍵・鶏舎・前日の死亡数のどれかが欠けていれば、同じ日でも全部を確かめて作り直す", async () => {
    await ensureAt(T0);
    const lock = db.doc(`invites/_membership/uids/${JUDGE_UID}`);
    const yesterday = farmRef.collection("deaths").doc(`${addDays(TODAY, -1)}_house-2`);
    const house3 = farmRef.collection("houses").doc("house-3");
    for (const ref of [lock, yesterday, house3]) {
      await ref.delete();
      await ensureAt(new Date(T0.getTime() + 60_000));
      expect((await ref.get()).exists, ref.path).toBe(true);
    }
    expect(await countOf("deaths")).toBe(56);
  });

  it("空舎にされた鶏舎には死亡数を足さない", async () => {
    await ensureAt(T0);
    await farmRef.collection("houses").doc("house-2").update({ empty: true, flockSize: 0 });
    await ensureAt(new Date(T0.getTime() + DAY));
    expect((await farmRef.collection("deaths").doc(`${TODAY}_house-1`).get()).exists).toBe(true);
    expect((await farmRef.collection("deaths").doc(`${TODAY}_house-2`).get()).exists).toBe(false);
  });
});

/** 関数の模擬環境の場所（動いていなければ null） */
async function functionsHost(): Promise<string | null> {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) return null;
  const list = (await (await fetch(`http://${hub}/emulators`)).json()) as Record<string, { host: string; port: number }>;
  const f = list.functions;
  if (!f) return null;
  return `${f.host === "0.0.0.0" ? "127.0.0.1" : f.host}:${f.port}`;
}

async function callJudgeSignIn(host: string, token: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://${host}/${PROJECT}/asia-northeast1/judgeSignIn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { token } }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("judgeSignIn（関数の模擬環境）", () => {
  it("違う文字列は PERMISSION_DENIED で会員も農場も作らない。合えばカスタムトークンが返り、ログインすると judge-demo（member と judge の claim）", async (ctx) => {
    const host = await functionsHost();
    if (!host) ctx.skip();

    const bad = await callJudgeSignIn(host!, "wrong-token");
    expect(bad.status).toBe(403);
    expect((bad.body.error as { status?: string }).status).toBe("PERMISSION_DENIED");
    expect((await farmRef.get()).exists).toBe(false);
    await expect(auth.getUser(JUDGE_UID)).rejects.toMatchObject({ code: "auth/user-not-found" });

    const ok = await callJudgeSignIn(host!, EMULATOR_JUDGE_TOKEN);
    expect(ok.status).toBe(200);
    const customToken = (ok.body.result as { customToken: string }).customToken;
    expect(typeof customToken).toBe("string");
    expect((await farmRef.get()).exists).toBe(true);

    // 画面と同じく、カスタムトークンでログインする（Auth の模擬環境）
    const signIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
    );
    expect(signIn.status).toBe(200);
    const idToken = ((await signIn.json()) as { idToken: string }).idToken;
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(claims.user_id).toBe(JUDGE_UID);
    expect(claims.member).toBe(true);
    expect(claims.judge).toBe(true);
    expect(claims.email).toBeUndefined();
  });
});
