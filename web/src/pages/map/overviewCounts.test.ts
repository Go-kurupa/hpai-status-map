import { createGeoStore, distanceToMuniKm, type GeoStore } from "@hpai/shared/geo";
import { pastCasesOf } from "@hpai/shared/history";
import { isWithinDistanceBand } from "@hpai/shared/level";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import type { Case, HistoryCase, WildBird } from "@hpai/shared/types";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import historyJson from "../../../../data/history/cases.json";
import { casesWithinBand, countRecentDays, frequentTownCounts, nearbyPastByCenter, nearbyPastFromMesh, pastRangeToDate, pastSeasonsOf, rangeText, RECENT_DAYS, wildBirdCounts } from "./overviewCounts";

const history = historyJson as HistoryCase[];

function mkCase(o: Partial<Case> = {}): Case {
  return {
    id: "c1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-02T12:00:00+09:00",
    ...o,
  };
}

function mkHistory(o: Partial<HistoryCase> = {}): HistoryCase {
  return {
    season: 2025,
    no: 1,
    prefCode: "33",
    muniCode: "33203",
    muniNameThen: "津山市",
    date: "2025-11-01",
    birdUse: null,
    housing: null,
    headCount: 1000,
    sourceUrl: "https://example.invalid/h",
    related: false,
    ...o,
  };
}

const on = (date: string) => ({ confirmed: { date, time: null } });

describe("直近 14 日の件数", () => {
  const TODAY = "2026-11-20";
  const count = (cases: Case[]) => countRecentDays(cases, 2026, TODAY);

  it("今日を含めて 14 日。13 日前は入り、14 日前は入らない", () => {
    expect(RECENT_DAYS).toBe(14);
    expect(count([mkCase({ stages: on("2026-11-07") })])).toBe(1);
    expect(count([mkCase({ stages: on("2026-11-06") })])).toBe(0);
    expect(count([mkCase({ stages: on(TODAY) })])).toBe(1);
  });

  it("未来の日付は入れない", () => {
    expect(count([mkCase({ stages: on("2026-11-21") })])).toBe(0);
  });

  it("確認中と否定は数えない。否定の候補は数える", () => {
    expect(count([mkCase({ stages: on(TODAY), confirmState: "reviewing" })])).toBe(0);
    expect(count([mkCase({ stages: on(TODAY), negation: "negated" })])).toBe(0);
    expect(count([mkCase({ stages: on(TODAY), negation: "candidate" })])).toBe(1);
  });

  it("疑いだけの事例は疑いの日で数える", () => {
    expect(count([mkCase({ stages: { suspected: { date: "2026-11-19", time: null } } })])).toBe(1);
  });

  it("日付のない事例は数える（少ない側に倒さない。今日までの件数と同じ扱い）", () => {
    expect(count([mkCase({ stages: {} })])).toBe(1);
  });

  it("別のシーズンは数えない", () => {
    expect(count([mkCase({ season: 2025, stages: on(TODAY) })])).toBe(0);
  });
});

describe("過去のシーズンの同じ日までの幅", () => {
  it("最小と最大。関連農場は数えず、同じ日を含む", () => {
    const rows = [
      mkHistory({ season: 2024, no: 1, date: "2024-11-05" }),
      mkHistory({ season: 2024, no: 2, date: "2024-10-20" }),
      mkHistory({ season: 2024, no: 3, date: "2024-12-01" }),
      mkHistory({ season: 2025, no: 1, date: "2025-11-05" }),
      mkHistory({ season: 2025, no: 2, date: "2025-11-01", related: true }),
    ];
    expect(pastRangeToDate(rows, "2026-11-05")).toEqual({ seasons: 2, min: 1, max: 2 });
  });

  it("途中に件数のないシーズンがあれば、0 件として幅に入れる", () => {
    const rows = [mkHistory({ season: 2023, no: 1, date: "2023-11-01" }), mkHistory({ season: 2025, no: 1, date: "2025-11-01" })];
    expect(pastRangeToDate(rows, "2026-11-05")).toEqual({ seasons: 3, min: 0, max: 1 });
  });

  it("関連農場だけのシーズンは 0 件", () => {
    const rows = [mkHistory({ season: 2024, no: 1, date: "2024-11-01", related: true }), mkHistory({ season: 2025, no: 1, date: "2025-11-01" })];
    expect(pastRangeToDate(rows, "2026-11-05")).toEqual({ seasons: 2, min: 0, max: 1 });
  });

  it("6 シーズンより古いものは入れず、今季と先のシーズンも入れない", () => {
    const rows = [
      mkHistory({ season: 2019, no: 1, date: "2019-11-01" }),
      mkHistory({ season: 2020, no: 1, date: "2020-11-01" }),
      mkHistory({ season: 2026, no: 1, date: "2026-11-01" }),
    ];
    expect(pastSeasonsOf(rows, 2026)).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
    expect(pastRangeToDate(rows, "2026-11-05")).toEqual({ seasons: 6, min: 0, max: 1 });
  });

  it("過去の記録がなければ null（0 件にしない）", () => {
    expect(pastRangeToDate([], "2026-11-05")).toBeNull();
    expect(pastSeasonsOf([], 2026)).toEqual([]);
  });

  it("実データの 2026 年 11 月 5 日は 6 シーズン", () => {
    const r = pastRangeToDate(history, "2026-11-05")!;
    expect(r.seasons).toBe(6);
    expect(r.min).toBeLessThanOrEqual(r.max);
  });

  it("幅の文は多い少ないを言わない。下限が 0 でも「0 件」とだけは読ませない", () => {
    expect(rangeText({ seasons: 6, min: 0, max: 12 })).toBe("0〜12 件");
    expect(rangeText({ seasons: 6, min: 3, max: 3 })).toBe("3 件");
  });
});

describe("約 60km 以内の件数", () => {
  const geoDir = path.resolve(import.meta.dirname, "../../../../data/geo");
  function store(): { geo: GeoStore; loaded: string[] } {
    const loaded: string[] = [];
    const geo = createGeoStore({
      index: indexJson as unknown as GeoStore["index"],
      adjacency: adjacencyJson as GeoStore["adjacency"],
      loadPrefTopo: vi.fn(async (p: string) => {
        loaded.push(p);
        return JSON.parse(readFileSync(path.join(geoDir, "pref", `${p}.topo.json`), "utf8")) as unknown;
      }),
    });
    return { geo, loaded };
  }
  const MESH = latLngToMesh3(35.07, 134.0); // 津山市のあたり

  it("同じ町、輪の中の町は入り、遠い町は入らない。町が分からない事例は距離に入れない", async () => {
    const { geo } = store();
    const n = await casesWithinBand(
      MESH,
      [
        mkCase({ id: "same", muniCode: "33203" }),
        mkCase({ id: "okayama", muniCode: "33100", muniName: "岡山市" }),
        mkCase({ id: "sapporo", prefCode: "01", muniCode: "01100", muniName: "札幌市" }),
        mkCase({ id: "unknown", muniCode: null, muniName: null }),
      ],
      geo,
    );
    expect(n).toBe(2);
  });

  it("枠で絞るので、遠い県の形を読まない", async () => {
    const { geo, loaded } = store();
    await casesWithinBand(MESH, [mkCase({ prefCode: "01", muniCode: "01100" }), mkCase({ prefCode: "33", muniCode: "33203" })], geo);
    expect(loaded).toEqual(["33"]);
  });

  it("枠で絞っても、全部の形を読んで計算した結果と同じ（過去の全事例で、地点を変えて確かめる）", async () => {
    const past = pastCasesOf(history);
    const { geo } = store();
    await geo.ensurePrefs([...new Set(past.map((c) => c.muniCode!.slice(0, 2)))]);
    const meshes = [MESH, latLngToMesh3(43.06, 141.35), latLngToMesh3(36.3, 140.4), latLngToMesh3(31.9, 131.4)];
    for (const mesh of meshes) {
      const full = past.filter((c) => isWithinDistanceBand(distanceToMuniKm(mesh, c.muniCode!, geo))).length;
      expect(await casesWithinBand(mesh, past, geo)).toBe(full);
    }
  });

  it("形を読めなければ投げる（0 件にしない）。知らない町でも投げる", async () => {
    const geo = createGeoStore({
      index: indexJson as unknown as GeoStore["index"],
      adjacency: adjacencyJson as GeoStore["adjacency"],
      loadPrefTopo: () => Promise.reject(new Error("読めない")),
    });
    await expect(casesWithinBand(MESH, [mkCase()], geo)).rejects.toThrow();
    const { geo: real } = store();
    await expect(casesWithinBand(MESH, [mkCase({ muniCode: "33999" })], real)).rejects.toThrow();
  });
});

describe("周辺の過去の表の 2 つの距離", () => {
  const realGeo = (): GeoStore =>
    createGeoStore({
      index: indexJson as unknown as GeoStore["index"],
      adjacency: adjacencyJson as GeoStore["adjacency"],
      loadPrefTopo: async (p) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown,
    });

  it("町の中心どうし: 県の形を読まない。自分の町は 0。近い順で 60km 以内だけ", () => {
    const geo = realGeo();
    const spy = vi.spyOn(geo, "ensurePrefs");
    const r = nearbyPastByCenter("33214", history, geo, 2026);
    expect(spy).not.toHaveBeenCalled();
    expect(r.windowSeasons).toBe(6);
    expect(r.towns.length).toBeGreaterThan(0);
    const kms = r.towns.map((t) => t.distanceKm);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    for (const k of kms) expect(k).toBeLessThanOrEqual(60);
    expect(r.total).toBe(r.towns.reduce((n, t) => n + t.count, 0));
  });

  it("知らない町の中心どうしは投げる（0 件にしない）", () => {
    expect(() => nearbyPastByCenter("99999", history, realGeo(), 2026)).toThrow();
  });

  it("マス目から面まで: 全体の件数が約 60km の札の過去の件数と同じ", async () => {
    const mesh = latLngToMesh3(35.07, 134.0); // 津山市のあたり（試験の地点）
    const geo = realGeo();
    const r = await nearbyPastFromMesh(mesh, history, geo, 2026);
    const seasons = new Set(pastSeasonsOf(history, 2026));
    const card = await casesWithinBand(mesh, pastCasesOf(history).filter((c) => seasons.has(c.season)), geo);
    expect(r.total).toBe(card);
    expect(r.total).toBeGreaterThan(0);
    for (const t of r.towns) expect(t.distanceKm).toBeCloseTo(distanceToMuniKm(mesh, t.muniCode, geo), 6);
  });

  it("マス目から面まで: 形を読めなければ投げる（0 件にしない）", async () => {
    const geo = createGeoStore({
      index: indexJson as unknown as GeoStore["index"],
      adjacency: adjacencyJson as GeoStore["adjacency"],
      loadPrefTopo: () => Promise.reject(new Error("offline")),
    });
    await expect(nearbyPastFromMesh(latLngToMesh3(35.07, 134.0), history, geo, 2026)).rejects.toThrow();
  });
});

describe("frequentTownCounts（登録した町の今季）", () => {
  it("今季の数える事例だけを、登録の順に町ごとに数える。発生のない町は 0", () => {
    const cases = [
      mkCase({ id: "a", muniCode: "33203" }),
      mkCase({ id: "b", muniCode: "33203" }),
      mkCase({ id: "c", muniCode: "33214" }),
      mkCase({ id: "old", muniCode: "33203", season: 2025 }),
      mkCase({ id: "rev", muniCode: "33203", confirmState: "reviewing" }),
      mkCase({ id: "neg", muniCode: "33203", negation: "negated" }),
    ];
    expect(frequentTownCounts(cases, ["33214", "33203", "33202"], 2026)).toEqual([
      { muniCode: "33214", count: 1 },
      { muniCode: "33203", count: 2 },
      { muniCode: "33202", count: 0 },
    ]);
  });
  it("登録がなければ空", () => {
    expect(frequentTownCounts([mkCase()], [], 2026)).toEqual([]);
  });
});

describe("wildBirdCounts（野鳥の陽性）", () => {
  const bird = (o: Partial<WildBird> & { id: string }): WildBird => ({
    season: 2026,
    date: "2026-11-01",
    prefCode: "33",
    muniCode: null,
    muniName: null,
    species: null,
    test: "screening_positive",
    focusZone: { from: null, to: null },
    sourceUrl: "https://example.invalid/b",
    ...o,
  });
  it("否定は除く。検査中と高病原性の確定を分ける（一覧の表示と同じ）", () => {
    expect(wildBirdCounts([bird({ id: "a" }), bird({ id: "b", test: "hpai_confirmed" }), bird({ id: "c", test: "hpai_confirmed" }), bird({ id: "d", test: "negative" })])).toEqual({ total: 3, confirmed: 2, screening: 1 });
  });
  it("空は 0（読めているかどうかは呼び出し側が分ける）", () => {
    expect(wildBirdCounts([])).toEqual({ total: 0, confirmed: 0, screening: 0 });
  });
});
