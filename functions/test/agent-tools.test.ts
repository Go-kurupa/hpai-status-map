// 入口を直すエージェントの道具（X-14）。県の公式ドメイン、取得の関門、回数の上限、提案、対象の一覧。ネットワークへは出ない。
import fs from "node:fs";
import path from "node:path";
import { logger } from "firebase-functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPrefDomainHost } from "@hpai/shared/pref";
import type { SourceSeed } from "@hpai/shared/types";
import { canTakeCall, MAX_CALLS_PER_PREF, MAX_CALLS_TOTAL, readCallCount } from "../src/agent/limits";
import { buildPrefDomains, buildPrefDomainsLenient, isAllowedUrl, normalizeUrl, PREF_DOMAINS } from "../src/agent/prefDomains";
import { AgentToolError, createAgentTools, parseHidePrefs, type AgentToolDeps, type SourceRow } from "../src/agent/tools";
import type { FetchOutcome } from "../src/watch/politeFetch";
import { politeFetch } from "../src/watch/politeFetch";
import rawSeeds from "../../data/sources.json";

const seeds = rawSeeds as unknown as SourceSeed[];
const NOW = new Date("2026-11-05T03:00:00Z");

const okOutcome = (over: Partial<Extract<FetchOutcome, { kind: "ok" }>> = {}): FetchOutcome => ({
  kind: "ok",
  status: 200,
  finalUrl: "https://www.pref.okayama.jp/page/1.html",
  contentType: "text/html; charset=utf-8",
  body: Buffer.from("<html><head><title>題</title></head><body><p>本文</p><a href='/a'>リンク</a></body></html>", "utf8"),
  etag: null,
  lastModified: null,
  fetchedAt: "2026-11-05T12:00:00+09:00",
  ...over,
});

const SOURCES: SourceRow[] = [
  { prefCode: "33", url: "https://www.pref.okayama.jp/page/816850.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" },
  { prefCode: "33", url: "https://www.pref.okayama.jp/rss/10/site-3.xml", kind: "pref_rss", enabled: true, confirmedOn: "2026-11-03" },
  { prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/old.html", kind: "pref_fixed", enabled: false, confirmedOn: "2026-10-01" },
  { prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/ns/tss/kachikueisei/aviflu.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" },
  { prefCode: "28", url: "https://web.pref.hyogo.lg.jp/kf14/hw14_000000026.html", kind: "pref_fixed", enabled: true, confirmedOn: "2026-11-03" },
  { prefCode: null, url: "https://www.maff.go.jp/j/press/index.html", kind: "maff_press", enabled: true, confirmedOn: "2026-11-03" },
];

function harness(over: Partial<AgentToolDeps> = {}) {
  const fetchMock = vi.fn<AgentToolDeps["fetch"]>(async () => okOutcome());
  const reserveCall = vi.fn<AgentToolDeps["reserveCall"]>(async () => true);
  const enqueue = vi.fn<AgentToolDeps["enqueue"]>(async () => true);
  const deps: AgentToolDeps = {
    fetch: fetchMock,
    reserveCall,
    now: () => NOW,
    readSources: async () => SOURCES,
    readFailingSince: async () => new Map([["33", "2026-11-01T07:00:00+09:00"]]),
    hidePrefs: () => new Set(),
    enqueue,
    ...over,
  };
  return { tools: createAgentTools(deps), fetchMock, reserveCall, enqueue, deps };
}

describe("PREF_DOMAINS（data/sources.json から作る）", () => {
  it("47 都道府県すべてにあり、どれも県の公式ドメイン", () => {
    expect([...PREF_DOMAINS.keys()].sort()).toEqual(Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0")));
    for (const d of PREF_DOMAINS.values()) expect(isPrefDomainHost(d)).toBe(true);
    expect(new Set(PREF_DOMAINS.values()).size).toBe(47);
    expect(PREF_DOMAINS.get("33")).toBe("pref.okayama.jp");
    expect(PREF_DOMAINS.get("28")).toBe("pref.hyogo.lg.jp");
    expect(PREF_DOMAINS.get("13")).toBe("metro.tokyo.lg.jp");
  });

  it("入口の一覧の県の入口は、その県のドメインの中に収まる", () => {
    for (const s of seeds) if (s.prefCode !== null) expect(isAllowedUrl(s.prefCode, s.url), s.url).toBe(true);
  });
});

describe("buildPrefDomains の差し戻し", () => {
  const seed = (prefCode: string | null, url: string) => ({ prefCode, url });

  it("県の入口でない行（prefCode が null）は見ない", () => {
    expect(buildPrefDomains([seed(null, "https://www.maff.go.jp/x"), seed("33", "https://www.pref.okayama.jp/a")]).get("33")).toBe("pref.okayama.jp");
  });

  it.each([
    ["県の形でないホスト", [seed("33", "https://www.example.jp/a")]],
    ["先頭が「.」で区切られない", [seed("33", "https://evilpref.okayama.jp/a")]],
    ["形は合うが県の公式の表にない（他人の取ったドメイン）", [seed("33", "https://www.pref.attacker.jp/a")]],
    ["同じ県に別のドメインが混ざる", [seed("33", "https://www.pref.okayama.jp/a"), seed("33", "https://www.pref.hyogo.lg.jp/a")]],
    ["別の県が同じドメインを名乗る", [seed("33", "https://www.pref.okayama.jp/a"), seed("34", "https://www.pref.okayama.jp/b")]],
    ["URL を読み込めない", [seed("33", "not a url")]],
  ])("%s は例外", (_n, input) => {
    expect(() => buildPrefDomains(input)).toThrow();
  });
});

describe("入口の一覧に不正な行があっても、読み込みでは例外にしない（1 行の誤りで watchTick などほかの関数を止めない）", () => {
  const seed = (prefCode: string | null, url: string) => ({ prefCode, url });
  const mixed = [
    seed("33", "https://www.pref.okayama.jp/a"),
    seed("34", "https://www.pref.hiroshima.lg.jp/a"),
    seed("35", "https://www.example.jp/not-a-pref"), // 県の公式の形でない
    seed("36", "https://www.pref.tokushima.lg.jp/a"),
    seed("36", "https://www.pref.kagawa.lg.jp/b"), // 同じ県に別のドメイン
    seed("37", "not a url"),
  ];

  it("buildPrefDomainsLenient は例外を投げず、不正な行のある県を表から外して理由を返す。残りの県は使える", () => {
    const r = buildPrefDomainsLenient(mixed);
    expect([...r.domains.keys()].sort()).toEqual(["33", "34"]);
    expect(r.excluded.map((e) => e.prefCode).sort()).toEqual(["35", "36", "37"]);
    expect(r.excluded.every((e) => e.message.length > 0)).toBe(true);
  });

  it("別の県が同じドメインを名乗るときは、両方の県を外す", () => {
    const r = buildPrefDomainsLenient([seed("33", "https://www.pref.okayama.jp/a"), seed("34", "https://www.pref.okayama.jp/b"), seed("35", "https://www.pref.hyogo.lg.jp/c")]);
    expect([...r.domains.keys()]).toEqual(["35"]);
    expect(r.excluded.map((e) => e.prefCode).sort()).toEqual(["33", "34"]);
  });

  it("行の形が壊れていても（url が文字列でない）例外にしない", () => {
    expect(() => buildPrefDomainsLenient([{ prefCode: "33", url: 5 as never }, null as never, { prefCode: 33 as never, url: "https://www.pref.okayama.jp/" }])).not.toThrow();
  });

  it("厳密な buildPrefDomains は従来どおり例外（CI で差し戻す）", () => {
    expect(() => buildPrefDomains(mixed)).toThrow();
  });

  it("sources.json に不正な行があっても prefDomains の読み込みは例外にならず、logger.error に出し、その県だけ isAllowedUrl が常に false", async () => {
    vi.resetModules();
    vi.doMock("../../data/sources.json", () => ({
      default: [
        { prefCode: "33", url: "https://www.pref.okayama.jp/a", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null },
        { prefCode: "34", url: "https://www.example.jp/x", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null },
      ],
    }));
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const mod = await import("../src/agent/prefDomains");
      expect(mod.isAllowedUrl("33", "https://www.pref.okayama.jp/a")).toBe(true);
      expect(mod.isAllowedUrl("34", "https://www.example.jp/x")).toBe(false);
      expect(mod.isAllowedUrl("34", "https://www.pref.hiroshima.lg.jp/a")).toBe(false);
      expect(mod.PREF_DOMAINS.has("34")).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      expect(JSON.stringify(errorSpy.mock.calls)).toContain("34");
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock("../../data/sources.json");
      vi.resetModules();
    }
  });
});

describe("isAllowedUrl（県とドメインの束縛）", () => {
  it.each([
    ["33", "https://www.pref.okayama.jp/page/1.html"],
    ["33", "https://pref.okayama.jp/"],
    ["28", "https://web.pref.hyogo.lg.jp/kf14/x.html"],
    ["13", "https://www.sangyo-rodo.metro.tokyo.lg.jp/nourin/shoku/hpai"],
    ["33", "https://WWW.PREF.OKAYAMA.JP/a"],
    ["33", "https://www.pref.okayama.jp:443/a"], // 既定のポートは URL が落とす
  ])("通す: %s %s", (code, url) => {
    expect(isAllowedUrl(code, url)).toBe(true);
  });

  it.each([
    ["33", "https://pref.okayama.jp.evil.example/a"],
    ["33", "https://evilpref.okayama.jp/a"],
    ["34", "https://www.pref.okayama.jp/a"], // 別の県のドメイン
    ["33", "https://www.pref.hyogo.lg.jp/a"],
    ["33", "http://www.pref.okayama.jp/a"],
    ["33", "http://192.168.0.1/"],
    ["33", "https://user:pw" + "@www.pref.okayama.jp/x"],
    ["33", "https://www.pref.okayama.jp:8443/a"],
    ["33", "javascript:alert(1)"],
    ["33", "https://www.pref.okayama.jp./a"], // 末尾の「.」は通さない
    ["99", "https://www.pref.okayama.jp/a"], // 県の表にない
    ["33", "not a url"],
    ["33", ""],
  ])("拒む: %s %s", (code, url) => {
    expect(isAllowedUrl(code, url)).toBe(false);
  });

  it("URL のオブジェクトも受ける（リダイレクトの先の判定に使う）", () => {
    expect(isAllowedUrl("33", new URL("https://www.pref.okayama.jp/x"))).toBe(true);
    expect(isAllowedUrl("33", new URL("https://evil.example/x"))).toBe(false);
  });

  it("入口の一覧の URL は normalizeUrl で変わらない（承認の id は URL の文字列から決まるので、揺れると同じ入口が二重になる）", () => {
    const changed = seeds.filter((s) => normalizeUrl(s.url) !== s.url).map((s) => s.url);
    expect(changed).toEqual([]);
  });

  it("normalizeUrl はフラグメントを除き、読み込めなければ null", () => {
    expect(normalizeUrl("https://www.pref.okayama.jp/a#top")).toBe("https://www.pref.okayama.jp/a");
    expect(normalizeUrl("nope")).toBeNull();
  });
});

describe("fetchPrefPage の関門", () => {
  it.each([
    ["別のドメイン", "33", "https://evil.example/x"],
    ["似たドメイン", "33", "https://pref.okayama.jp.evil.example/x"],
    ["別の県のドメイン", "34", "https://www.pref.okayama.jp/x"],
    ["http", "33", "http://www.pref.okayama.jp/x"],
    ["ポート", "33", "https://www.pref.okayama.jp:8443/x"],
    ["利用者情報つき", "33", "https://user:pw" + "@www.pref.okayama.jp/x"],
    ["IP", "33", "http://192.168.0.1/"],
    ["javascript:", "33", "javascript:alert(1)"],
    ["県の表にない", "99", "https://www.pref.okayama.jp/x"],
    ["URL でない", "33", "not a url"],
  ])("%s は取得も回数の確保もせず domain_not_allowed", async (_n, code, url) => {
    const h = harness();
    expect(await h.tools.fetchPrefPage(code, url)).toMatchObject({ ok: false, error: "domain_not_allowed", text: null });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.reserveCall).not.toHaveBeenCalled();
  });

  it("県のドメインの中なら、回数を確保してから allowUrl つきで取る。allowUrl はその県の外を拒む", async () => {
    const h = harness();
    const r = await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/page/1.html");
    expect(r).toMatchObject({ ok: true, title: "題", error: null, truncated: false });
    expect(r.text).toContain("本文");
    expect(h.reserveCall).toHaveBeenCalledWith("33", NOW);
    const opts = h.fetchMock.mock.calls[0]?.[1];
    expect(opts?.allowUrl?.(new URL("https://www.pref.okayama.jp/other"))).toBe(true);
    expect(opts?.allowUrl?.(new URL("https://evil.example/"))).toBe(false);
    expect(opts?.allowUrl?.(new URL("https://www.pref.hyogo.lg.jp/"))).toBe(false);
    expect(opts?.allowUrl?.(new URL("http://www.pref.okayama.jp/"))).toBe(false);
  });

  it("回数の上限なら取得を呼ばず limit_reached", async () => {
    const h = harness({ reserveCall: vi.fn(async () => false) });
    expect(await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/a")).toMatchObject({ ok: false, error: "limit_reached", text: null });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("回数の確保に失敗したら取得せず例外（上限を数えられないときは取らない）", async () => {
    const h = harness({ reserveCall: vi.fn(async () => { throw new Error("firestore down"); }) });
    await expect(h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/a")).rejects.toThrow();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("リダイレクトが県の外へ向かうとき、外への要求は 0 回（本物の politeFetch で確かめる）", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const u = new URL(String(input));
        requested.push(u.href);
        if (u.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow:\n", { status: 200 });
        return new Response(null, { status: 302, headers: { location: "https://evil.example/landing" } });
      }),
    );
    const h = harness({ fetch: politeFetch });
    const r = await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/redirect-test");
    expect(r).toMatchObject({ ok: false, error: "domain_not_allowed" });
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((u) => new URL(u).hostname === "www.pref.okayama.jp")).toBe(true);
    expect(requested.some((u) => u.includes("evil.example"))).toBe(false);
  }, 15_000);

  it("TLS の失敗は tls_error で text が null。HTML と PDF 以外は unsupported_content_type", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce({ kind: "network_error", message: "m", code: "EPROTO", tls: true });
    expect(await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/b")).toMatchObject({ ok: false, error: "tls_error", text: null });
    h.fetchMock.mockResolvedValueOnce(okOutcome({ contentType: "image/png", body: Buffer.from("x") }));
    expect(await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/c.png")).toMatchObject({ ok: false, error: "unsupported_content_type", text: null });
  });

  it.each([
    [{ kind: "robots_denied" } as FetchOutcome, "robots_denied"],
    [{ kind: "http_error", status: 404 } as FetchOutcome, "http_404"],
    [{ kind: "http_error", status: 503, code: "robots_unavailable" } as FetchOutcome, "robots_unavailable"],
    [{ kind: "network_error", message: "m", code: null, tls: false } as FetchOutcome, "network_error"],
    [{ kind: "not_allowed", url: "https://evil.example/" } as FetchOutcome, "domain_not_allowed"],
  ])("取得の結果 %j は error %s", async (outcome, error) => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(outcome);
    expect(await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/a")).toMatchObject({ ok: false, error, text: null });
  });

  it("本文は 40,000 字まで。本文と links の直列化が 60,000 字を超えたら links を切って truncated", async () => {
    const html = `<html><head><title>題</title></head><body><p>${"あ".repeat(50_000)}</p>${Array.from({ length: 3000 }, (_, i) => `<a href="/p/${i}">リンク${i}</a>`).join("")}</body></html>`;
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(okOutcome({ body: Buffer.from(html, "utf8") }));
    const r = await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/page/1.html");
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect((r.text ?? "").length).toBe(40_000);
    expect(r.links.length).toBeLessThan(3000);
    expect(JSON.stringify({ text: r.text, links: r.links }).length).toBeLessThanOrEqual(60_000);
  });

  it("本文が 40,000 字以内で links も収まれば、切らない", async () => {
    const h = harness();
    const r = await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/page/1.html");
    expect(r.truncated).toBe(false);
    expect(r.links).toEqual([{ href: "https://www.pref.okayama.jp/a", text: "リンク" }]);
  });

  it("読み込めない PDF は ok にしない", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(okOutcome({ contentType: "application/pdf", body: Buffer.from("%PDF-broken") }));
    expect(await h.tools.fetchPrefPage("33", "https://www.pref.okayama.jp/a.pdf")).toMatchObject({ ok: false, error: "pdf_no_text" });
  });
});

describe("回数の上限（純粋な判定）", () => {
  it("県ごとに 61 回目、全体で 301 回目から取らない", () => {
    expect(MAX_CALLS_PER_PREF).toBe(60);
    expect(MAX_CALLS_TOTAL).toBe(300);
    expect(canTakeCall({ total: 59, byPref: { "33": 59 } }, "33")).toBe(true); // 60 回目
    expect(canTakeCall({ total: 60, byPref: { "33": 60 } }, "33")).toBe(false); // 61 回目
    expect(canTakeCall({ total: 60, byPref: { "33": 60 } }, "34")).toBe(true); // 別の県は別に数える
    expect(canTakeCall({ total: 299, byPref: {} }, "33")).toBe(true); // 300 回目
    expect(canTakeCall({ total: 300, byPref: {} }, "33")).toBe(false); // 301 回目
  });

  it("文書が空、壊れていても 0 回として読む", () => {
    expect(readCallCount(undefined)).toEqual({ total: 0, byPref: {} });
    expect(readCallCount({ total: "x", byPref: { "33": -1, "34": 2, "35": "a" } })).toEqual({ total: 0, byPref: { "33": 0, "34": 2, "35": 0 } });
  });
});

describe("proposeEntrance", () => {
  const good = { prefCode: "33", url: "https://www.pref.okayama.jp/page/999.html", kind: "pref_fixed" as const, rationale: "畜産課のページから辿った" };

  it("県のドメインの中で取得できる URL なら、確認の箱に entrance_proposal を入れ、同じ県と URL は同じ id", async () => {
    const h = harness();
    const a = await h.tools.proposeEntrance(good);
    const b = await h.tools.proposeEntrance({ ...good, url: `${good.url}#top` }); // フラグメントは同じ URL
    expect(a.id).toMatch(/^entr-[0-9a-f]{24}$/);
    expect(b).toEqual(a);
    expect(h.enqueue).toHaveBeenCalledWith(
      { id: a.id, kind: "entrance_proposal", prefCode: "33", oldUrl: "https://www.pref.okayama.jp/page/816850.html", proposedUrl: good.url, sourceKind: "pref_fixed", rationale: good.rationale },
      NOW,
    );
    expect(h.reserveCall).toHaveBeenCalledWith("33", NOW); // 確かめる取得も回数に数える
  });

  it("oldUrl は同じ種類の今の入口。種類が違う入口は巻き込まず、同じ種類がなければ null", async () => {
    const h = harness();
    await h.tools.proposeEntrance({ ...good, kind: "pref_rss", url: "https://www.pref.okayama.jp/rss/new.xml" });
    expect(h.enqueue.mock.calls[0]?.[0]).toMatchObject({ oldUrl: "https://www.pref.okayama.jp/rss/10/site-3.xml", sourceKind: "pref_rss" });
    await h.tools.proposeEntrance({ ...good, kind: "pref_press_list", url: "https://www.pref.okayama.jp/press.html" });
    expect(h.enqueue.mock.calls[1]?.[0]).toMatchObject({ oldUrl: null, sourceKind: "pref_press_list" });
  });

  it("RSS（XML）も、取得できれば提案にできる", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(okOutcome({ contentType: "application/rss+xml", body: Buffer.from("<rss/>") }));
    await expect(h.tools.proposeEntrance({ ...good, kind: "pref_rss", url: "https://www.pref.okayama.jp/rss/new.xml" })).resolves.toHaveProperty("id");
  });

  it.each([
    ["別のドメイン", { url: "https://evil.example/x" }],
    ["似たドメイン", { url: "https://pref.okayama.jp.evil.example/x" }],
    ["別の県のドメイン", { prefCode: "34" }],
    ["http", { url: "http://www.pref.okayama.jp/x" }],
    ["ポート", { url: "https://www.pref.okayama.jp:8443/x" }],
    ["利用者情報つき", { url: "https://user:pw" + "@www.pref.okayama.jp/x" }],
    ["javascript:", { url: "javascript:alert(1)" }],
    ["県の表にない", { prefCode: "99" }],
  ])("%s は取得も箱への書き込みもせず例外", async (_n, over) => {
    const h = harness();
    await expect(h.tools.proposeEntrance({ ...good, ...over })).rejects.toThrow(AgentToolError);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("kind が提案できる 3 つの外、根拠が空または 1000 字超なら例外", async () => {
    const h = harness();
    await expect(h.tools.proposeEntrance({ ...good, kind: "maff_press" as never })).rejects.toThrow(AgentToolError);
    await expect(h.tools.proposeEntrance({ ...good, rationale: "" })).rejects.toThrow(AgentToolError);
    await expect(h.tools.proposeEntrance({ ...good, rationale: "あ".repeat(1001) })).rejects.toThrow(AgentToolError);
    await expect(h.tools.proposeEntrance({ ...good, rationale: "あ".repeat(1000) })).resolves.toHaveProperty("id");
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("取得できない URL（404、通信の失敗、回数の上限）は例外で、箱に書かない", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce({ kind: "http_error", status: 404 });
    await expect(h.tools.proposeEntrance(good)).rejects.toThrow("unreachable:http_404");
    h.fetchMock.mockResolvedValueOnce({ kind: "network_error", message: "m", code: null, tls: false });
    await expect(h.tools.proposeEntrance(good)).rejects.toThrow(AgentToolError);
    const limited = harness({ reserveCall: vi.fn(async () => false) });
    await expect(limited.tools.proposeEntrance(good)).rejects.toThrow("limit_reached");
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(limited.enqueue).not.toHaveBeenCalled();
  });

  it("今の入口と同じ URL でも提案にできる（受け入れの試験で今の入口を隠した県が、同じ URL を見つける）", async () => {
    const h = harness({ hidePrefs: () => new Set(["33"]) });
    const url = "https://www.pref.okayama.jp/page/816850.html";
    await expect(h.tools.proposeEntrance({ ...good, url })).resolves.toHaveProperty("id");
    expect(h.enqueue.mock.calls[0]?.[0]).toMatchObject({ oldUrl: url, proposedUrl: url });
  });
});

describe("listEntranceTargets", () => {
  it("47 県。ドメインは表から、failingSince は watchStatus から、currentUrl は有効な pref_fixed の入口（確認日が新しいもの）", async () => {
    const t = await harness().tools.listEntranceTargets();
    expect(t).toHaveLength(47);
    expect(t.map((x) => x.prefCode)).toEqual(Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0")));
    const by = new Map(t.map((x) => [x.prefCode, x]));
    expect(by.get("33")).toEqual({ prefCode: "33", domain: "pref.okayama.jp", currentUrl: "https://www.pref.okayama.jp/page/816850.html", failingSince: "2026-11-01T07:00:00+09:00" });
    expect(by.get("01")?.currentUrl).toBe("https://www.pref.hokkaido.lg.jp/ns/tss/kachikueisei/aviflu.html"); // 無効な古い入口は見ない
    expect(by.get("28")?.failingSince).toBeNull();
    expect(by.get("02")?.currentUrl).toBeNull(); // 入口が無い県
  });

  it("AGENT_EVAL_HIDE_PREFS の県は currentUrl が null。ほかは変わらず、sources を読むだけで書かない", async () => {
    const h = harness({ hidePrefs: () => parseHidePrefs("33,01,02") });
    const by = new Map((await h.tools.listEntranceTargets()).map((x) => [x.prefCode, x]));
    for (const c of ["33", "01", "02"]) expect(by.get(c)?.currentUrl).toBeNull();
    expect(by.get("28")?.currentUrl).toBe("https://web.pref.hyogo.lg.jp/kf14/hw14_000000026.html");
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("parseHidePrefs は空白を許し、県の表にない値と空を捨てる", () => {
    expect([...parseHidePrefs(" 33, 01 ,02")].sort()).toEqual(["01", "02", "33"]);
    expect(parseHidePrefs("").size).toBe(0);
    expect(parseHidePrefs(undefined).size).toBe(0);
    expect([...parseHidePrefs("33,99,abc,3")]).toEqual(["33"]);
  });
});

describe("agent/ のソースの検査", () => {
  const dir = path.resolve(import.meta.dirname, "../src/agent");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("TLS の検証を緩める設定が、agent/ のどこにもない", () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/rejectUnauthorized|secureOptions|NODE_TLS_REJECT|legacy_?renegotiation|UNSAFE_LEGACY/i);
    }
  });

  it("tools.ts は fetch を直接呼ばず、取得はすべて deps.fetch（politeFetch）を通す", () => {
    const src = fs.readFileSync(path.join(dir, "tools.ts"), "utf8");
    expect(src).not.toMatch(/(?:await|return|=|\(|,)\s*fetch\(|globalThis\.fetch|https?\.request|\baxios\b|from "undici"/);
    expect(src).toMatch(/deps\.fetch\(/);
  });
});

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());
