import { mesh3Bounds } from "@hpai/shared/mesh";
import { describe, expect, it } from "vitest";
import { FARM_MARK_PX, farmMarkFeatures, farmMeshFeature, farmSquareShown } from "./farmMark";

describe("鶏舎の場所のマス目（作者 11/7）", () => {
  it("マス目の四隅を閉じた四角にする（中心の点は持たない）", () => {
    const f = farmMeshFeature("53394611")!;
    const b = mesh3Bounds("53394611");
    expect(f.geometry.type).toBe("Polygon");
    expect(f.geometry.coordinates[0]).toEqual([
      [b.west, b.south],
      [b.east, b.south],
      [b.east, b.north],
      [b.west, b.north],
      [b.west, b.south],
    ]);
  });

  it("地点がない、形の違うコードは null", () => {
    expect(farmMeshFeature(null)).toBeNull();
    expect(farmMeshFeature("53398611")).toBeNull();
  });

  it("マス目が 14px より小さく見える広さでは、一定の大きさの四角を出す", () => {
    expect(FARM_MARK_PX).toBe(14);
    expect(farmSquareShown(0.5)).toBe(true); // 全国の広さ
    expect(farmSquareShown(13.9)).toBe(true);
    expect(farmSquareShown(14)).toBe(false); // 寄ったら本当のマス目
    expect(farmSquareShown(80)).toBe(false);
  });
});

describe("鶏舎の印の大きさ（見た目だけ。保存と距離は約 1km のマス目のまま。2026-11-07 作者の決定）", () => {
  const b = mesh3Bounds("53394611");
  it("大はマス目を塗る 1 つ（full）", () => {
    const fs = farmMarkFeatures("53394611", "l");
    expect(fs.map((f) => f.properties.kind)).toEqual(["full"]);
    expect(fs[0]!.geometry).toEqual(farmMeshFeature("53394611")!.geometry);
  });
  it("中はマス目の点線の枠（frame）と、中心に縦横半分の塗り（core）", () => {
    const fs = farmMarkFeatures("53394611", "m");
    expect(fs.map((f) => f.properties.kind)).toEqual(["frame", "core"]);
    expect(fs[0]!.geometry).toEqual(farmMeshFeature("53394611")!.geometry);
    const ring = fs[1]!.geometry.coordinates[0]!;
    const w = b.east - b.west;
    const h = b.north - b.south;
    expect(ring[0]![0]).toBeCloseTo(b.west + w / 4, 10);
    expect(ring[0]![1]).toBeCloseTo(b.south + h / 4, 10);
    expect(ring[2]![0]).toBeCloseTo(b.east - w / 4, 10);
    expect(ring[2]![1]).toBeCloseTo(b.north - h / 4, 10);
  });
  it("小はマス目の点線の枠だけ（一定の大きさの四角は地図の部品が描く）", () => {
    expect(farmMarkFeatures("53394611", "s").map((f) => f.properties.kind)).toEqual(["frame"]);
  });
  it("地点がなければ空", () => {
    expect(farmMarkFeatures(null, "m")).toEqual([]);
  });
});
