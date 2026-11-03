import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { PREFS } from "@hpai/shared/pref";
import { addDays } from "@hpai/shared/dates";
import { clientIp, createRateLimiter } from "../src/api/rateLimit";
import { handleApi, serveApi, type ApiDeps } from "../src/api/handler";
import { FORBIDDEN_KEYS, NOW, POISON, findKeys, freshStatuses, makeBird, makeCase, makeDeps } from "./helpers/apiDeps";

type Body = { asOf: string; notices: string[]; sources: string[]; watch?: { okCount: number; failedPrefCodes: string[] }; data: any };
const get = async (deps: ApiDeps, p: string, query: Record<string, string | undefined> = {}, now = NOW) => {
  const r = await handleApi({ method: "GET", path: p, query }, deps, now);
  return { ...r, body: r.body as Body };
};

describe("/cases: 過去の資料", () => {
  const COUNTS: Array<[number, number]> = [[2020, 52], [2021, 25], [2022, 84], [2023, 11], [2024, 51], [2025, 24]];
  it.each(COUNTS)("season %i は %i 件（related:false だけ）。id は h{season}-{no}、confirmState は national", async (season, n) => {
    const { deps, calls } = await makeDeps();
    const r = await get(deps, "/api/v1/cases", { season: String(season) });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(n);
    for (const c of r.body.data) {
      expect(c.id).toMatch(new RegExp(`^h${season}-\\d+$`));
      expect(c.confirmState).toBe("national");
      expect(c.season).toBe(season);
    }
    expect(calls.cases).toBe(0); // 過去の資料があるシーズンは Firestore を読まない
  });

  it("pref で絞る。2025 の岡山は 1 件", async () => {
    const { deps } = await makeDeps();
    const r = await get(deps, "/api/v1/cases", { season: "2025", pref: "33" });
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].muniName).toBe("津山市");
  });

  it("過去のシーズンには pastDisclaimer が付く", async () => {
    const { deps } = await makeDeps();
    const r = await get(deps, "/cases", { season: "2025" });
    expect(r.body.notices).toContain(FIXED_TEXT.pastDisclaimer);
  });
});

describe("入力の検証と経路", () => {
  it.each([
    ["season=2019", { season: "2019" }],
    ["season=2027（来季）", { season: "2027" }],
    ["season=abc", { season: "abc" }],
    ["season=20255", { season: "20255" }],
    ["season が空", { season: "" }],
    ["season が重複（配列に変わった値）", { season: "\u0000" }],
    ["pref=00", { pref: "00" }],
    ["pref=48", { pref: "48" }],
    ["pref=1", { pref: "1" }],
    ["pref=abc", { pref: "abc" }],
  ])("%s は 400", async (_name, query) => {
    const { deps } = await makeDeps();
    for (const p of ["/api/v1/cases", ...(Object.keys(query).includes("season") ? ["/api/v1/wild-birds"] : [])]) {
      const r = await get(deps, p, query);
      expect(r.status).toBe(400);
      expect(r.headers["Cache-Control"]).toBe("no-store");
    }
  });

  it("GET 以外は 405（Allow: GET）。知らない path は 404", async () => {
    const { deps } = await makeDeps();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await handleApi({ method, path: "/api/v1/cases", query: {} }, deps, NOW);
      expect(r.status).toBe(405);
      expect(r.headers.Allow).toBe("GET");
    }
    for (const p of ["/api/v1/farms", "/api/v1/", "/api/v1/areas", "/api/v1/areas/33203/x", "/", "/api/v2/cases"]) {
      expect((await get(deps, p)).status).toBe(404);
    }
  });

  it("/areas: 数字 5 桁でなければ 400、知らないコードは 404（政令市の区も）。/api/v1 の有無どちらでも同じ", async () => {
    const { deps } = await makeDeps();
    expect((await get(deps, "/api/v1/areas/abc")).status).toBe(400);
    expect((await get(deps, "/api/v1/areas/3320")).status).toBe(400);
    expect((await get(deps, "/api/v1/areas/33203%20")).status).toBe(400);
    expect((await get(deps, "/api/v1/areas/99999")).status).toBe(404);
    expect(deps.geo.index["33101"]).toBeUndefined(); // 岡山市北区。区のコードは保存しない
    expect((await get(deps, "/api/v1/areas/33101")).status).toBe(404);
    expect((await get(deps, "/areas/33203")).status).toBe(200);
    expect((await get(deps, "/api/v1/areas/33203/")).status).toBe(200);
  });
});

describe("応答の共通の形", () => {
  it("どの応答にも asOf、sources、notices があり、notices に県の連絡と riskAnywhere。禁句がない", async () => {
    const { deps } = await makeDeps({ cases: [makeCase()], birds: [makeBird()] });
    for (const [p, q] of [
      ["/api/v1/cases", {}],
      ["/api/v1/cases", { season: "2025" }],
      ["/api/v1/areas/33203", {}],
      ["/api/v1/areas/01100", {}],
      ["/api/v1/wild-birds", {}],
      ["/api/v1/watch-status", {}],
    ] as const) {
      const r = await get(deps, p, q);
      expect(r.status, p).toBe(200);
      expect(r.body.asOf).toBe("2026-11-04T12:00:00+09:00");
      expect(Array.isArray(r.body.sources)).toBe(true);
      expect(r.body.notices).toContain(FIXED_TEXT.prefContactIsAuthority);
      expect(r.body.notices).toContain(FIXED_TEXT.riskAnywhere);
      expect(findForbiddenPhrases(JSON.stringify(r.body)), p).toEqual([]);
    }
  });

  it("成功は Cache-Control: public, max-age=60、どの応答も Access-Control-Allow-Origin: *。失敗は no-store", async () => {
    const { deps } = await makeDeps();
    const ok = await get(deps, "/api/v1/watch-status");
    expect(ok.headers["Cache-Control"]).toBe("public, max-age=60");
    expect(ok.headers["Access-Control-Allow-Origin"]).toBe("*");
    for (const r of [await get(deps, "/api/v1/cases", { season: "x" }), await get(deps, "/api/v1/nothing"), await handleApi({ method: "POST", path: "/cases", query: {} }, deps, NOW)]) {
      expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(r.headers["Cache-Control"]).toBe("no-store");
    }
  });

  it("今季の事例と野鳥には確認状況（watch）と、未確認は発生なしではないという文が付く", async () => {
    const { deps } = await makeDeps({ statuses: freshStatuses({ "33": { ok: false, failingSince: "2026-11-03T09:00:00+09:00" } }) });
    for (const p of ["/api/v1/cases", "/api/v1/wild-birds", "/api/v1/areas/33203"]) {
      const r = await get(deps, p);
      expect(r.body.watch?.okCount, p).toBe(46);
      expect(r.body.watch?.failedPrefCodes, p).toEqual(["33"]);
      expect(r.body.notices.join("\n"), p).toContain("46 件を確認、1 件は確認できていません（岡山県");
    }
    const area = await get(deps, "/api/v1/areas/33203");
    expect(area.body.notices.join("\n")).toContain("岡山県の見回りは直近で確認できていません");
  });
});

describe("/areas", () => {
  it("段階 4 の町でも 3 文（県の連絡、riskAnywhere、areaNoDistance）がある", async () => {
    const { deps } = await makeDeps();
    const r = await get(deps, "/api/v1/areas/33203");
    expect(r.body.data.level).toBe(4);
    expect(r.body.notices).toEqual(expect.arrayContaining([FIXED_TEXT.prefContactIsAuthority, FIXED_TEXT.riskAnywhere, FIXED_TEXT.areaNoDistance]));
    expect(r.body.data.sameMuniCases).toEqual([]);
  });

  it("geo.geometry を呼ばない（距離を見ない）", async () => {
    const { deps, calls } = await makeDeps({ cases: [makeCase(), makeCase({ id: "c2", muniCode: "33214", muniName: "美作市" })], birds: [makeBird()] });
    const r = await get(deps, "/api/v1/areas/33203");
    expect(r.body.data.level).toBe(1);
    expect(r.body.data.adjacentCases.map((c: { id: string }) => c.id)).toEqual(["c2"]);
    expect(r.body.data.wildBirds).toHaveLength(1);
    expect(calls.geometry).toBe(0);
  });

  it("確認中の事例は、市町村コードが入っていても sameMuniCases にも adjacentCases にも入らない", async () => {
    const { deps } = await makeDeps({
      cases: [makeCase({ id: "rev-1", confirmState: "reviewing", muniCode: "33203" }), makeCase({ id: "rev-2", confirmState: "reviewing", muniCode: "33214" })],
    });
    const r = await get(deps, "/api/v1/areas/33203");
    expect(r.body.data.level).toBe(4);
    expect(r.body.data.sameMuniCases).toEqual([]);
    expect(r.body.data.adjacentCases).toEqual([]);
  });

  it("移動制限の解除の後の同じ市町村は sameMuniLifted を添える。区域の中なら添えない", async () => {
    const lifted = makeCase({ stages: { confirmed: { date: "2026-10-01", time: null }, movement_lifted: { date: "2026-10-25", time: null } } });
    const a = await get((await makeDeps({ cases: [lifted] })).deps, "/api/v1/areas/33203");
    expect(a.body.data.level).toBe(2);
    expect(a.body.notices).toContain(FIXED_TEXT.sameMuniLifted);
    const b = await get((await makeDeps({ cases: [makeCase()] })).deps, "/api/v1/areas/33203");
    expect(b.body.data.level).toBe(1);
    expect(b.body.notices).not.toContain(FIXED_TEXT.sameMuniLifted);
  });

  it("今季の事例は Firestore から、前の季の事例は混ざらない", async () => {
    const { deps } = await makeDeps({ cases: [makeCase({ id: "old", season: 2025 })] });
    const r = await get(deps, "/api/v1/areas/33203");
    expect(r.body.data.level).toBe(4);
  });
});

describe("否定と野鳥と確認状況", () => {
  it("否定は negatedAt から 7 日は返り、8 日目に返らない", async () => {
    const day = (d: string) => `${d}T10:00:00+09:00`;
    const today = "2026-11-04";
    const { deps } = await makeDeps({
      cases: [
        makeCase({ id: "n7", negation: "negated", negatedAt: day(addDays(today, -7)) }),
        makeCase({ id: "n8", negation: "negated", negatedAt: day(addDays(today, -8)) }),
        makeCase({ id: "cand", negation: "candidate" }),
      ],
    });
    const ids = (await get(deps, "/api/v1/cases")).body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain("n7");
    expect(ids).not.toContain("n8");
    expect(ids).toContain("cand");
  });

  it("確認中は県名、確認中、リンクだけ。市町村、日付、羽数、用途を出さない", async () => {
    const { deps } = await makeDeps({
      cases: [makeCase({ id: "rev-x", confirmState: "reviewing", muniCode: null, muniName: null, headCount: 5000, birdUse: "採卵鶏", sourceUrls: ["https://www.pref.okayama.jp/a"] })],
    });
    const r = await get(deps, "/api/v1/cases");
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({
      id: "rev-x", prefCode: "33", confirmState: "reviewing", sourceUrls: ["https://www.pref.okayama.jp/a"],
      muniCode: null, muniName: null, headCount: null, birdUse: null, housing: null, stages: {}, updatedAt: null, negation: "none",
    });
    expect(JSON.stringify(r.body)).not.toContain("採卵鶏");
    expect(JSON.stringify(r.body)).not.toContain("2026-11-02");
  });

  it("/wild-birds は negative を返さない。検査中と確定は返る", async () => {
    const { deps } = await makeDeps({
      birds: [makeBird({ id: "b-neg", test: "negative" }), makeBird({ id: "b-scr", test: "screening_positive" }), makeBird({ id: "b-ok", test: "hpai_confirmed" })],
    });
    const ids = (await get(deps, "/api/v1/wild-birds")).body.data.map((b: { id: string }) => b.id).sort();
    expect(ids).toEqual(["b-ok", "b-scr"]);
  });

  it("/watch-status は 47 行と okCount、failedPrefCodes。記録のない県は未確認", async () => {
    const { deps } = await makeDeps({ statuses: freshStatuses().slice(0, 45).map((s, i) => (i === 3 ? { ...s, ok: false } : s)) });
    const r = await get(deps, "/api/v1/watch-status");
    expect(r.body.data.prefectures).toHaveLength(47);
    expect(r.body.data.prefectures.map((p: { prefCode: string }) => p.prefCode)).toEqual(PREFS.map((p) => p.code));
    expect(r.body.data.okCount).toBe(44);
    expect(r.body.data.failedCount).toBe(3);
    expect(r.body.data.failedPrefCodes).toEqual(["04", "46", "47"]);
    expect(r.body.data.prefectures[46]).toEqual({ prefCode: "47", checkedAt: null, ok: false, confirmed: false, lastOkAt: null, failingSince: null });
  });
});

describe("公開しない項目", () => {
  it("余分な項目を持つ文書でも、農場、地点、記録、会員の鍵がどの階層にも出ない", async () => {
    const { deps } = await makeDeps({
      cases: [
        makeCase({ ...POISON, stages: { confirmed: { date: "2026-11-02", time: null, ...POISON } as never } } as never),
        makeCase({ id: "c2", muniCode: "33214", ...POISON } as never),
        makeCase({ id: "rev-1", confirmState: "reviewing", ...POISON } as never),
      ],
      birds: [makeBird({ ...POISON } as never)],
      statuses: freshStatuses().map((s) => ({ ...s, ...POISON })),
    });
    for (const [p, q] of [
      ["/api/v1/cases", {}],
      ["/api/v1/areas/33203", {}],
      ["/api/v1/areas/33214", {}],
      ["/api/v1/wild-birds", {}],
      ["/api/v1/watch-status", {}],
    ] as const) {
      const r = await get(deps, p, q);
      expect(r.status).toBe(200);
      expect(findKeys(r.body, FORBIDDEN_KEYS), p).toEqual([]);
      const text = JSON.stringify(r.body);
      for (const marker of ["MARKER", "u-secret", "f-marker", "52334557", "00-0000-0000"]) expect(text, p).not.toContain(marker);
      expect(findKeys(r.body, ["operatorNote"]), p).toEqual([]);
    }
  });

  it("Firestore の読み取りが失敗したら 500（空の一覧を 200 で返さない）。中身は出さない", async () => {
    const { deps } = await makeDeps();
    const broken: ApiDeps = { ...deps, watchStatuses: async () => { throw new Error("SECRET-DETAIL"); } };
    const r = await get(broken, "/api/v1/cases");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("SECRET-DETAIL");
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });
});

describe("回数の制限", () => {
  it("同じ IP の 61 回目は false。次の分は通る。別の IP は別に数える", () => {
    const limit = createRateLimiter(60);
    const t = Date.UTC(2026, 10, 4, 3, 0, 5);
    for (let i = 0; i < 60; i++) expect(limit("203.0.113.1", t + i)).toBe("ok");
    expect(limit("203.0.113.1", t + 100)).toBe("ip");
    expect(limit("203.0.113.2", t + 100)).toBe("ok");
    expect(limit("203.0.113.1", t + 60_000)).toBe("ok");
  });

  it("clientIp は X-Forwarded-For の右端。IP の形でなければ unknown", () => {
    expect(clientIp("203.0.113.9, 10.0.0.1")).toBe("10.0.0.1"); // 右端。前段（Google）が付けた側。先頭は送り手が偽れる
    expect(clientIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientIp("2001:db8::1")).toBe("2001:db8:0:0::/64"); // IPv6 は /64 でまとめる
    expect(clientIp("<script>")).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });

  describe("serveApi（HTTP）", () => {
    let server: http.Server | undefined;
    afterEach(async () => {
      if (server) await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    });

    it("61 回目は 429（no-store、Retry-After）、次の分は 200", async () => {
      const { deps } = await makeDeps();
      let nowMs = NOW.getTime();
      const limiter = createRateLimiter(60);
      server = http.createServer((req, res) => void serveApi(req as never, res, { getDeps: async () => deps, limiter, now: () => new Date(nowMs) }));
      await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const hit = (ip = "203.0.113.50") => fetch(`${base}/api/v1/watch-status`, { headers: { "x-forwarded-for": ip } });
      for (let i = 0; i < 60; i++) expect((await hit()).status).toBe(200);
      const limited = await hit();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("cache-control")).toBe("no-store");
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(limited.headers.get("access-control-allow-origin")).toBe("*");
      expect((await hit("203.0.113.51")).status).toBe(200);
      nowMs += 60_000;
      const next = await hit();
      expect(next.status).toBe(200);
      expect(next.headers.get("cache-control")).toBe("public, max-age=60");
    });

    it("実際の query: 同じ鍵の重複は 400、season=2025 は 24 件", async () => {
      const { deps } = await makeDeps();
      server = http.createServer((req, res) => void serveApi(req as never, res, { getDeps: async () => deps, limiter: createRateLimiter(60), now: () => NOW }));
      await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(`${base}/api/v1/cases?season=2025&season=2024`)).status).toBe(400);
      const ok = await fetch(`${base}/api/v1/cases?season=2025`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as Body).data).toHaveLength(24);
    });

    it("依存を作れなければ 500", async () => {
      server = http.createServer((req, res) => void serveApi(req as never, res, { getDeps: async () => { throw new Error("x"); }, limiter: createRateLimiter(60), now: () => NOW }));
      await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/cases`);
      expect(res.status).toBe(500);
    });
  });
});
