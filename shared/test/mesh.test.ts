import { describe, expect, it } from "vitest";
import { latLngToMesh3, mesh3Bounds, mesh3Center } from "../src/mesh";

describe("latLngToMesh3", () => {
  it("東京駅付近は 53394611", () => {
    expect(latLngToMesh3(35.681, 139.767)).toBe("53394611");
  });

  it("マス目の角で下にずれない（北緯 36 度、東経 140 度は 54400000）", () => {
    expect(latLngToMesh3(36, 140)).toBe("54400000");
  });

  it("3 次メッシュの境界（30 秒、45 秒）でも次のマスに入る", () => {
    // 北緯 35 度 00 分 30 秒、東経 139 度 00 分 45 秒 → 下一桁が 1 つ進む
    expect(latLngToMesh3(35 + 30 / 3600, 139 + 45 / 3600)).toBe("52394011");
    expect(latLngToMesh3(35 + 29 / 3600, 139 + 44 / 3600)).toBe("52394000");
  });

  it("範囲の外や数でない値は throw する", () => {
    expect(() => latLngToMesh3(Number.NaN, 139)).toThrow();
    expect(() => latLngToMesh3(35, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => latLngToMesh3(-5, 139)).toThrow();
    expect(() => latLngToMesh3(35, 99)).toThrow();
    expect(() => latLngToMesh3(70, 139)).toThrow();
    expect(() => latLngToMesh3(35, 200)).toThrow();
  });
});

describe("mesh3Center", () => {
  it("53394611 の中心は 35.6791667、139.76875", () => {
    const c = mesh3Center("53394611");
    expect(c.lat).toBeCloseTo(35.6791667, 6);
    expect(c.lng).toBeCloseTo(139.76875, 6);
  });

  it("中心は同じマス目に戻る", () => {
    for (const code of ["53394611", "54400000", "52394011", "62411099", "36230779"]) {
      const c = mesh3Center(code);
      expect(latLngToMesh3(c.lat, c.lng)).toBe(code);
    }
  });

  it("不正なコードは throw する", () => {
    for (const bad of ["", "5339461", "533946111", "5339461a", "53394811", "53398611", "5339 4611"]) {
      expect(() => mesh3Center(bad)).toThrow();
    }
  });
});

describe("mesh3Bounds", () => {
  it("53394611 は緯度 30 秒・経度 45 秒の四角で、中心を囲む", () => {
    const b = mesh3Bounds("53394611");
    expect(b.south).toBeCloseTo(35.675, 9);
    expect(b.north).toBeCloseTo(35.675 + 1 / 120, 9);
    expect(b.west).toBeCloseTo(139.7625, 9);
    expect(b.east).toBeCloseTo(139.7625 + 1 / 80, 9);
    const c = mesh3Center("53394611");
    expect((b.south + b.north) / 2).toBeCloseTo(c.lat, 9);
    expect((b.west + b.east) / 2).toBeCloseTo(c.lng, 9);
  });

  it("四隅の内側は同じマス目に戻る", () => {
    const b = mesh3Bounds("52394011");
    expect(latLngToMesh3(b.south + 1e-6, b.west + 1e-6)).toBe("52394011");
    expect(latLngToMesh3(b.north - 1e-6, b.east - 1e-6)).toBe("52394011");
  });

  it("不正なコードは throw する", () => {
    expect(() => mesh3Bounds("53398611")).toThrow();
  });
});
