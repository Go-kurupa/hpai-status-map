import { describe, expect, it, vi } from "vitest";
import {
  GeoNotLoadedError,
  createGeoStore,
  distanceToMuniKm,
  findMuniByName,
  isAdjacent,
} from "../src/geo";
import { boxAround, boxNorthOf, makeGeo, makeTopo } from "./fixtures/geo";

const MESH = "53394611"; // 東京駅付近

describe("distanceToMuniKm", () => {
  it("メッシュの中心が内側なら 0", () => {
    const geo = makeGeo([{ code: "13101", geometry: boxAround(MESH) }], { preload: true });
    expect(distanceToMuniKm(MESH, "13101", geo)).toBe(0);
  });

  it("辺まで真北へ 10.70km なら約 10.70（geodesic）", () => {
    const geo = makeGeo([{ code: "13102", geometry: boxNorthOf(MESH, 10.7) }], { preload: true });
    expect(distanceToMuniKm(MESH, "13102", geo)).toBeCloseTo(10.7, 1);
  });

  it("MultiPolygon は最も近い面までの距離", () => {
    const geometry = {
      type: "MultiPolygon" as const,
      coordinates: [boxNorthOf(MESH, 30).coordinates, boxNorthOf(MESH, 10.7).coordinates],
    };
    const geo = makeGeo([{ code: "13103", geometry }], { preload: true });
    expect(distanceToMuniKm(MESH, "13103", geo)).toBeCloseTo(10.7, 1);
  });

  it("県を読む前は GeoNotLoadedError、読んだ後は距離が出る", async () => {
    const geo = makeGeo([{ code: "13102", geometry: boxNorthOf(MESH, 5) }]);
    expect(() => distanceToMuniKm(MESH, "13102", geo)).toThrow(GeoNotLoadedError);
    await geo.ensurePrefs(["13"]);
    expect(distanceToMuniKm(MESH, "13102", geo)).toBeCloseTo(5, 1);
  });
});

describe("createGeoStore", () => {
  const index = makeGeo([
    { code: "33203", name: "津山市", geometry: boxAround(MESH) },
    { code: "31201", name: "鳥取市", geometry: boxNorthOf(MESH, 20) },
  ]).index;
  const topoOf = (prefCode: string) =>
    makeTopo(
      Object.values(index)
        .filter((e) => e.prefCode === prefCode)
        .map((e) => ({
          code: e.code,
          name: e.name,
          prefCode,
          geometry: e.code === "33203" ? boxAround(MESH) : boxNorthOf(MESH, 20),
        })),
    );

  it("読み込む前は GeoNotLoadedError、読むと形が返る", async () => {
    const loadPrefTopo = vi.fn(async (p: string) => topoOf(p));
    const store = createGeoStore({ index, adjacency: {}, loadPrefTopo });
    expect(() => store.geometry("33203")).toThrow(GeoNotLoadedError);
    await store.ensurePrefs(["33"]);
    const g = store.geometry("33203");
    expect(g.properties.c).toBe("33203");
    expect(g.geometry.type).toBe("Polygon");
    expect(() => store.geometry("31201")).toThrow(GeoNotLoadedError); // 鳥取はまだ
    expect(distanceToMuniKm(MESH, "33203", store)).toBe(0);
  });

  it("同じ県を 2 度読まない（同時の呼び出しでも）", async () => {
    const loadPrefTopo = vi.fn(async (p: string) => topoOf(p));
    const store = createGeoStore({ index, adjacency: {}, loadPrefTopo });
    await Promise.all([store.ensurePrefs(["33"]), store.ensurePrefs(["33", "31"]), store.ensurePrefs(["31"])]);
    await store.ensurePrefs(["33", "31"]);
    expect(loadPrefTopo.mock.calls.map((c) => c[0]).sort()).toEqual(["31", "33"]);
  });

  it("読み込みに失敗した県は、次の呼び出しでやり直せる", async () => {
    let calls = 0;
    const store = createGeoStore({
      index,
      adjacency: {},
      loadPrefTopo: async (p) => {
        calls += 1;
        if (calls === 1) throw new Error("一時的な失敗");
        return topoOf(p);
      },
    });
    await expect(store.ensurePrefs(["33"])).rejects.toThrow("一時的な失敗");
    expect(() => store.geometry("33203")).toThrow(GeoNotLoadedError);
    await store.ensurePrefs(["33"]);
    expect(store.geometry("33203").properties.c).toBe("33203");
  });

  it("県のファイルの形が違えば throw する（黙って空にしない）", async () => {
    const store = createGeoStore({ index, adjacency: {}, loadPrefTopo: async () => ({ type: "Topology", objects: {}, arcs: [] }) });
    await expect(store.ensurePrefs(["33"])).rejects.toThrow();
    expect(() => store.geometry("33203")).toThrow(GeoNotLoadedError);
  });
});

describe("isAdjacent", () => {
  const geo = makeGeo([
    { code: "33203", neighbors: ["31201"] },
    { code: "31201" },
    { code: "13421" },
  ]);
  it("隣り合いは両方向に引ける", () => {
    expect(isAdjacent("33203", "31201", geo)).toBe(true);
    expect(isAdjacent("31201", "33203", geo)).toBe(true);
  });
  it("自分とは隣でない／隣のない町やコードにない町は false", () => {
    expect(isAdjacent("33203", "33203", geo)).toBe(false);
    expect(isAdjacent("13421", "33203", geo)).toBe(false);
    expect(isAdjacent("99999", "33203", geo)).toBe(false);
  });
});

describe("findMuniByName", () => {
  const geo = makeGeo([
    { code: "03381", name: "金ケ崎町" },
    { code: "01233", name: "伊達市" },
    { code: "07213", name: "伊達市" },
    { code: "01403", name: "泊村" },
    { code: "01696", name: "泊村", prefCode: "01" },
    { code: "33203", name: "津山市" },
  ]);
  it("金ヶ崎町と金ケ崎町を同じに扱う", () => {
    expect(findMuniByName("03", "金ケ崎町", geo)).toBe("03381");
    expect(findMuniByName("03", "金ヶ崎町", geo)).toBe("03381");
  });
  it("別の県の同名の市を取らない", () => {
    expect(findMuniByName("01", "伊達市", geo)).toBe("01233");
    expect(findMuniByName("07", "伊達市", geo)).toBe("07213");
    expect(findMuniByName("33", "伊達市", geo)).toBeNull();
  });
  it("同じ県の同名（泊村 01403 と 01696）と不在は null", () => {
    expect(findMuniByName("01", "泊村", geo)).toBeNull();
    expect(findMuniByName("33", "存在しない町", geo)).toBeNull();
  });
  it("空白や全角の違いは正規化して比べる", () => {
    expect(findMuniByName("33", " 津山　市 ", geo)).toBe("33203");
  });
});
