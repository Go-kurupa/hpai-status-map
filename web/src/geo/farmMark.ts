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
