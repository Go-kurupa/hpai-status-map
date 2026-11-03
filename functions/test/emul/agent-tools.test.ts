// 入口を直すエージェントの道具を、模擬環境の Firestore につないで確かめる（X-14）。回数の上限、提案の書き込み、sources が変わらないこと。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@hpai/shared/read/types";
import { db } from "../../src/admin";
import { callCountPath, MAX_CALLS_PER_PREF, MAX_CALLS_TOTAL, reserveAgentCall } from "../../src/agent/limits";
import { firestoreToolDeps } from "../../src/agent/store";
import { createAgentTools, parseHidePrefs } from "../../src/agent/tools";
import type { FetchOutcome } from "../../src/watch/politeFetch";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const NOW = new Date("2026-11-05T03:00:00Z"); // 日本時間 2026-11-05 12:00

const ok = (): FetchOutcome => ({
  kind: "ok",
  status: 200,
  finalUrl: "https://www.pref.okayama.jp/x",
  contentType: "text/html",
  body: Buffer.from("<title>t</title><p>本文</p>"),
  etag: null,
  lastModified: null,
  fetchedAt: "2026-11-05T12:00:00+09:00",
});

async function seedSources(): Promise<void> {
  const base = { group: 0, lastCheckedAt: null, lastOkAt: null, etag: null, lastModified: null, fingerprint: null, failureCount: 0, note: null };
  await db.doc("sources/s33").set({ ...base, id: "s33", prefCode: "33", url: "https://www.pref.okayama.jp/page/816850.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" });
  await db.doc("sources/s01").set({ ...base, id: "s01", prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/ns/tss/kachikueisei/aviflu.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" });
  await db.doc("sources/s02").set({ ...base, id: "s02", prefCode: "02", url: "https://www.pref.aomori.lg.jp/soshiki/nourin/chikusan/infuru.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" });
  await db.doc("watchStatus/33").set({ prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: "2026-11-01T07:00:00+09:00" });
  await db.doc("watchStatus/28").set({ prefCode: "28", ok: true, checkedAt: null, lastOkAt: null, failingSince: null });
}

const snapshotSources = async () => JSON.stringify((await db.collection("sources").get()).docs.map((d) => [d.id, d.data()]).sort());

describe("取得の回数の上限（usage/agent-calls-{YYYY-MM-DD}、日付は日本時間）", () => {
  it("県ごとに 60 回まで。61 回目は false で何も書かない。別の県は別に数える", async () => {
    for (let i = 0; i < MAX_CALLS_PER_PREF; i++) expect(await reserveAgentCall("33", NOW)).toBe(true);
    expect(await reserveAgentCall("33", NOW)).toBe(false);
    expect(await reserveAgentCall("34", NOW)).toBe(true);
    const doc = (await db.doc("usage/agent-calls-2026-11-05").get()).data();
    expect(doc).toEqual({ total: 61, byPref: { "33": 60, "34": 1 } });
  });

  it("全体で 300 回まで。301 回目は false", async () => {
    await db.doc("usage/agent-calls-2026-11-05").set({ total: MAX_CALLS_TOTAL - 1, byPref: { "01": 59, "02": 59, "03": 59, "04": 59, "05": 59 } });
    expect(await reserveAgentCall("33", NOW)).toBe(true); // 300 回目
    expect(await reserveAgentCall("34", NOW)).toBe(false); // 301 回目
    expect(((await db.doc("usage/agent-calls-2026-11-05").get()).data() as { total: number }).total).toBe(300);
  });

  it("同時に呼んでも上限を超えない", async () => {
    await db.doc("usage/agent-calls-2026-11-05").set({ total: 55, byPref: { "33": 55 } });
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveAgentCall("33", NOW)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(((await db.doc("usage/agent-calls-2026-11-05").get()).data() as { byPref: Record<string, number> }).byPref["33"]).toBe(60);
  });

  it("日が変われば（日本時間 0 時）数え直す", async () => {
    await db.doc("usage/agent-calls-2026-11-05").set({ total: 300, byPref: { "33": 60 } });
    const nextDay = new Date("2026-11-05T15:30:00Z"); // 日本時間 11-06 00:30
    expect(await reserveAgentCall("33", nextDay)).toBe(true);
    expect(callCountPath(nextDay)).toBe("usage/agent-calls-2026-11-06");
  });
});

describe("道具を Firestore につないだとき", () => {
  const rationale = "畜産課のページから辿った";

  it("proposeEntrance は reviewQueue に entrance_proposal（resolvedAt:null、oldUrl は今の入口）を入れる。同じ県と URL は 1 件で同じ id。sources は変わらない", async () => {
    await seedSources();
    const before = await snapshotSources();
    const tools = createAgentTools(firestoreToolDeps(() => new Set(), { fetch: vi.fn(async () => ok()), now: () => NOW }));
    const url = "https://www.pref.okayama.jp/page/999999.html";
    const a = await tools.proposeEntrance({ prefCode: "33", url, kind: "pref_fixed", rationale });
    const b = await tools.proposeEntrance({ prefCode: "33", url, kind: "pref_fixed", rationale: "別の文" });
    expect(b).toEqual(a);
    expect(a.id).toMatch(/^entr-[0-9a-f]{24}$/);

    const queue = (await db.collection("reviewQueue").get()).docs.map((d) => d.data() as ReviewItem);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: a.id,
      kind: "entrance_proposal",
      prefCode: "33",
      oldUrl: "https://www.pref.okayama.jp/page/816850.html",
      proposedUrl: url,
      sourceKind: "pref_fixed",
      rationale,
      resolvedAt: null,
    });
    expect(await snapshotSources()).toBe(before);
  });

  it("県のドメインの外の URL、取得できない URL は例外で、箱にも sources にも書かない", async () => {
    await seedSources();
    const before = await snapshotSources();
    const fetchMock = vi.fn(async (): Promise<FetchOutcome> => ({ kind: "http_error", status: 404 }));
    const tools = createAgentTools(firestoreToolDeps(() => new Set(), { fetch: fetchMock, now: () => NOW }));
    await expect(tools.proposeEntrance({ prefCode: "33", url: "https://evil.example/x", kind: "pref_fixed", rationale })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(tools.proposeEntrance({ prefCode: "33", url: "https://www.pref.okayama.jp/gone", kind: "pref_fixed", rationale })).rejects.toThrow();
    expect((await db.collection("reviewQueue").get()).size).toBe(0);
    expect(await snapshotSources()).toBe(before);
  });

  it("listEntranceTargets は 47 県で、failingSince は watchStatus から", async () => {
    await seedSources();
    const tools = createAgentTools(firestoreToolDeps(() => new Set(), { now: () => NOW }));
    const t = await tools.listEntranceTargets();
    expect(t).toHaveLength(47);
    const by = new Map(t.map((x) => [x.prefCode, x]));
    expect(by.get("33")).toMatchObject({ domain: "pref.okayama.jp", currentUrl: "https://www.pref.okayama.jp/page/816850.html", failingSince: "2026-11-01T07:00:00+09:00" });
    expect(by.get("28")?.failingSince).toBeNull();
    expect(by.get("47")?.currentUrl).toBeNull();
  });

  it("AGENT_EVAL_HIDE_PREFS=33,01,02 の県は currentUrl が null で、sources は変わらない", async () => {
    await seedSources();
    const before = await snapshotSources();
    const tools = createAgentTools(firestoreToolDeps(() => parseHidePrefs("33,01,02"), { now: () => NOW }));
    const by = new Map((await tools.listEntranceTargets()).map((x) => [x.prefCode, x]));
    for (const c of ["33", "01", "02"]) expect(by.get(c)?.currentUrl).toBeNull();
    expect(await snapshotSources()).toBe(before);
  });

  it("県の上限（60 回）を超えたら取得 0 回で limit_reached。ドメインの外は回数にも数えない", async () => {
    const fetchMock = vi.fn(async () => ok());
    const tools = createAgentTools(firestoreToolDeps(() => new Set(), { fetch: fetchMock, now: () => NOW }));
    await db.doc("usage/agent-calls-2026-11-05").set({ total: 60, byPref: { "33": 60 } });
    expect(await tools.fetchPrefPage("33", "https://www.pref.okayama.jp/a")).toMatchObject({ ok: false, error: "limit_reached" });
    expect(await tools.fetchPrefPage("33", "https://evil.example/a")).toMatchObject({ ok: false, error: "domain_not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(((await db.doc("usage/agent-calls-2026-11-05").get()).data() as { total: number }).total).toBe(60);
    // 別の県は取れる
    expect(await tools.fetchPrefPage("34", "https://www.pref.hiroshima.lg.jp/a")).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
