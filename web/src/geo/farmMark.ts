// 鶏舎の場所の印（作者 11/7、設計書 2026-11-03 §2 の「農場を点で示さない」の例外）。
// 端末に保存した約 1km のマス目をそのまま四角で描く。点（緯度経度）にはしない。描くのはこの端末の画面だけで、送らない。
import { mesh3Bounds } from "@hpai/shared/mesh";
import type { Feature, Polygon } from "geojson";

/** 全国の広さで出す、一定の大きさの四角の一辺（画面の px） */
export const FARM_MARK_PX = 14;

export type FarmMeshFeature = Feature<Polygon, Record<string, never>>;

/** マス目の四隅の四角。地点がない、形の違うコードは null */
export function farmMeshFeature(meshCode: string | null | undefined): FarmMeshFeature | null {
  if (!meshCode) return null;
  let b: ReturnType<typeof mesh3Bounds>;
  try {
    b = mesh3Bounds(meshCode);
  } catch {
    return null;
  }
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [b.west, b.south],
          [b.east, b.south],
          [b.east, b.north],
          [b.west, b.north],
          [b.west, b.south],
        ],
      ],
    },
  };
}

/** 1km が何 px に見えるか。マス目が FARM_MARK_PX より小さく見える広さでは、一定の大きさの四角に替える */
export function farmSquareShown(pxPerKm: number): boolean {
  return pxPerKm < FARM_MARK_PX;
}

/** 印の大きさ（見た目だけ。2026-11-07 作者の決定）。l: マス目を塗る、m: 点線の枠と縦横半分の塗り、s: 点線の枠と一定の大きさの四角 */
export type FarmMarkSize = "l" | "m" | "s";
/** full: 塗るマス目、frame: 点線の枠、core: 中心の塗り */
export type FarmMarkKind = "full" | "frame" | "core";
export type FarmMarkFeature = Feature<Polygon, { kind: FarmMarkKind }>;

/** 印の大きさごとの形。中・小でも約 1km の範囲は点線の枠で残す（正確な場所が分かっているように見せない） */
export function farmMarkFeatures(meshCode: string | null | undefined, size: FarmMarkSize): FarmMarkFeature[] {
  const mesh = farmMeshFeature(meshCode);
  if (!mesh) return [];
  const as = (kind: FarmMarkKind, geometry: Polygon): FarmMarkFeature => ({ type: "Feature", properties: { kind }, geometry });
  if (size === "l") return [as("full", mesh.geometry)];
  if (size === "s") return [as("frame", mesh.geometry)];
  const b = mesh3Bounds(meshCode!);
  const dx = (b.east - b.west) / 4;
  const dy = (b.north - b.south) / 4;
  const [w, s, e, n] = [b.west + dx, b.south + dy, b.east - dx, b.north - dy];
  return [
    as("frame", mesh.geometry),
    as("core", { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }),
  ];
}
