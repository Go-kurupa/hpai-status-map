import { DISTANCE_BAND_KM } from "@hpai/shared/level";
import { latLngToMesh3, mesh3Center } from "@hpai/shared/mesh";
import { describe, expect, it } from "vitest";
import { distanceRingsOf, pxPerKmAtZoom, RING_KMS, ringLabel, ringTop, visibleRingKms } from "./distanceRings";

const MESH = latLngToMesh3(35.07, 134.0); // 津山市のあたり

/** 球面の距離（km） */
function haversineKm(a: readonly number[], b: readonly number[]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1]! - a[1]!);
  const dLng = rad(b[0]! - a[0]!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1]!)) * Math.cos(rad(b[1]!)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

describe("距離の輪の形", () => {
  it("10、30、60km の 3 本。外の輪は距離の帯と同じ値", () => {
    expect(RING_KMS).toEqual([10, 30, 60]);
    expect(RING_KMS[RING_KMS.length - 1]).toBe(DISTANCE_BAND_KM);
    const rings = distanceRingsOf(MESH)!;
    expect(rings.type).toBe("FeatureCollection");
    expect(rings.features.map((f) => f.properties.km)).toEqual([10, 30, 60]);
  });

  it("各点がマス目の中心から半径の距離にあり、輪が閉じている", () => {
    const { lat, lng } = mesh3Center(MESH);
    for (const f of distanceRingsOf(MESH)!.features) {
      expect(f.geometry.type).toBe("Polygon");
      const ring = f.geometry.coordinates[0]!;
      expect(ring.length).toBeGreaterThanOrEqual(65);
      expect(ring[ring.length - 1]).toEqual(ring[0]);
      for (const p of ring) expect(haversineKm([lng, lat], p)).toBeCloseTo(f.properties.km, 6);
    }
  });

  it("輪の一番上は中心の真北にある（ラベルの場所）", () => {
    const { lat, lng } = mesh3Center(MESH);
    const [f] = distanceRingsOf(MESH)!.features;
    const top = ringTop(f!);
    expect(top[0]).toBeCloseTo(lng, 9);
    expect(top[1]).toBeGreaterThan(lat);
    expect(haversineKm([lng, lat], top)).toBeCloseTo(10, 6);
  });

  it("地点がない、不正なマス目なら輪を作らない（画面を落とさない）", () => {
    expect(distanceRingsOf(null)).toBeNull();
    expect(distanceRingsOf(undefined)).toBeNull();
    expect(distanceRingsOf("abc")).toBeNull();
    expect(distanceRingsOf("51339957")).toBeNull(); // 2 次の桁が 8 以上
  });
});

describe("輪のラベル", () => {
  it("距離には「約」を付ける", () => {
    expect(ringLabel(10)).toBe("約 10 km");
    expect(ringLabel(60)).toBe("約 60 km");
  });

  it("輪が小さい倍率では出さず、重ならない間隔があるものだけ出す", () => {
    expect(visibleRingKms(0.1)).toEqual([]); // 全国の倍率。60km の輪が 6px
    expect(visibleRingKms(0.5)).toEqual([60]); // 60km が 30px、30km と 15px しか離れない
    expect(visibleRingKms(1)).toEqual([60, 30]); // 30km と 60km が 30px 離れる。10km とは 20px
    expect(visibleRingKms(2)).toEqual([60, 30]); // 10km の輪が 20px でまだ小さい
    expect(visibleRingKms(2.4)).toEqual([60, 30, 10]);
  });

  it("倍率から 1km の画素数を出す。倍率が 1 上がると 2 倍、北ほど大きい", () => {
    const z7 = pxPerKmAtZoom(7, 35);
    expect(z7).toBeGreaterThan(1.8);
    expect(z7).toBeLessThan(2.2);
    expect(pxPerKmAtZoom(8, 35)).toBeCloseTo(z7 * 2, 9);
    expect(pxPerKmAtZoom(7, 43)).toBeGreaterThan(z7);
  });
});
