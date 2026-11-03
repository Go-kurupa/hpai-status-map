import { describe, expect, it, vi } from "vitest";
import { pickFromMap, SPOT_MIN_ZOOM, type PickTarget } from "./pickSpot";

function fakeMap(o: { zoom?: number; center?: { lat: number; lng: number }; hit?: string | null } = {}) {
  const query = vi.fn((_p: { x: number; y: number }, _o: { layers: string[] }) =>
    o.hit === null ? [] : [{ properties: { c: o.hit ?? "13101" } }],
  );
  const map: PickTarget = {
    getZoom: () => o.zoom ?? 12,
    getCenter: () => o.center ?? { lat: 35.681, lng: 139.767 },
    project: () => ({ x: 195, y: 260 }),
    queryRenderedFeatures: query,
  };
  return { map, query };
}

describe("pickFromMap（中央の十字の位置を地点にする）", () => {
  it("十字の位置を muni-fill で市町村にし、メッシュと市町村だけの地点にする。座標は残らない", () => {
    const { map, query } = fakeMap();
    const r = pickFromMap(map, ["13102"]);
    expect(r).toEqual({ ok: true, spot: { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: ["13102"] } });
    expect(JSON.stringify(r)).not.toMatch(/lat|lng|35\.68|139\.76/);
    expect(query).toHaveBeenCalledWith({ x: 195, y: 260 }, { layers: ["muni-fill"] });
  });

  it("海の上（形がない）は『町の上に合わせてください』の理由で断る", () => {
    expect(pickFromMap(fakeMap({ hit: null }).map, [])).toEqual({ ok: false, reason: "sea" });
  });

  it("拡大が足りないと決められない（約 1km のマス目が意味を持たないため）", () => {
    expect(SPOT_MIN_ZOOM).toBeGreaterThanOrEqual(9);
    expect(pickFromMap(fakeMap({ zoom: SPOT_MIN_ZOOM - 0.1 }).map, [])).toEqual({ ok: false, reason: "zoom" });
    expect(pickFromMap(fakeMap({ zoom: SPOT_MIN_ZOOM }).map, []).ok).toBe(true);
  });

  it("コードが 5 桁でない形は海の扱い（壊れた地物から地点を作らない）", () => {
    expect(pickFromMap(fakeMap({ hit: "x" }).map, [])).toEqual({ ok: false, reason: "sea" });
  });

  it("メッシュにならない位置（範囲の外）は海の扱いにして投げない", () => {
    expect(pickFromMap(fakeMap({ center: { lat: -80, lng: 10 } }).map, [])).toEqual({ ok: false, reason: "sea" });
  });
});
