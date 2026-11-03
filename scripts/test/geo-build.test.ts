import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PREFS } from "../../shared/src/pref";
import { DESIGNATED_CITIES } from "../lib/designated-cities";
import {
  buildAdjacency,
  buildMuniIndex,
  buildPrefAnchors,
  eachExpression,
  largestPolygonCenter,
  muniCodeOf,
  type N03Properties,
} from "../lib/geo-build";

const require = createRequire(import.meta.url);
const { topology } = require("topojson-server") as { topology: (objects: Record<string, unknown>, quantization?: number) => any };

const props = (o: Partial<N03Properties>): N03Properties => ({
  N03_001: "東京都",
  N03_004: "千代田区",
  N03_005: null,
  N03_007: "13101",
  ...o,
});

describe("DESIGNATED_CITIES", () => {
  it("政令市 20 市。コードは市のコード（先頭 2 桁が県）", () => {
    expect(Object.keys(DESIGNATED_CITIES)).toHaveLength(20);
    expect(DESIGNATED_CITIES["岡山県岡山市"]).toBe("33100");
    expect(DESIGNATED_CITIES["神奈川県川崎市"]).toBe("14130");
    expect(DESIGNATED_CITIES["福岡県北九州市"]).toBe("40100");
    for (const [key, code] of Object.entries(DESIGNATED_CITIES)) {
      expect(code).toMatch(/^\d{5}$/);
      const pref = PREFS.find((p) => key.startsWith(p.name));
      expect(pref, key).toBeDefined();
      expect(code.slice(0, 2)).toBe(pref!.code);
      expect(key.slice(pref!.name.length)).toMatch(/市$/);
    }
    expect(new Set(Object.values(DESIGNATED_CITIES)).size).toBe(20);
  });
});

describe("muniCodeOf", () => {
  it("政令市の区は市のコード（区のコードを保存しない）", () => {
    expect(muniCodeOf(props({ N03_001: "岡山県", N03_004: "岡山市", N03_005: "北区", N03_007: "33101" }))).toBe("33100");
  });
  it("東京の特別区と、区のない市町村は N03_007 のまま", () => {
    expect(muniCodeOf(props({}))).toBe("13101");
    expect(muniCodeOf(props({ N03_001: "岡山県", N03_004: "津山市", N03_007: "33203" }))).toBe("33203");
  });
  it("表にない政令市は throw する", () => {
    expect(() => muniCodeOf(props({ N03_001: "岡山県", N03_004: "新政令市", N03_005: "中区", N03_007: "33901" }))).toThrow(
      /新政令市/,
    );
  });
});

describe("eachExpression（mapshaper の -each に渡す式）", () => {
  const run = (p: N03Properties): { c: string; n: string; p: string } => {
    const fn = new Function(
      "N03_001",
      "N03_004",
      "N03_005",
      "N03_007",
      `var c, n, p; ${eachExpression()}; return { c: c, n: n, p: p };`,
    );
    return fn(p.N03_001, p.N03_004, p.N03_005, p.N03_007);
  };
  it("var で表を持つ（フィールドとして残さない）", () => {
    expect(eachExpression().startsWith("var t=")).toBe(true);
    expect(eachExpression()).toContain(JSON.stringify(DESIGNATED_CITIES));
  });
  it("muniCodeOf と同じコードを出す。n は N03_004、p は県", () => {
    const samples = [
      props({}),
      props({ N03_001: "岡山県", N03_004: "津山市", N03_007: "33203" }),
      ...Object.keys(DESIGNATED_CITIES).map((key) => {
        const pref = PREFS.find((p) => key.startsWith(p.name))!;
        return props({ N03_001: pref.name, N03_004: key.slice(pref.name.length), N03_005: "中央区", N03_007: "00000" });
      }),
    ];
    for (const s of samples) {
      const out = run(s);
      expect(out.c).toBe(muniCodeOf(s));
      expect(out.n).toBe(s.N03_004);
      expect(out.p).toBe(out.c.slice(0, 2));
    }
  });
});

// ---- 図形の部品 ----
type Ring = Array<[number, number]>;
const square = (x: number, y: number, w: number, h = w): Ring => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const feat = (c: string, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, n = c, p = c.slice(0, 2)) => ({
  type: "Feature" as const,
  properties: { c, n, p },
  geometry,
});
const poly = (...rings: Ring[]): GeoJSON.Polygon => ({ type: "Polygon", coordinates: rings });
const multi = (...polys: Ring[][]): GeoJSON.MultiPolygon => ({ type: "MultiPolygon", coordinates: polys });
const topoOf = (features: ReturnType<typeof feat>[]) => {
  const t = topology({ muni: { type: "FeatureCollection", features } }, 1e6);
  return t;
};

describe("largestPolygonCenter", () => {
  it("最大の面の bbox の中心（遠くの小さな島に引かれない）", () => {
    const g = multi([square(0, 0, 10)], [square(100, 100, 1)]);
    expect(largestPolygonCenter(g)).toEqual([5, 5]);
  });
  it("穴は面積から引く（外側が小さくても穴の大きい面を選ばない）", () => {
    const withHole = poly(square(0, 0, 10), square(1, 1, 8)); // 面積 100 - 64 = 36
    const solid = square(50, 50, 7); // 面積 49
    expect(largestPolygonCenter(multi(withHole.coordinates as Ring[], [solid]))).toEqual([53.5, 53.5]);
  });
  it("Polygon でも使える", () => {
    expect(largestPolygonCenter(poly(square(2, 4, 6, 2)))).toEqual([5, 5]);
  });
});

describe("buildAdjacency", () => {
  // A と B は辺を共有、C は離れている。D は A の隣（県をまたぐ）。
  const topo = topoOf([
    feat("33001", poly(square(0, 0, 1))),
    feat("33002", poly(square(1, 0, 1))),
    feat("33003", poly(square(10, 10, 1))),
    feat("31001", poly(square(0, 1, 1))),
  ]);
  const adj = buildAdjacency(topo);
  it("辺を共有する市町村が隣り合い、対称で、並びが安定している", () => {
    expect(adj["33001"]).toEqual(["31001", "33002"]);
    expect(adj["33002"]).toEqual(["33001"]);
    expect(adj["31001"]).toEqual(["33001"]);
    for (const [a, list] of Object.entries(adj)) for (const b of list) expect(adj[b]).toContain(a);
  });
  it("隣のない形は空の配列で残る", () => {
    expect(adj["33003"]).toEqual([]);
    expect(Object.keys(adj)).toEqual(["31001", "33001", "33002", "33003"]);
  });
});

describe("buildMuniIndex / buildPrefAnchors", () => {
  const topo = topoOf([
    feat("33203", multi([square(0, 0, 10)], [square(100, 50, 1)]), "津山市"),
    feat("33100", poly(square(20, 0, 4, 2)), "岡山市"),
    feat("31201", poly(square(40, 0, 2)), "鳥取市"),
  ]);
  const index = buildMuniIndex(topo);
  it("名前、県、bbox、最大の面の中心", () => {
    expect(Object.keys(index)).toEqual(["31201", "33100", "33203"]);
    expect(index["33203"]).toMatchObject({ code: "33203", name: "津山市", prefCode: "33" });
    expect(index["33203"]!.center[0]).toBeCloseTo(5, 3);
    expect(index["33203"]!.center[1]).toBeCloseTo(5, 3);
    const [w, s, e, n] = index["33203"]!.bbox;
    expect([w, s]).toEqual([expect.closeTo(0, 3), expect.closeTo(0, 3)]);
    expect([e, n]).toEqual([expect.closeTo(101, 3), expect.closeTo(51, 3)]);
  });
  it("県の代表点は、県の最大の面の bbox の中心（隣り合う市町村は一つの面になる）", () => {
    const anchors = buildPrefAnchors(topo);
    expect(Object.keys(anchors)).toEqual(["31", "33"]);
    expect(anchors["33"]![0]).toBeCloseTo(5, 3);
    expect(anchors["33"]![1]).toBeCloseTo(5, 3);
    expect(anchors["31"]).toEqual([expect.closeTo(41, 3), expect.closeTo(1, 3)]);
  });
});
