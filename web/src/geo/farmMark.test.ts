import { mesh3Bounds } from "@hpai/shared/mesh";
import { describe, expect, it } from "vitest";
import { FARM_MARK_PX, farmMeshFeature, farmSquareShown } from "./farmMark";

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
