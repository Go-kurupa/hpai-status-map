import { describe, expect, it } from "vitest";
import { GeoNotLoadedError } from "../src/geo";
import {
  MESH_MARGIN_KM,
  ZONE_BASE_KM,
  computeAreaStatus,
  computeLevel,
  isCountable,
  isZoneActive,
  prefsToLoad,
  relationToCase,
  summarizeWatch,
  wildBirdsNotifiable,
  zoneRadiusKm,
} from "../src/level";
import { PREFS } from "../src/pref";
import type { Case, FarmPoint, WatchStatus, WildBird } from "../src/types";
import { boxAround, boxNorthOf, makeGeo, type FakeMuni } from "./fixtures/geo";

const MESH = "53394611"; // 東京駅付近
const SEASON = 2026;
const FARM_MUNI = "13101";
const AS_OF = "2027-01-10T09:00:00+09:00";

const farm = (o: Partial<FarmPoint> = {}): FarmPoint => ({
  meshCode: MESH,
  muniCode: FARM_MUNI,
  frequentMuniCodes: [],
  ...o,
});

function mkCase(o: Partial<Case> & { id: string }): Case {
  return {
    season: SEASON,
    nationalNo: null,
    prefNo: null,
    prefCode: (o.muniCode ?? "13102").slice(0, 2),
    muniCode: "13102",
    muniName: "発生市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2026-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/a"],
    updatedAt: "2026-12-20T12:00:00+09:00",
    ...o,
  };
}

const lifted = { movement_lifted: { date: "2027-01-20", time: null } } as const;

function mkBird(o: Partial<WildBird> & { id: string }): WildBird {
  return {
    season: SEASON,
    date: "2026-12-25",
    prefCode: "13",
    muniCode: "13102",
    muniName: "発生市",
    species: null,
    test: "hpai_confirmed",
    focusZone: { from: null, to: null },
    sourceUrl: "https://example.invalid/bird",
    ...o,
  };
}

/** 農場の市（箱の中にメッシュ中心）と、メッシュ中心から真北へ km の所に縁がある市。 */
function geoWith(extra: FakeMuni[], opts: { preload?: boolean } = {}) {
  return makeGeo([{ code: FARM_MUNI, name: "農場市", geometry: boxAround(MESH) }, ...extra], opts);
}
const northCity = (code: string, km: number, extra: Partial<FakeMuni> = {}): FakeMuni => ({
  code,
  name: `北${code}`,
  geometry: boxNorthOf(MESH, km),
  ...extra,
});

describe("定数と半径", () => {
  it("基準 10km、誤差 0.85km", () => {
    expect(ZONE_BASE_KM).toBe(10);
    expect(MESH_MARGIN_KM).toBe(0.85);
  });

  it("zoneRadiusKm: 空は 10、[3] は 10、[3,10] は 10、[20] は 20", () => {
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [] }))).toBe(10);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [3] }))).toBe(10);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [3, 10] }))).toBe(10);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [20] }))).toBe(20);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [3, 20, 15] }))).toBe(20);
  });

  it("数でない半径が混じっても NaN にならない（①を見逃す方向の誤りを防ぐ）", () => {
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [Number.NaN] }))).toBe(10);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [Number.NaN, 20] }))).toBe(20);
    expect(zoneRadiusKm(mkCase({ id: "a", radiiKm: [Number.POSITIVE_INFINITY] }))).toBe(10);
  });
});

describe("isCountable / isZoneActive", () => {
  it("確認中と否定は数えない。候補は数える", () => {
    expect(isCountable(mkCase({ id: "a" }))).toBe(true);
    expect(isCountable(mkCase({ id: "a", negation: "candidate" }))).toBe(true);
    expect(isCountable(mkCase({ id: "a", negation: "negated" }))).toBe(false);
    expect(isCountable(mkCase({ id: "a", confirmState: "reviewing", muniCode: null }))).toBe(false);
    for (const s of ["auto", "national", "operator", "replay"] as const) {
      expect(isCountable(mkCase({ id: "a", confirmState: s }))).toBe(true);
    }
  });

  it("区域が続くのは数える事例で、移動制限の解除がないあいだ（完了からの日数は見ない）", () => {
    expect(isZoneActive(mkCase({ id: "a" }))).toBe(true);
    expect(isZoneActive(mkCase({ id: "a", stages: { ...lifted } }))).toBe(false);
    expect(isZoneActive(mkCase({ id: "a", negation: "negated" }))).toBe(false);
    expect(isZoneActive(mkCase({ id: "a", confirmState: "reviewing", muniCode: null }))).toBe(false);
    // 搬出制限の解除だけでは続く
    expect(isZoneActive(mkCase({ id: "a", stages: { shipment_lifted: { date: "2027-01-10", time: null } } }))).toBe(true);
  });
});

describe("computeLevel: ① 区域に入っている可能性", () => {
  it("同じ市町村は、遠くても①（same_muni。距離を計算しない）", () => {
    // 県を読んでいなくても同じ市町村は決まる = 距離を見ていない
    const geo = geoWith([], { preload: false });
    const r = computeLevel(farm(), [mkCase({ id: "c1", muniCode: FARM_MUNI })], SEASON, geo);
    expect(r.level).toBe(1);
    expect(r.reasons).toEqual([{ caseId: "c1", level: 1, kind: "same_muni", distanceKm: null, radiusKm: null }]);
    expect(geo.loadedPrefs.size).toBe(0);
  });

  it("10.70km と 10.80km は①（誤差 0.85km の内側）、10.95km は①でない", () => {
    const geo = geoWith([northCity("13102", 10.7), northCity("13103", 10.8), northCity("13104", 10.95)], { preload: true });
    const near = computeLevel(farm(), [mkCase({ id: "n", muniCode: "13102" })], SEASON, geo);
    expect(near.level).toBe(1);
    expect(near.reasons).toHaveLength(1);
    expect(near.reasons[0]).toMatchObject({ caseId: "n", level: 1, kind: "within_radius", radiusKm: 10 });
    expect(near.reasons[0]!.distanceKm).toBeCloseTo(10.7, 1);

    expect(computeLevel(farm(), [mkCase({ id: "m", muniCode: "13103" })], SEASON, geo).level).toBe(1);

    const far = computeLevel(farm(), [mkCase({ id: "f", muniCode: "13104" })], SEASON, geo);
    expect(far.level).toBe(4);
    expect(far.reasons).toEqual([]);
  });

  it("半径は最も外側。[3] と [3,10] は 10、[20] は 20（20.80km は①、20.95km は①でない）", () => {
    const geo = geoWith([northCity("13102", 10.7), northCity("13103", 20.8), northCity("13104", 20.95)], { preload: true });
    for (const radiiKm of [[3], [3, 10]]) {
      const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", radiiKm })], SEASON, geo);
      expect(r.level, JSON.stringify(radiiKm)).toBe(1);
      expect(r.reasons[0]!.radiusKm).toBe(10);
      // 3km の発表でも 10km より狭くしない: 10.80km でも①のまま、20.8km は①でない
      expect(computeLevel(farm(), [mkCase({ id: "b", muniCode: "13103", radiiKm })], SEASON, geo).level).toBe(4);
    }
    const wide = computeLevel(farm(), [mkCase({ id: "c", muniCode: "13103", radiiKm: [20] })], SEASON, geo);
    expect(wide.level).toBe(1);
    expect(wide.reasons[0]).toMatchObject({ kind: "within_radius", radiusKm: 20 });
    expect(wide.reasons[0]!.distanceKm).toBeCloseTo(20.8, 1);
    expect(computeLevel(farm(), [mkCase({ id: "d", muniCode: "13104", radiiKm: [20] })], SEASON, geo).level).toBe(4);
  });

  it("20.70km は radiiKm [20] で①", () => {
    const geo = geoWith([northCity("13102", 20.7)], { preload: true });
    expect(computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", radiiKm: [20] })], SEASON, geo).level).toBe(1);
  });

  it("搬出制限が解除された後も①で shipmentLifted が true（距離を縮めない）", () => {
    const geo = geoWith([northCity("13102", 10.7)], { preload: true });
    const stages = {
      confirmed: { date: "2026-12-20", time: null },
      shipment_lifted: { date: "2027-01-10", time: null },
    };
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", stages })], SEASON, geo);
    expect(r.level).toBe(1);
    expect(r.shipmentLifted).toBe(true);
    const notYet = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102" })], SEASON, geo);
    expect(notYet.shipmentLifted).toBe(false);
  });

  it("shipmentLifted は①の事例がすべて解除済みのときだけ true（一部だけなら false）", () => {
    const geo = geoWith([northCity("13102", 5), northCity("13103", 6)], { preload: true });
    const withShip = { shipment_lifted: { date: "2027-01-10", time: null } };
    const both = computeLevel(
      farm(),
      [mkCase({ id: "a", muniCode: "13102", stages: withShip }), mkCase({ id: "b", muniCode: "13103" })],
      SEASON,
      geo,
    );
    expect(both.level).toBe(1);
    expect(both.shipmentLifted).toBe(false);
    const all = computeLevel(
      farm(),
      [mkCase({ id: "a", muniCode: "13102", stages: withShip }), mkCase({ id: "b", muniCode: "13103", stages: withShip })],
      SEASON,
      geo,
    );
    expect(all.shipmentLifted).toBe(true);
  });

  it("完了から 28 日たっても、移動制限の解除がなければ①", () => {
    const geo = geoWith([], { preload: true });
    const stages = {
      confirmed: { date: "2026-11-01", time: null },
      control_done: { date: "2026-11-05", time: null }, // 判定の日（2027-01-10 想定）まで 60 日以上
    };
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: FARM_MUNI, stages })], SEASON, geo);
    expect(r.level).toBe(1);
  });

  it("inSurveillanceNote は①のときだけ", () => {
    const geo = geoWith([northCity("13102", 5), northCity("13103", 1)], { preload: true });
    const g = (extra: Partial<Case>[]) =>
      computeLevel(farm({ muniCode: "13199", frequentMuniCodes: ["13103"] }), extra.map((e, i) => mkCase({ id: `x${i}`, ...e })), SEASON, geo);
    expect(g([{ muniCode: "13102" }]).inSurveillanceNote).toBe(true);
    // ③ と ④ と解除の後の②は false
    expect(g([{ muniCode: "13103", stages: { ...lifted } }]).level).toBe(3);
    expect(g([{ muniCode: "13103", stages: { ...lifted } }]).inSurveillanceNote).toBe(false);
    expect(g([]).inSurveillanceNote).toBe(false);
    const after = computeLevel(farm(), [mkCase({ id: "a", muniCode: FARM_MUNI, stages: { ...lifted } })], SEASON, geo);
    expect(after.level).toBe(2);
    expect(after.inSurveillanceNote).toBe(false);
  });

  it("監視強化の解除が記録済みの事例だけなら説明を出さない", () => {
    const geo = geoWith([northCity("13102", 5)], { preload: true });
    const stages = { surveillance_lifted: { date: "2027-02-01", time: null } };
    expect(computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", stages })], SEASON, geo).inSurveillanceNote).toBe(false);
  });

  it("離島（隣がない市町村）は②にならず、距離なら①", () => {
    const geo = geoWith([northCity("13421", 5, { name: "島" })], { preload: true });
    expect(geo.adjacency["13421"]).toEqual([]);
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13421" })], SEASON, geo);
    expect(r.level).toBe(1);
    expect(r.reasons[0]!.kind).toBe("within_radius");
    const far = geoWith([northCity("13421", 60)], { preload: true });
    expect(computeLevel(farm(), [mkCase({ id: "a", muniCode: "13421" })], SEASON, far).level).toBe(4);
  });
});

describe("computeLevel: ② ③ ④", () => {
  it("隣は②（adjacent。10km より遠くても）", () => {
    const geo = geoWith([northCity("13102", 30, { neighbors: [FARM_MUNI] })], { preload: true });
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102" })], SEASON, geo);
    expect(r.level).toBe(2);
    expect(r.reasons).toEqual([{ caseId: "a", level: 2, kind: "adjacent", distanceKm: null, radiusKm: null }]);
  });

  it("登録した町は③、他は④で reasons が空", () => {
    const geo = geoWith([northCity("13102", 30), northCity("13103", 40)], { preload: true });
    const f = farm({ frequentMuniCodes: ["13102"] });
    const r3 = computeLevel(f, [mkCase({ id: "a", muniCode: "13102" })], SEASON, geo);
    expect(r3.level).toBe(3);
    expect(r3.reasons).toEqual([{ caseId: "a", level: 3, kind: "frequent", distanceKm: null, radiusKm: null }]);
    const r4 = computeLevel(f, [mkCase({ id: "a", muniCode: "13103" })], SEASON, geo);
    expect(r4).toEqual({ level: 4, reasons: [], shipmentLifted: false, inSurveillanceNote: false });
    expect(computeLevel(f, [], SEASON, geo).level).toBe(4);
  });

  it("隣でもあり登録でもあれば②", () => {
    const geo = geoWith([northCity("13102", 30, { neighbors: [FARM_MUNI] })], { preload: true });
    const r = computeLevel(farm({ frequentMuniCodes: ["13102"] }), [mkCase({ id: "a", muniCode: "13102" })], SEASON, geo);
    expect(r.level).toBe(2);
    expect(r.reasons[0]!.kind).toBe("adjacent");
  });

  it("隣で、しかも 10km 以内なら①（距離が先）", () => {
    const geo = geoWith([northCity("13102", 5, { neighbors: [FARM_MUNI] })], { preload: true });
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102" })], SEASON, geo);
    expect(r.level).toBe(1);
    expect(r.reasons[0]!.kind).toBe("within_radius");
  });

  it("複数に当たるときは最も高い段階で、reasons は高い順（当たった事例すべて）", () => {
    const geo = geoWith(
      [northCity("13102", 30, { neighbors: [FARM_MUNI] }), northCity("13103", 40), northCity("13104", 5)],
      { preload: true },
    );
    const f = farm({ frequentMuniCodes: ["13103"] });
    const cases = [
      mkCase({ id: "third", muniCode: "13103" }),
      mkCase({ id: "second", muniCode: "13102" }),
      mkCase({ id: "first", muniCode: "13104" }),
    ];
    const r = computeLevel(f, cases, SEASON, geo);
    expect(r.level).toBe(1);
    expect(r.reasons.map((x) => [x.caseId, x.level])).toEqual([
      ["first", 1],
      ["second", 2],
      ["third", 3],
    ]);
  });

  it("同じ市町村で複数の事例があれば、すべて reasons に残る", () => {
    const geo = geoWith([], { preload: true });
    const r = computeLevel(
      farm(),
      [mkCase({ id: "a", muniCode: FARM_MUNI }), mkCase({ id: "b", muniCode: FARM_MUNI })],
      SEASON,
      geo,
    );
    expect(r.reasons.map((x) => x.caseId)).toEqual(["a", "b"]);
  });
});

describe("computeLevel: 数えない事例", () => {
  const geo = () => geoWith([northCity("13102", 5, { neighbors: [FARM_MUNI] })], { preload: true });

  it("否定は外し、否定の候補は数える", () => {
    expect(computeLevel(farm(), [mkCase({ id: "a", negation: "negated" })], SEASON, geo()).level).toBe(4);
    const cand = computeLevel(farm(), [mkCase({ id: "a", negation: "candidate" })], SEASON, geo());
    expect(cand.level).toBe(1);
  });

  it("確認中（reviewing）と別のシーズンは数えない", () => {
    expect(
      computeLevel(farm(), [mkCase({ id: "a", confirmState: "reviewing", muniCode: null, muniName: null })], SEASON, geo()).level,
    ).toBe(4);
    expect(computeLevel(farm(), [mkCase({ id: "a", season: SEASON - 1 })], SEASON, geo()).level).toBe(4);
    expect(computeLevel(farm(), [mkCase({ id: "a", season: SEASON + 1 })], SEASON, geo()).level).toBe(4);
  });

  it("muniCode のない事例は④（reviewing 以外でも距離を見ない）", () => {
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: null, muniName: null })], SEASON, geo());
    expect(r.level).toBe(4);
    expect(r.reasons).toEqual([]);
  });
});

describe("computeLevel: 移動制限の解除の後（契約 2.4、索引 Q5 既定 A）", () => {
  it("同じ市町村は②で same_muni（adjacent にしない）", () => {
    const geo = geoWith([], { preload: false });
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: FARM_MUNI, stages: { ...lifted } })], SEASON, geo);
    expect(r.level).toBe(2);
    expect(r.reasons).toEqual([{ caseId: "a", level: 2, kind: "same_muni", distanceKm: null, radiusKm: null }]);
    expect(r.shipmentLifted).toBe(false);
  });

  it("隣は②、登録は③のまま", () => {
    const geo = geoWith([northCity("13102", 5, { neighbors: [FARM_MUNI] }), northCity("13103", 30)], { preload: true });
    const rAdj = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", stages: { ...lifted } })], SEASON, geo);
    expect(rAdj.level).toBe(2);
    expect(rAdj.reasons[0]!.kind).toBe("adjacent");
    const rFreq = computeLevel(
      farm({ frequentMuniCodes: ["13103"] }),
      [mkCase({ id: "b", muniCode: "13103", stages: { ...lifted } })],
      SEASON,
      geo,
    );
    expect(rFreq.level).toBe(3);
  });

  it("10km 以内でも隣でなければ④（解除の後は距離を見ない）", () => {
    // 距離を見ないので、県が未読み込みでも throw しない
    const geo = geoWith([northCity("13102", 5)], { preload: false });
    const r = computeLevel(farm(), [mkCase({ id: "a", muniCode: "13102", stages: { ...lifted } })], SEASON, geo);
    expect(r.level).toBe(4);
    expect(r.reasons).toEqual([]);
  });

  it("否定とシーズン違いは数えない", () => {
    const geo = geoWith([], { preload: true });
    const s = { ...lifted };
    expect(computeLevel(farm(), [mkCase({ id: "a", muniCode: FARM_MUNI, stages: s, negation: "negated" })], SEASON, geo).level).toBe(4);
    expect(computeLevel(farm(), [mkCase({ id: "a", muniCode: FARM_MUNI, stages: s, season: SEASON - 1 })], SEASON, geo).level).toBe(4);
  });

  it("同じ町で、解除済みと進行中があれば①（進行中が優先）", () => {
    const geo = geoWith([], { preload: true });
    const r = computeLevel(
      farm(),
      [mkCase({ id: "old", muniCode: FARM_MUNI, stages: { ...lifted } }), mkCase({ id: "new", muniCode: FARM_MUNI })],
      SEASON,
      geo,
    );
    expect(r.level).toBe(1);
    expect(r.reasons.map((x) => [x.caseId, x.level])).toEqual([
      ["new", 1],
      ["old", 2],
    ]);
  });
});

describe("relationToCase", () => {
  it("時期（season）も否定も見ない。同じ市町村では距離を計算しない", () => {
    const geo = geoWith([], { preload: false });
    const old = mkCase({ id: "a", season: 1999, muniCode: FARM_MUNI });
    expect(relationToCase(farm(), old, geo)).toEqual({
      level: 1,
      reason: { caseId: "a", level: 1, kind: "same_muni", distanceKm: null, radiusKm: null },
    });
  });

  it("関係がなければ level 4 で reason は null", () => {
    const geo = geoWith([northCity("13102", 50)], { preload: true });
    expect(relationToCase(farm(), mkCase({ id: "a", muniCode: "13102" }), geo)).toEqual({ level: 4, reason: null });
  });
});

describe("県の読み込み（距離の前に ensurePrefs）", () => {
  it("読む前は GeoNotLoadedError、prefsToLoad で読んだ後は距離が出る", async () => {
    const geo = geoWith([northCity("13102", 5)]);
    const cases = [mkCase({ id: "a", muniCode: "13102" })];
    expect(() => computeLevel(farm(), cases, SEASON, geo)).toThrow(GeoNotLoadedError);
    expect(() => relationToCase(farm(), cases[0]!, geo)).toThrow(GeoNotLoadedError);
    await geo.ensurePrefs(prefsToLoad(cases));
    expect(computeLevel(farm(), cases, SEASON, geo).level).toBe(1);
  });

  it("県をまたぐ事例は、その県を読むまで GeoNotLoadedError（冷えた状態）", async () => {
    const geo = makeGeo([
      { code: "33203", name: "津山市", prefCode: "33", geometry: boxAround(MESH) },
      { code: "31201", name: "鳥取市", prefCode: "31", geometry: boxNorthOf(MESH, 17.66), neighbors: ["33203"] },
    ]);
    const p = farm({ muniCode: "33203" });
    const cases = [mkCase({ id: "t", muniCode: "31201", prefCode: "31" })];
    expect(() => computeLevel(p, cases, SEASON, geo)).toThrow(GeoNotLoadedError);
    await geo.ensurePrefs(prefsToLoad(cases));
    const r = computeLevel(p, cases, SEASON, geo);
    expect(r.level).toBe(2);
    expect(r.reasons[0]!.kind).toBe("adjacent");
  });
});

describe("prefsToLoad", () => {
  it("数える事例と野鳥の県を重複なく。確認中と否定の県を含めない", () => {
    const cases = [
      mkCase({ id: "a", muniCode: "33203", prefCode: "33" }),
      mkCase({ id: "b", muniCode: "33100", prefCode: "33" }),
      mkCase({ id: "c", muniCode: "31201", prefCode: "31", negation: "candidate" }),
      mkCase({ id: "d", muniCode: "34202", prefCode: "34", negation: "negated" }),
      mkCase({ id: "e", muniCode: null, muniName: null, prefCode: "35", confirmState: "reviewing" }),
    ];
    const birds = [
      mkBird({ id: "w1", prefCode: "13", muniCode: "13102" }),
      mkBird({ id: "w2", prefCode: "13", muniCode: "13103" }),
      mkBird({ id: "w3", prefCode: "01", muniCode: "01202", test: "screening_positive" }),
      mkBird({ id: "w4", prefCode: "36", muniCode: "36201", test: "negative" }),
    ];
    expect(prefsToLoad(cases, birds).sort()).toEqual(["01", "13", "31", "33"]);
    expect(prefsToLoad(cases).sort()).toEqual(["31", "33"]);
    expect(prefsToLoad([], [])).toEqual([]);
  });
});

describe("computeAreaStatus", () => {
  const geoFor = () =>
    geoWith(
      [
        { code: "13102", name: "隣市", geometry: boxNorthOf(MESH, 30), neighbors: [FARM_MUNI] },
        { code: "13103", name: "近いが隣でない市", geometry: boxNorthOf(MESH, 3) },
      ],
      { preload: false },
    );
  const area = (cases: Case[], wildBirds: WildBird[] = [], muniCode = FARM_MUNI) =>
    computeAreaStatus({ muniCode, cases, wildBirds, geo: geoFor(), asOf: AS_OF, season: SEASON });

  it("同じ市町村は 1（県を読まなくても決まる = 距離を見ない）", () => {
    const r = area([mkCase({ id: "a", muniCode: FARM_MUNI, sourceUrls: ["https://example.invalid/1"] })]);
    expect(r).toMatchObject({ muniCode: FARM_MUNI, muniName: "農場市", prefCode: "13", asOf: AS_OF, level: 1 });
    expect(r.sameMuniCases.map((c) => c.id)).toEqual(["a"]);
    expect(r.adjacentCases).toEqual([]);
    expect(r.sourceUrls).toEqual(["https://example.invalid/1"]);
  });

  it("移動制限の解除の後の同じ町は 2 で、sameMuniCases に残る", () => {
    const r = area([mkCase({ id: "a", muniCode: FARM_MUNI, stages: { ...lifted } })]);
    expect(r.level).toBe(2);
    expect(r.sameMuniCases.map((c) => c.id)).toEqual(["a"]);
  });

  it("解除済みと進行中が同じ町にあれば 1", () => {
    const r = area([
      mkCase({ id: "old", muniCode: FARM_MUNI, stages: { ...lifted } }),
      mkCase({ id: "new", muniCode: FARM_MUNI }),
    ]);
    expect(r.level).toBe(1);
    expect(r.sameMuniCases.map((c) => c.id)).toEqual(["old", "new"]);
  });

  it("隣は 2、他（近くても隣でない）は 4。距離を見ない", () => {
    const adj = area([mkCase({ id: "a", muniCode: "13102" })]);
    expect(adj.level).toBe(2);
    expect(adj.adjacentCases.map((c) => c.id)).toEqual(["a"]);
    expect(adj.sameMuniCases).toEqual([]);
    const near = area([mkCase({ id: "b", muniCode: "13103" })]);
    expect(near.level).toBe(4);
    expect(near.sameMuniCases).toEqual([]);
    expect(near.adjacentCases).toEqual([]);
    expect(area([]).level).toBe(4);
  });

  it("否定と確認中とシーズン違いは含まない。否定の候補は含む", () => {
    const r = area([
      mkCase({ id: "neg", muniCode: FARM_MUNI, negation: "negated" }),
      mkCase({ id: "rev", muniCode: null, muniName: null, confirmState: "reviewing" }),
      mkCase({ id: "old", muniCode: FARM_MUNI, season: SEASON - 1 }),
      mkCase({ id: "cand", muniCode: "13102", negation: "candidate" }),
    ]);
    expect(r.level).toBe(2);
    expect(r.sameMuniCases).toEqual([]);
    expect(r.adjacentCases.map((c) => c.id)).toEqual(["cand"]);
  });

  it("wildBirds は同じと隣の今季で negative を除く", () => {
    const r = area(
      [],
      [
        mkBird({ id: "same", muniCode: FARM_MUNI, sourceUrl: "https://example.invalid/b1" }),
        mkBird({ id: "adj", muniCode: "13102", test: "screening_positive", sourceUrl: "https://example.invalid/b2" }),
        mkBird({ id: "neg", muniCode: FARM_MUNI, test: "negative" }),
        mkBird({ id: "far", muniCode: "13103" }),
        mkBird({ id: "old", muniCode: FARM_MUNI, season: SEASON - 1 }),
        mkBird({ id: "nomuni", muniCode: null, muniName: null }),
      ],
    );
    expect(r.wildBirds.map((b) => b.id)).toEqual(["same", "adj"]);
    expect(r.level).toBe(4); // 野鳥は段階を上げない
    expect(r.sourceUrls).toEqual(["https://example.invalid/b1", "https://example.invalid/b2"]);
  });

  it("sourceUrls は事例と野鳥の出典を重複なく", () => {
    const r = area(
      [mkCase({ id: "a", muniCode: FARM_MUNI, sourceUrls: ["https://example.invalid/x", "https://example.invalid/y"] })],
      [mkBird({ id: "w", muniCode: FARM_MUNI, sourceUrl: "https://example.invalid/x" })],
    );
    expect(r.sourceUrls).toEqual(["https://example.invalid/x", "https://example.invalid/y"]);
  });

  it("知らない市町村コードは throw する（黙って④にしない）", () => {
    expect(() => area([], [], "99999")).toThrow(RangeError);
  });
});

describe("wildBirdsNotifiable", () => {
  const geo = () =>
    geoWith([northCity("13102", 10.4), northCity("13103", 10.8), northCity("13104", 10.95), northCity("13105", 30)], {
      preload: true,
    });

  it("hpai_confirmed は 10.40km と 10.80km が入り、10.95km は入らない（誤差 0.85km を含む）", () => {
    const birds = [
      mkBird({ id: "a", muniCode: "13102" }),
      mkBird({ id: "b", muniCode: "13103" }),
      mkBird({ id: "c", muniCode: "13104" }),
      mkBird({ id: "d", muniCode: "13105" }),
    ];
    expect(wildBirdsNotifiable(farm(), birds, geo()).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("同じ市町村の野鳥は入る", () => {
    expect(wildBirdsNotifiable(farm(), [mkBird({ id: "a", muniCode: FARM_MUNI })], geo()).map((b) => b.id)).toEqual(["a"]);
  });

  it("screening_positive、negative、muniCode なしは入らない", () => {
    const birds = [
      mkBird({ id: "s", muniCode: "13102", test: "screening_positive" }),
      mkBird({ id: "n", muniCode: "13102", test: "negative" }),
      mkBird({ id: "m", muniCode: null, muniName: null }),
    ];
    expect(wildBirdsNotifiable(farm(), birds, geo())).toEqual([]);
  });

  it("県を読む前は GeoNotLoadedError", () => {
    const g = geoWith([northCity("13102", 5)]);
    expect(() => wildBirdsNotifiable(farm(), [mkBird({ id: "a", muniCode: "13102" })], g)).toThrow(GeoNotLoadedError);
  });
});

describe("summarizeWatch", () => {
  const NOW = new Date("2027-01-10T12:00:00+09:00");
  const st = (prefCode: string, o: Partial<WatchStatus> = {}): WatchStatus => ({
    prefCode,
    checkedAt: "2027-01-10T11:00:00+09:00",
    ok: true,
    lastOkAt: "2027-01-10T11:00:00+09:00",
    failingSince: null,
    ...o,
  });
  const all47 = (o: (code: string) => Partial<WatchStatus> = () => ({})) => PREFS.map((p) => st(p.code, o(p.code)));

  it("空は全 47 件が確認できていない", () => {
    const s = summarizeWatch([], NOW);
    expect(s.okCount).toBe(0);
    expect(s.failedCount).toBe(47);
    expect(s.failedPrefCodes).toEqual(PREFS.map((p) => p.code));
    expect(s.asOf).toBe("2027-01-10T12:00:00+09:00");
  });

  it("6 時間ちょうどは入り、6 時間 1 分は入らない", () => {
    const s = summarizeWatch(
      all47((c) =>
        c === "01"
          ? { checkedAt: "2027-01-10T06:00:00+09:00" } // ちょうど 6 時間前
          : c === "02"
            ? { checkedAt: "2027-01-10T05:59:00+09:00" } // 6 時間 1 分前
            : {},
      ),
      NOW,
    );
    expect(s.failedPrefCodes).toEqual(["02"]);
    expect(s.okCount).toBe(46);
    expect(s.failedCount).toBe(1);
  });

  it("ok が false、checkedAt が null、読めない時刻は確認できていない扱い", () => {
    const s = summarizeWatch(
      all47((c) =>
        c === "03" ? { ok: false } : c === "04" ? { checkedAt: null } : c === "05" ? { checkedAt: "不正" } : {},
      ),
      NOW,
    );
    expect(s.failedPrefCodes).toEqual(["03", "04", "05"]);
  });

  it("未来の時刻は確認済みに数えない（時計のずれや壊れた値で確認済みに見せない）", () => {
    const s = summarizeWatch(
      all47((c) =>
        c === "06"
          ? { checkedAt: "2027-01-10T12:01:00+09:00" } // 1 分先
          : c === "07"
            ? { checkedAt: "2027-01-10T12:00:00+09:00" } // ちょうど今は確認済み
            : {},
      ),
      NOW,
    );
    expect(s.failedPrefCodes).toEqual(["06"]);
    expect(s.okCount).toBe(46);
  });

  it("一覧にない県は確認できていない", () => {
    const s = summarizeWatch(all47().filter((x) => x.prefCode !== "47"), NOW);
    expect(s.failedPrefCodes).toEqual(["47"]);
  });

  it("全部成功なら失敗 0", () => {
    const s = summarizeWatch(all47(), NOW);
    expect(s).toMatchObject({ okCount: 47, failedCount: 0, failedPrefCodes: [] });
  });
});
