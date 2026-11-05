// 距離の輪（農場から 10、30、60km）の形。発表の区域とは別物で、距離の目安を示す（純粋な関数だけ）。
// 中心は端末の中のマス目の中心。ここで作る座標は地図に渡すだけで、保存も送信もしない。
import { DISTANCE_BAND_KM } from "@hpai/shared/level";
import { mesh3Center } from "@hpai/shared/mesh";

export const RING_KMS = [10, 30, DISTANCE_BAND_KM] as const;

/** turf の既定と同じ地球の半径（km） */
const EARTH_RADIUS_KM = 6371.0088;
/** 1 本の輪の点の数。60km の輪でも角が見えない */
const RING_POINTS = 96;
/** ラベルを出すのに要る間隔（画素）。文字の高さ（約 20px）より少し広い */
const LABEL_GAP_PX = 24;

export interface RingFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [lng: number, lat: number][][] };
  properties: { km: number };
}

export interface DistanceRings {
  type: "FeatureCollection";
  features: RingFeature[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** 中心から方位 bearing（度）へ km 進んだ点（球面）。bearing 0 は真北 */
function destination(lat: number, lng: number, km: number, bearing: number): [number, number] {
  const d = km / EARTH_RADIUS_KM;
  const b = rad(bearing);
  const la = rad(lat);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const dLng = Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [lng + deg(dLng), deg(la2)];
}

/** マス目の中心を囲む 3 本の輪。地点がない、不正なマス目なら null */
export function distanceRingsOf(meshCode: string | null | undefined): DistanceRings | null {
  if (!meshCode) return null;
  let center: { lat: number; lng: number };
  try {
    center = mesh3Center(meshCode);
  } catch {
    return null;
  }
  return {
    type: "FeatureCollection",
    features: RING_KMS.map((km) => {
      const ring = Array.from({ length: RING_POINTS }, (_, i) => destination(center.lat, center.lng, km, (i * 360) / RING_POINTS));
      ring.push(ring[0]!);
      return { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [ring] }, properties: { km } };
    }),
  };
}

/** 輪の一番上の点（中心の真北）。ラベルをここの上に置く */
export function ringTop(f: RingFeature): [number, number] {
  return f.geometry.coordinates[0]![0]!;
}

export function ringLabel(km: number): string {
  return `約 ${km} km`;
}

/** 今の縮尺でラベルを出す輪（外から順）。輪が小さすぎる倍率では出さず、上の点どうしが近いラベルは省く */
export function visibleRingKms(pxPerKm: number): number[] {
  const out: number[] = [];
  for (const km of [...RING_KMS].reverse()) {
    const last = out[out.length - 1];
    if (km * pxPerKm >= LABEL_GAP_PX && (last === undefined || (last - km) * pxPerKm >= LABEL_GAP_PX)) out.push(km);
  }
  return out;
}

/** MapLibre の倍率での 1km の画素数（世界の幅は 512 × 2^倍率 の画素） */
export function pxPerKmAtZoom(zoom: number, lat: number): number {
  return (512 * 2 ** zoom) / (2 * Math.PI * EARTH_RADIUS_KM * Math.cos(rad(lat)));
}
