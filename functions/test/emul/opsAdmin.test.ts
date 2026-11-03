import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAuth } from "firebase-admin/auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import type { Invite, Source, SourceSeed } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { OpError, handleOp, serveOps } from "../../src/ops/handlers";
import type { OpRequest } from "../../src/ops/handlers";

const PROJECT = "demo-hpai";
const BEARER_VALUE = "test-value-not-real";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let tmp: string;

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-ops-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST!;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
});

function writeSources(seeds: SourceSeed[]): string {
  const file = path.join(tmp, `sources-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(seeds));
  return file;
}

async function rejection(p: Promise<unknown>): Promise<OpError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(OpError);
    return e as OpError;
  }
  throw new Error("拒否されるはずが通った");
}

describe("set-claims", () => {
  it("claim を足し、既存の claim を残す", async () => {
    const auth = getAuth();
    const user = await auth.createUser({ email: "someone@example.test" });
    await auth.setCustomUserClaims(user.uid, { member: true, keep: "me" });

    const res = await handleOp({ op: "set-claims", email: "someone@example.test", operator: true });

    expect(res.ok).toBe(true);
    expect((await auth.getUser(user.uid)).customClaims).toEqual({ member: true, keep: "me", operator: true });
    expect(JSON.stringify(res)).not.toContain("someone@example.test");
  });

  it("claim の無い利用者にも足せる", async () => {
    const auth = getAuth();
    const user = await auth.createUser({ email: "fresh@example.test" });
    await handleOp({ op: "set-claims", email: "fresh@example.test", operator: true });
    expect((await auth.getUser(user.uid)).customClaims).toEqual({ operator: true });
  });

  it("利用者がいなければ 400。応答に email を出さない", async () => {
    const err = await rejection(handleOp({ op: "set-claims", email: "nobody@example.test", operator: true }));
    expect(err.status).toBe(400);
    expect(err.message).not.toContain("nobody@example.test");
  });

  it("足す claim が無い、email の形が違うは 400", async () => {
    expect((await rejection(handleOp({ op: "set-claims", email: "a@example.test" }))).status).toBe(400);
    expect((await rejection(handleOp({ op: "set-claims", email: "not-an-email", operator: true }))).status).toBe(400);
  });
});

describe("create-invite", () => {
  it("平文を 1 度返し、文書は指紋の ID で平文を含まない", async () => {
    const res = await handleOp({ op: "create-invite", kind: "signup", maxUses: 5 });
    if (!res.ok || !("code" in res)) throw new Error("code が返るはず");

    expect(typeof res.code).toBe("string");
    expect(res.code.length).toBeGreaterThanOrEqual(12);
    expect(res.code).toBe(res.code.trim());

    const id = sha256(res.code.trim());
    const snap = await db.collection("invites").doc(id).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ kind: "signup", farmId: null, maxUses: 5, usedBy: [], expiresAt: null } satisfies Invite);
    expect(JSON.stringify(snap.data())).not.toContain(res.code);

    const all = await db.collection("invites").get();
    expect(all.size).toBe(1);
    expect(all.docs.map((d) => d.id + JSON.stringify(d.data())).join("")).not.toContain(res.code);
  });

  it("呼ぶたびに別のコード", async () => {
    const a = await handleOp({ op: "create-invite", kind: "signup", maxUses: 1 });
    const b = await handleOp({ op: "create-invite", kind: "signup", maxUses: 1 });
    if (!("code" in a) || !("code" in b)) throw new Error("code が返るはず");
    expect(a.code).not.toBe(b.code);
  });

  it("回数が 1 以上の整数でないとき、signup 以外のとき 400", async () => {
    for (const maxUses of [0, -1, 1.5, "5" as unknown as number]) {
      expect((await rejection(handleOp({ op: "create-invite", kind: "signup", maxUses }))).status).toBe(400);
    }
    expect((await rejection(handleOp({ op: "create-invite", kind: "farm" as "signup", maxUses: 1 }))).status).toBe(400);
    expect((await db.collection("invites").get()).size).toBe(0);
  });
});

describe("seed-sources", () => {
  const seeds: SourceSeed[] = [
    { prefCode: null, url: "https://example.test/a", kind: "maff_press", confirmedOn: "2026-11-03", note: null },
    { prefCode: "33", url: "https://example.test/b", kind: "pref_fixed", confirmedOn: "2026-11-03", note: "メモ" },
    { prefCode: "31", url: "https://example.test/c", kind: "pref_rss", confirmedOn: "2026-11-03", note: null },
  ];

  it("足りない行を足し、既存の行を上書きしない", async () => {
    const sourcesPath = writeSources(seeds);
    const idB = sha256(seeds[1]!.url).slice(0, 24);
    const existing = { ...seeds[1]!, note: "運営者が直した", id: idB, group: 1 as const, enabled: false, failureCount: 3 };
    await db.collection("sources").doc(idB).set(existing);

    const res = await handleOp({ op: "seed-sources" }, { sourcesPath });

    expect(res).toMatchObject({ ok: true, op: "seed-sources", added: 2, skipped: 1, total: 3 });
    expect((await db.collection("sources").doc(idB).get()).data()).toEqual(existing);

    for (const seed of [seeds[0]!, seeds[2]!]) {
      const id = sha256(seed.url).slice(0, 24);
      expect(id).toHaveLength(24);
      const data = (await db.collection("sources").doc(id).get()).data() as Source;
      expect(data).toEqual({
        ...seed,
        id,
        group: (parseInt(id.slice(0, 8), 16) % 3) as 0 | 1 | 2,
        enabled: true,
        lastCheckedAt: null,
        lastOkAt: null,
        etag: null,
        lastModified: null,
        fingerprint: null,
        failureCount: 0,
      } satisfies Source);
    }
  });

  it("2 回目は何も足さない", async () => {
    const sourcesPath = writeSources(seeds);
    await handleOp({ op: "seed-sources" }, { sourcesPath });
    const again = await handleOp({ op: "seed-sources" }, { sourcesPath });
    expect(again).toMatchObject({ added: 0, skipped: 3, total: 3 });
    expect((await db.collection("sources").get()).size).toBe(3);
  });

  it("URL の重複は 1 行だけ足す", async () => {
    const res = await handleOp({ op: "seed-sources" }, { sourcesPath: writeSources([seeds[0]!, seeds[0]!]) });
    expect(res).toMatchObject({ added: 1, skipped: 1, total: 2 });
  });

  it("同梱の sources.json が読めない、または形が違うときは 500 で何も足さない", async () => {
    expect((await rejection(handleOp({ op: "seed-sources" }, { sourcesPath: path.join(tmp, "none.json") }))).status).toBe(500);
    const bad = path.join(tmp, "bad.json");
    fs.writeFileSync(bad, JSON.stringify([{ url: "https://example.test/x" }]));
    expect((await rejection(handleOp({ op: "seed-sources" }, { sourcesPath: bad }))).status).toBe(500);
    expect((await db.collection("sources").get()).size).toBe(0);
  });
});

describe("set-setting", () => {
  const settings = () => db.collection("usage").doc("settings");

  it("文書が無ければ既定値で作って値を変える", async () => {
    const res = await handleOp({ op: "set-setting", key: "autoPublishEnabled", value: true });
    expect(res).toMatchObject({ ok: true, key: "autoPublishEnabled", value: true });
    expect((await settings().get()).data()).toEqual({ ...DEFAULT_RUNTIME_SETTINGS, autoPublishEnabled: true });
  });

  it("あれば他の値を残して変える", async () => {
    await settings().set({ ...DEFAULT_RUNTIME_SETTINGS, softLimitJpy: 1000 });
    await handleOp({ op: "set-setting", key: "primaryEffort", value: "high" });
    expect((await settings().get()).data()).toEqual({ ...DEFAULT_RUNTIME_SETTINGS, softLimitJpy: 1000, primaryEffort: "high" });
  });

  it("知らないキーを拒む（作らない）", async () => {
    const err = await rejection(handleOp({ op: "set-setting", key: "AGENT_EVAL_HIDE_PREFS", value: "x" }));
    expect(err.status).toBe(400);
    expect((await rejection(handleOp({ op: "set-setting", key: "toString", value: "x" }))).status).toBe(400);
    expect((await settings().get()).exists).toBe(false);
  });

  it("型の違う値を拒む（作らない）", async () => {
    const bad: Array<[string, unknown]> = [
      ["softLimitJpy", "abc"],
      ["softLimitJpy", Number.NaN],
      ["softLimitJpy", -1],
      ["jpyPerUsd", 0],
      ["autoPublishEnabled", "true"],
      ["primaryModel", 3],
      ["primaryModel", ""],
      ["primaryEffort", "ultra"],
    ];
    for (const [key, value] of bad) {
      expect((await rejection(handleOp({ op: "set-setting", key, value }))).status).toBe(400);
    }
    expect((await settings().get()).exists).toBe(false);
  });
});

describe("serveOps（HTTP の入口）", () => {
  function fakeReq(init: { method?: string; auth?: string; body?: unknown }) {
    return {
      method: init.method ?? "POST",
      get: (name: string) => (name.toLowerCase() === "authorization" ? init.auth : undefined),
      body: init.body,
    };
  }
  function fakeRes() {
    const out = { status: 0, body: undefined as unknown };
    const res = {
      status(code: number) {
        out.status = code;
        return res;
      },
      json(body: unknown) {
        out.body = body;
        return res;
      },
    };
    return { res, out };
  }
  async function call(init: Parameters<typeof fakeReq>[0], opts?: { sourcesPath?: string }) {
    const { res, out } = fakeRes();
    await serveOps(fakeReq(init), res, BEARER_VALUE, opts);
    return out;
  }

  it("認証なしは 401、値違いも 401。本文は処理しない", async () => {
    const body = { op: "set-setting", key: "autoPublishEnabled", value: true };
    expect((await call({ body })).status).toBe(401);
    expect((await call({ auth: "Bearer wrong", body })).status).toBe(401);
    expect((await db.collection("usage").doc("settings").get()).exists).toBe(false);
  });

  it("認証が通っても POST 以外は 405", async () => {
    expect((await call({ method: "GET", auth: `Bearer ${BEARER_VALUE}` })).status).toBe(405);
  });

  it("入力エラーは 400（未知の op、本文が無い、配列）", async () => {
    const auth = `Bearer ${BEARER_VALUE}`;
    expect((await call({ auth, body: { op: "drop-database" } })).status).toBe(400);
    expect((await call({ auth, body: undefined })).status).toBe(400);
    expect((await call({ auth, body: [] })).status).toBe(400);
    expect((await call({ auth, body: { op: "set-setting", key: "nope", value: 1 } })).status).toBe(400);
  });

  it("通れば 200 で結果を返し、認証の値を含まない", async () => {
    const body: OpRequest = { op: "create-invite", kind: "signup", maxUses: 2 };
    const out = await call({ auth: `Bearer ${BEARER_VALUE}`, body });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, op: "create-invite", maxUses: 2 });
    expect(JSON.stringify(out.body)).not.toContain(BEARER_VALUE);
  });

  it("想定外の失敗は 500 で、詳細を返さない", async () => {
    const out = await call(
      { auth: `Bearer ${BEARER_VALUE}`, body: { op: "seed-sources" } },
      { sourcesPath: path.join(tmp, "none.json") },
    );
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toContain(tmp);
  });
});
