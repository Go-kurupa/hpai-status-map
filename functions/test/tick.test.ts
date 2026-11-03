import { describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import type { Source, SourceKind } from "@hpai/shared/types";
import type { FetchOutcome } from "../src/watch/politeFetch";
import { checkMaffSeason } from "../src/watch/maff";
import { fingerprint } from "../src/watch/extract";
import { jstHour, runTick, sourcePatch, type CheckResult, type Handlers, type TickIo, type WatchDeps } from "../src/watch/tick";

function src(id: string, group: 0 | 1 | 2, o: Partial<Source> = {}): Source {
  return {
    id,
    prefCode: null,
    url: `https://www.maff.go.jp/${id}.html`,
    kind: "maff_press",
    confirmedOn: "2026-11-03",
    note: null,
    group,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 0,
    ...o,
  };
}

function makeIo(sources: Source[]) {
  const patches: Array<{ id: string; patch: Partial<Source> }> = [];
  const io: TickIo = {
    listSources: async () => sources,
    updateSource: async (id, patch) => {
      patches.push({ id, patch });
    },
  };
  return { io, patches };
}

const geo = {} as GeoStore;
/** JST の時刻 hour 時（UTC は 9 時間前）。 */
const at = (hourJst: number, day = "2026-11-05") => new Date(new Date(`${day}T00:00:00+09:00`).getTime() + hourJst * 3_600_000);

function deps(fetchFn: WatchDeps["fetch"], now: Date): WatchDeps {
  return { fetch: fetchFn, now: () => now, geo };
}
const noFetch: WatchDeps["fetch"] = async () => {
  throw new Error("取得してはいけない");
};

const okResult = (o: Partial<CheckResult> = {}): CheckResult => ({ ok: true, etag: null, lastModified: null, fingerprint: null, ...o });

describe("jstHour", () => {
  it("UTC の 15 時は JST の 0 時、UTC の 0 時は JST の 9 時", () => {
    expect(jstHour(new Date("2026-11-05T15:00:00Z"))).toBe(0);
    expect(jstHour(new Date("2026-11-05T00:00:00Z"))).toBe(9);
    expect(jstHour(new Date("2026-11-05T14:59:00Z"))).toBe(23);
  });
});

describe("runTick: 3 時間で全部を 1 回ずつ", () => {
  const sources = [src("a0", 0), src("b0", 0), src("a1", 1), src("a2", 2), src("off", 1, { enabled: false })];
  it("JST の時 % 3 が group と等しい入口だけを回り、無効は回らない", async () => {
    const seen: string[] = [];
    const handlers: Handlers = { maff_press: async (s) => (seen.push(s.id), okResult()) };
    for (const [hour, expected] of [
      [0, ["a0", "b0"]],
      [1, ["a1"]],
      [2, ["a2"]],
      [3, ["a0", "b0"]],
      [10, ["a1"]],
      [23, ["a2"]],
    ] as const) {
      seen.length = 0;
      const { io } = makeIo(sources);
      await runTick(deps(noFetch, at(hour)), io, handlers);
      expect(seen, `${hour} 時`).toEqual(expected);
    }
  });
  it("0〜2 時の 3 回で、有効な入口がちょうど 1 回ずつ", async () => {
    const seen: string[] = [];
    const handlers: Handlers = { maff_press: async (s) => (seen.push(s.id), okResult()) };
    for (const hour of [6, 7, 8]) await runTick(deps(noFetch, at(hour)), makeIo(sources).io, handlers);
    expect(seen.sort()).toEqual(["a0", "a1", "a2", "b0"]);
  });
  it("実装のない種類は飛ばし、失敗にも数えず、書き込まない", async () => {
    const { io, patches } = makeIo([src("pref", 0, { kind: "pref_fixed", prefCode: "33" })]);
    const report = await runTick(deps(noFetch, at(0)), io, {});
    expect(patches).toEqual([]);
    expect(report.skipped).toEqual(["pref"]);
    expect(report.checked).toEqual([]);
  });
  it("1 つの入口が throw しても、他の入口は回り、throw した入口は失敗に数える", async () => {
    const { io, patches } = makeIo([src("bad", 0, { failureCount: 1 }), src("good", 0)]);
    const handlers: Handlers = {
      maff_press: async (s) => {
        if (s.id === "bad") throw new Error("想定外");
        return okResult();
      },
    };
    const report = await runTick(deps(noFetch, at(0)), io, handlers);
    expect(patches.find((p) => p.id === "bad")!.patch).toMatchObject({ failureCount: 2 });
    expect(patches.find((p) => p.id === "good")!.patch).toMatchObject({ failureCount: 0 });
    expect(report.checked.map((c) => [c.id, c.ok])).toEqual([["bad", false], ["good", true]]);
  });
});

describe("sourcePatch", () => {
  const now = at(0);
  it("成功は失敗の数を 0 に戻し、etag、lastModified、指紋を保存する", () => {
    const p = sourcePatch(src("a", 0, { failureCount: 3 }), okResult({ etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" }), now);
    expect(p).toMatchObject({ failureCount: 0, etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" });
    expect(p.lastCheckedAt).toBe("2026-11-05T00:00:00+09:00");
    expect(p.lastOkAt).toBe("2026-11-05T00:00:00+09:00");
  });
  it("失敗は failureCount + 1 と最後に調べた時刻だけ。etag、指紋、最後に成功した時刻は変えない", () => {
    const p = sourcePatch(src("a", 0, { failureCount: 3, etag: "e", fingerprint: "f", lastOkAt: "2026-11-04T00:00:00+09:00" }), okResult({ ok: false }), now);
    expect(p).toEqual({ failureCount: 4, lastCheckedAt: "2026-11-05T00:00:00+09:00" });
  });
});

describe("国の入口の失敗は failureCount + 1 で、再試行しない", () => {
  const outcomes: Array<[string, FetchOutcome]> = [
    ["network_error", { kind: "network_error", message: "timeout", code: "ETIMEDOUT", tls: false }],
    ["network_error（tls）", { kind: "network_error", message: "handshake", code: "EPROTO", tls: true }],
    ["http_error", { kind: "http_error", status: 503 }],
    ["robots_denied", { kind: "robots_denied" }],
    ["not_allowed", { kind: "not_allowed", url: "https://evil.example.com/" }],
  ];
  for (const [name, outcome] of outcomes) {
    for (const kind of ["maff_press", "maff_season"] as const satisfies readonly SourceKind[]) {
      it(`${kind} / ${name}`, async () => {
        let calls = 0;
        const fetchFn: WatchDeps["fetch"] = async () => (calls++, outcome);
        const { io, patches } = makeIo([src("n", 0, { kind, failureCount: 2, etag: 'W/"keep"' })]);
        const { maffHandlers } = await import("../src/watch/maff");
        const report = await runTick(deps(fetchFn, at(0)), io, maffHandlers);
        expect(calls).toBe(1);
        expect(patches).toEqual([{ id: "n", patch: { failureCount: 3, lastCheckedAt: "2026-11-05T00:00:00+09:00" } }]);
        expect(report.checked).toEqual([{ id: "n", kind, ok: false }]);
      });
    }
  }
  it("not_modified は成功（失敗を 0 に戻し、etag は変えない）", async () => {
    let seen: { etag?: string | null; lastModified?: string | null } | undefined;
    const fetchFn: WatchDeps["fetch"] = async (_url, opts) => {
      seen = opts;
      return { kind: "not_modified" };
    };
    const { io, patches } = makeIo([src("n", 0, { failureCount: 2, etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" })]);
    const { maffHandlers } = await import("../src/watch/maff");
    await runTick(deps(fetchFn, at(0)), io, maffHandlers);
    expect(seen).toMatchObject({ etag: 'W/"1"', lastModified: "Mon" });
    expect(patches[0]!.patch).toMatchObject({ failureCount: 0, etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" });
  });
});

describe("今季ページの指紋が変わった tick は、報道発表を前倒しで確認する", () => {
  const seasonHtml = (body: string) => `<html><head><title>令和8年度 鳥インフルエンザに関する情報</title></head><body><main><p>${body}</p></main></body></html>`;
  const ok = (html: string, etag = 'W/"2"'): FetchOutcome => ({
    kind: "ok",
    status: 200,
    finalUrl: "https://www.maff.go.jp/season.html",
    contentType: "text/html",
    body: Buffer.from(html),
    etag,
    lastModified: null,
    fetchedAt: "2026-11-05T00:00:00+09:00",
  });

  it("指紋が変わったら、別の group の報道発表を同じ tick で回す", async () => {
    const before = fingerprint("令和8年度 鳥インフルエンザに関する情報 古い");
    const { io } = makeIo([src("season", 0, { kind: "maff_season", fingerprint: before }), src("press", 1)]);
    const pressCalls: string[] = [];
    const handlers: Handlers = { maff_season: checkMaffSeason, maff_press: async (s) => (pressCalls.push(s.id), okResult()) };
    const report = await runTick(deps(async () => ok(seasonHtml("新しい発生")), at(0)), io, handlers);
    expect(pressCalls).toEqual(["press"]);
    expect(report.early).toEqual(["press"]);
  });
  it("指紋が同じ、または前回の指紋がない（初回）なら前倒ししない", async () => {
    const same = fingerprint("変わらない");
    for (const prev of [same, null]) {
      const { io } = makeIo([src("season", 0, { kind: "maff_season", fingerprint: prev }), src("press", 1)]);
      const pressCalls: string[] = [];
      const handlers: Handlers = { maff_season: checkMaffSeason, maff_press: async (s) => (pressCalls.push(s.id), okResult()) };
      const html = seasonHtml("変わらない");
      const report = await runTick(deps(async () => ok(html), at(0)), io, handlers);
      expect(pressCalls, String(prev)).toEqual([]);
      expect(report.early).toEqual([]);
    }
  });
  it("前倒しの対象がその tick で既に回った入口なら、2 度回さない", async () => {
    const { io } = makeIo([src("season", 0, { kind: "maff_season", fingerprint: "old" }), src("press", 0)]);
    const pressCalls: string[] = [];
    const handlers: Handlers = { maff_season: checkMaffSeason, maff_press: async (s) => (pressCalls.push(s.id), okResult()) };
    const report = await runTick(deps(async () => ok(seasonHtml("新しい")), at(0)), io, handlers);
    expect(pressCalls).toEqual(["press"]);
    expect(report.early).toEqual([]);
  });
  it("今季ページの取得に失敗したときは前倒ししない", async () => {
    const { io } = makeIo([src("season", 0, { kind: "maff_season", fingerprint: "old" }), src("press", 1)]);
    const pressCalls: string[] = [];
    const handlers: Handlers = { maff_season: checkMaffSeason, maff_press: async (s) => (pressCalls.push(s.id), okResult()) };
    await runTick(deps(async () => ({ kind: "http_error", status: 500 }), at(0)), io, handlers);
    expect(pressCalls).toEqual([]);
  });
});
