// 地図の中央の十字の位置を、地点（3 次メッシュと市町村）にする。緯度経度はここで捨て、戻り値に残らない（設計書 §12）。
// maplibre の Map ではなく、必要な 4 つの操作だけを受けるので、偽の map で試験できる。
import { spotFromPick } from "../../data/spot";
import type { FarmPoint, MuniCode } from "@hpai/shared/types";

/** これより拡大していないと決められない（全国の倍率では約 1km のマス目に意味がない） */
export const SPOT_MIN_ZOOM = 10;

export interface PickTarget {
  getZoom(): number;
  getCenter(): { lat: number; lng: number };
  project(lngLat: { lat: number; lng: number }): { x: number; y: number };
  queryRenderedFeatures(point: { x: number; y: number }, options: { layers: string[] }): Array<{ properties?: Record<string, unknown> | null }>;
}

export type PickResult = { ok: true; spot: FarmPoint } | { ok: false; reason: "zoom" | "sea" };

export function pickFromMap(map: PickTarget, frequent: readonly MuniCode[]): PickResult {
  if (map.getZoom() < SPOT_MIN_ZOOM) return { ok: false, reason: "zoom" };
  const center = map.getCenter();
  const hit = map.queryRenderedFeatures(map.project(center), { layers: ["muni-fill"] })[0];
  const code = hit?.properties?.["c"];
  if (typeof code !== "string" || !/^\d{5}$/.test(code)) return { ok: false, reason: "sea" };
  try {
    return { ok: true, spot: spotFromPick(center.lat, center.lng, code, frequent) };
  } catch {
    return { ok: false, reason: "sea" }; // メッシュにならない位置
  }
}
