// data/geo の本物の形で段階を確かめる（F-06 の出力を使う）。冷えた状態は、試験ごとに新しい GeoStore で作る。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGeoStore, distanceToMuniKm, GeoNotLoadedError, type GeoStore } from "../../shared/src/geo";
import { computeAreaStatus, computeLevel, prefsToLoad } from "../../shared/src/level";
import { latLngToMesh3 } from "../../shared/src/mesh";
import type { Case, FarmPoint } from "../../shared/src/types";
import { GEO_DIR } from "../lib/geoStore";

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8")) as unknown;

/** 毎回新しい（県を 1 つも読んでいない）GeoStore。loadGeoStore は同じフォルダで使い回すので使わない。 */
function coldGeo(): GeoStore {
  return createGeoStore({
    index: readJson(path.join(GEO_DIR, "muni-index.json")) as GeoStore["index"],
    adjacency: readJson(path.join(GEO_DIR, "adjacency.json")) as GeoStore["adjacency"],
    loadPrefTopo: async (p) => readJson(path.join(GEO_DIR, "pref", `${p}.topo.json`)),
  });
}

const SEASON = 2026;

function mkCase(o: Partial<Case> & { id: string; muniCode: string }): Case {
  return {
    season: SEASON,
    nationalNo: null,
    prefNo: null,
    prefCode: o.muniCode.slice(0, 2),
    muniName: null,
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2026-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-12-20T12:00:00+09:00",
    ...o,
  };
}

/** 市町村の center（[経度, 緯度]）のメッシュで作る農場。 */
function farmAt(geo: GeoStore, muniCode: string): FarmPoint {
  const [lng, lat] = geo.index[muniCode]!.center;
  return { meshCode: latLngToMesh3(lat, lng), muniCode, frequentMuniCodes: [] };
}

describe("data/geo の本物の形で段階を計算する", () => {
  it("岡山市は 33100 で、同じ市の事例は①（same_muni）", async () => {
    const geo = coldGeo();
    expect(geo.index["33100"]?.name).toBe("岡山市");
    expect(geo.index["33101"]).toBeUndefined(); // 区のコードは持たない
    const p = farmAt(geo, "33100");
    const r = computeLevel(p, [mkCase({ id: "okayama", muniCode: "33100" })], SEASON, geo); // 県を読む前でも決まる
    expect(r.level).toBe(1);
    expect(r.reasons[0]).toMatchObject({ kind: "same_muni", distanceKm: null });
  });

  it("13421（小笠原村）に②がない: 隣がなく、離れた市の事例は②にならない", async () => {
    const geo = coldGeo();
    expect(geo.adjacency["13421"]).toEqual([]);
    const p = farmAt(geo, "13421");
    const cases = [mkCase({ id: "tokyo-chiyoda", muniCode: "13101" })];
    await geo.ensurePrefs(prefsToLoad(cases));
    const r = computeLevel(p, cases, SEASON, geo);
    expect(r.level).toBe(4);
    expect(r.reasons).toEqual([]);
    // 逆に、同じ村の事例は①
    expect(computeLevel(p, [mkCase({ id: "ogasawara", muniCode: "13421" })], SEASON, geo).level).toBe(1);
  });

  it("冷えた状態から県をまたぐ: 津山市の center のメッシュと鳥取市の事例は、県を読む前は GeoNotLoadedError、読んだ後は②", async () => {
    const geo = coldGeo();
    const p = farmAt(geo, "33203");
    expect(geo.index["33203"]?.name).toBe("津山市");
    expect(geo.adjacency["33203"]).toContain("31201");
    const cases = [mkCase({ id: "tottori", muniCode: "31201" })];

    expect(() => computeLevel(p, cases, SEASON, geo)).toThrow(GeoNotLoadedError);
    expect(prefsToLoad(cases)).toEqual(["31"]);
    await geo.ensurePrefs(prefsToLoad(cases));

    // 鳥取市の面まで 17.66km【確】。津山の県（33）は農場の側なので距離の計算には要らない。
    expect(distanceToMuniKm(p.meshCode, "31201", geo)).toBeCloseTo(17.66, 1);
    const r = computeLevel(p, cases, SEASON, geo);
    expect(r.level).toBe(2);
    expect(r.reasons).toEqual([{ caseId: "tottori", level: 2, kind: "adjacent", distanceKm: null, radiusKm: null }]);
  });

  it("鳥取市の事例の /area は津山市で②（隣）、距離を見ない", () => {
    const geo = coldGeo();
    const r = computeAreaStatus({
      muniCode: "33203",
      cases: [mkCase({ id: "tottori", muniCode: "31201" })],
      wildBirds: [],
      geo,
      asOf: "2027-01-10T09:00:00+09:00",
      season: SEASON,
    });
    expect(r).toMatchObject({ muniName: "津山市", prefCode: "33", level: 2 });
    expect(r.adjacentCases.map((c) => c.id)).toEqual(["tottori"]);
  });
});
