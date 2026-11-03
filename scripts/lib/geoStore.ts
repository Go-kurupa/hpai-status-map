// スクリプトから data/geo/ の GeoStore を使う。サーバーと同じ読み込み（functions/src/geo/loadGeo.ts）を通す。
import path from "node:path";
import type { GeoStore } from "../../shared/src/geo";
import { loadGeoStore } from "../../functions/src/geo/loadGeo";

export const GEO_DIR = path.resolve(import.meta.dirname, "..", "..", "data", "geo");

export function loadScriptGeoStore(): Promise<GeoStore> {
  return loadGeoStore(GEO_DIR);
}
