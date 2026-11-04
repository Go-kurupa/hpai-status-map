import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("usage-status（読むだけ。--unpause が上限を越えたまま戻さないために使う）", () => {
  const NOW = new Date("2026-11-05T03:00:00Z"); // 日本時間 2026-11-05
  it("今月（日本時間）の費用と止める線を返す。設定がなければ既定の線", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 10600 });
    await db.doc("usage/2026-10").set({ estimatedJpy: 1 });
    expect(await handleOp({ op: "usage-status" }, { now: () => NOW })).toEqual({
      ok: true,
      op: "usage-status",
      month: "2026-11",
      estimatedJpy: 10600,
      hardLimitJpy: DEFAULT_RUNTIME_SETTINGS.hardLimitJpy,
    });
  });

  it("文書がなければ 0 円。月の境は日本時間（UTC の月末でも日本は翌月）。設定の上限を読む", async () => {
    await db.doc("usage/settings").set({ ...DEFAULT_RUNTIME_SETTINGS, hardLimitJpy: 12000 });
    expect(await handleOp({ op: "usage-status" }, { now: () => new Date("2026-11-30T16:00:00Z") })).toMatchObject({ month: "2026-12", estimatedJpy: 0, hardLimitJpy: 12000 });
  });

  it("書き込まない。余計な項目は 400", async () => {
    await handleOp({ op: "usage-status" }, { now: () => NOW });
    expect((await db.doc("usage/settings").get()).exists).toBe(false);
    expect((await rejection(handleOp({ op: "usage-status", extra: 1 } as never))).status).toBe(400);
  });
});

describe("watch-detail（入口ごとの確認の状態。読むだけ。ホスト名までで、パスも本文も返さない）", () => {
  const row = (over: Partial<Source>): Source => ({
    id: "x",
    prefCode: "13",
    url: "https://www.example.lg.jp/hidden-path/page?q=1",
    kind: "pref_fixed",
    confirmedOn: "2026-11-01",
    note: "内部メモ",
    group: 0,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: "etag-value",
    lastModified: null,
    fingerprint: "fp-value",
    failureCount: 0,
    ...over,
  });

  it("まだ回っていない、成功、失敗を見分け、県・種類・ホストの順に並べる。パス、etag、指紋、メモは返さない", async () => {
    await db.doc("sources/a").set(row({ id: "a", prefCode: "22", lastCheckedAt: "2026-11-04T17:32:00+09:00" }));
    await db.doc("sources/b").set(row({ id: "b", prefCode: "13", group: 1 }));
    await db.doc("sources/c").set(row({ id: "c", prefCode: "13", kind: "pref_rss", url: "https://rss.example.lg.jp/feed", lastCheckedAt: "2026-11-04T17:32:00+09:00", failureCount: 2 }));
    await db.doc("sources/d").set(row({ id: "d", prefCode: null, kind: "maff_press", url: "https://www.maff.go.jp/j/press/", enabled: false }));

    const res = await handleOp({ op: "watch-detail" });
    expect(res).toEqual({
      ok: true,
      op: "watch-detail",
      total: 4,
      sources: [
        { prefCode: null, kind: "maff_press", host: "www.maff.go.jp", group: 0, enabled: false, lastCheckedAt: null, failureCount: 0, result: "unchecked" },
        { prefCode: "13", kind: "pref_fixed", host: "www.example.lg.jp", group: 1, enabled: true, lastCheckedAt: null, failureCount: 0, result: "unchecked" },
        { prefCode: "13", kind: "pref_rss", host: "rss.example.lg.jp", group: 0, enabled: true, lastCheckedAt: "2026-11-04T17:32:00+09:00", failureCount: 2, result: "failing" },
        { prefCode: "22", kind: "pref_fixed", host: "www.example.lg.jp", group: 0, enabled: true, lastCheckedAt: "2026-11-04T17:32:00+09:00", failureCount: 0, result: "ok" },
      ],
    });
    const text = JSON.stringify(res);
    for (const leak of ["hidden-path", "etag-value", "fp-value", "内部メモ", "q=1"]) expect(text).not.toContain(leak);
  });

  it("書き込まない。余計な項目は 400。入口が 0 件なら total 0", async () => {
    expect(await handleOp({ op: "watch-detail" })).toEqual({ ok: true, op: "watch-detail", total: 0, sources: [] });
    await db.doc("sources/a").set(row({ id: "a" }));
    const before = (await db.doc("sources/a").get()).data();
    await handleOp({ op: "watch-detail" });
    expect((await db.doc("sources/a").get()).data()).toEqual(before);
    expect((await rejection(handleOp({ op: "watch-detail", extra: 1 } as never))).status).toBe(400);
  });

  it("Bearer の内側にある（認証なしは 401 で、読まない）", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await serveOps({ method: "POST", get: () => undefined, body: { op: "watch-detail" } }, res as never, BEARER_VALUE);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "認証できません" });
  });
});

describe("send-test-mail（運営者への試しの送信。宛先は設定の OPERATOR_EMAIL だけ）", () => {
  const NOW = new Date("2026-11-05T03:00:00Z"); // 日本時間 2026-11-05
  const OPERATOR = "operator@example.test";
  function deps(over: { send?: (to: string, mail: { subject: string; text: string }) => Promise<void> } = {}) {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    return {
      sent,
      opts: {
        now: () => NOW,
        operatorEmail: () => OPERATOR,
        sendMail: over.send ?? (async (to: string, mail: { subject: string; text: string }) => void sent.push({ to, ...mail })),
      },
    };
  }

  it("OPERATOR_EMAIL にだけ、固定の件名と本文（と時刻）で送り、{ sent: true } だけ返す。宛先を返さない", async () => {
    const { sent, opts } = deps();
    const res = await handleOp({ op: "send-test-mail" }, opts);
    expect(res).toEqual({ ok: true, op: "send-test-mail", sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OPERATOR);
    expect(sent[0]!.subject).toBe("【鳥インフル発生状況マップ】試しの送信");
    expect(sent[0]!.text).toContain("これは運営者の確認のための試しの送信です。");
    expect(sent[0]!.text).toContain("2026-11-05T12:00:00+09:00");
    expect(JSON.stringify(res)).not.toContain(OPERATOR);
  });

  it("引数で宛先を受け取らない（余計な項目は 400。送らない）", async () => {
    const { sent, opts } = deps();
    expect((await rejection(handleOp({ op: "send-test-mail", to: "evil@example.test" } as never, opts))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("1 日（日本時間）に 5 回まで。6 回目は送らずに 429。日が変われば数え直す", async () => {
    const { sent, opts } = deps();
    for (let i = 0; i < 5; i++) await handleOp({ op: "send-test-mail" }, opts);
    const err = await rejection(handleOp({ op: "send-test-mail" }, opts));
    expect(err.status).toBe(429);
    expect(sent).toHaveLength(5);

    // UTC では同じ日、日本時間では翌日（2026-11-06 00:30 JST）
    const next = { ...opts, now: () => new Date("2026-11-05T15:30:00Z") };
    expect(await handleOp({ op: "send-test-mail" }, next)).toMatchObject({ sent: true });
    expect(sent).toHaveLength(6);
  });

  it("送れなかったときは code だけ返す。宛先も原因の文も出さない。失敗も回数に数える", async () => {
    const boom = Object.assign(new Error(`rejected ${OPERATOR} secret-text`), { code: "EAUTH" });
    const { opts } = deps({ send: async () => { throw boom; } });
    const err = await rejection(handleOp({ op: "send-test-mail" }, opts));
    expect(err.status).toBe(500);
    expect(err.message).toContain("EAUTH");
    expect(err.message).not.toContain(OPERATOR);
    expect(err.message).not.toContain("secret-text");
    expect((await db.doc("usage/testMail").get()).data()).toMatchObject({ day: "2026-11-05", count: 1 });
  });

  it("code が無い・変な形の失敗は unknown", async () => {
    const { opts } = deps({ send: async () => { throw new Error(`x ${OPERATOR}`); } });
    const err = await rejection(handleOp({ op: "send-test-mail" }, opts));
    expect(err.message).toContain("unknown");
    expect(err.message).not.toContain(OPERATOR);
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

  describe("OpError でない失敗の汎用 catch（S-10）", () => {
    const SECRET_EMAIL = "member-private@example.com";
    /** handleOp の先で、OpError でない例外を投げさせる（seed-sources が opts.sourcesPath を読むときに投げる）。 */
    const throwing = (err: unknown) => ({
      get sourcesPath(): string {
        throw err;
      },
    });
    const seed = { auth: `Bearer ${BEARER_VALUE}`, body: { op: "seed-sources" } };

    it("500 で固定の文だけを返し、原因の文（email など）を応答にも記録にも出さない。記録は code だけ", async () => {
      const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      try {
        const err = Object.assign(new Error(`lookup failed for ${SECRET_EMAIL}`), { code: "auth/internal-error" });
        const out = await call(seed, throwing(err));
        expect(out.status).toBe(500);
        expect(out.body).toEqual({ ok: false, error: "内部エラーです" });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("opsAdmin failed", { code: "auth/internal-error" });
        expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET_EMAIL);
      } finally {
        spy.mockRestore();
      }
    });

    it("code のない例外・Error でない値でも 500。記録は code: unknown だけで、原因の文を出さない", async () => {
      const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      try {
        for (const err of [new Error(SECRET_EMAIL), SECRET_EMAIL, null]) {
          spy.mockClear();
          const out = await call(seed, throwing(err));
          expect(out.status).toBe(500);
          expect(out.body).toEqual({ ok: false, error: "内部エラーです" });
          expect(spy).toHaveBeenCalledWith("opsAdmin failed", { code: "unknown" });
          expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET_EMAIL);
        }
      } finally {
        spy.mockRestore();
      }
    });
  });
});
