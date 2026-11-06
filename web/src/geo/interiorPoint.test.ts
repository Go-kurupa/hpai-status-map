import { describe, expect, it } from "vitest";
import { insideGeometry, interiorPoint } from "./interiorPoint";

// 正方形 0..10
const square: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
// 「コ」の字（右側が空いている）。外枠の四角の中心 (5, 5) は形の外
const cShape: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10], [0, 0]]],
};
// 穴あき（真ん中に穴）
const donut: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};
// 小さな島と大きな本土
const islands: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [[[100, 0], [101, 0], [101, 1], [100, 1], [100, 0]]],
    [[[0, 0], [20, 0], [20, 4], [0, 4], [0, 0]]],
  ],
};

describe("insideGeometry", () => {
  it("中、外、穴の中を見分ける", () => {
    expect(insideGeometry([5, 5], square)).toBe(true);
    expect(insideGeometry([11, 5], square)).toBe(false);
    expect(insideGeometry([5, 5], cShape)).toBe(false);
    expect(insideGeometry([1, 5], cShape)).toBe(true);
    expect(insideGeometry([5, 5], donut)).toBe(false);
    expect(insideGeometry([2, 5], donut)).toBe(true);
    expect(insideGeometry([100.5, 0.5], islands)).toBe(true);
  });
});

describe("interiorPoint", () => {
  it("望む点が形の中なら、その点のまま", () => {
    expect(interiorPoint(square, [2, 3])).toEqual([2, 3]);
  });
  it("望む点が形の外なら、形の中の点を返す（コの字、穴あき）", () => {
    for (const g of [cShape, donut]) {
      const p = interiorPoint(g, [5, 5]);
      expect(insideGeometry(p, g)).toBe(true);
    }
  });
  it("いちばん大きな面の中から選ぶ（小さな島ではなく本土）", () => {
    const p = interiorPoint(islands, [50, 50]);
    expect(insideGeometry(p, islands)).toBe(true);
    expect(p[0]).toBeLessThan(20);
  });
});
