// maplibre-gl はここから import する。ワーカーの場所を渡さないと vite の build で地図が出ない【確】。
// 地図を使う画面（pages/map/MapView、M-01 の地点の選択）だけがこのファイルを読む（別の chunk になる）。
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

export { AttributionControl, Map as MlMap, Marker } from "maplibre-gl";
export type { LngLatBoundsLike, MapGeoJSONFeature } from "maplibre-gl";
