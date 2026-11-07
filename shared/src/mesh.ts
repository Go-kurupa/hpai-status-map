// 3 次メッシュ（基準地域メッシュ。約 1km 四方）。緯度経度は端末の外へ出さず、メッシュのコードだけを保存する。
// 緯度は 30 秒（1/120 度）、経度は 45 秒（1/80 度）を 1 マスとして、整数で桁を取る（マス目の角で下にずれない）。
import type { MeshCode } from "./types";

const LAT_CELLS_PER_DEG = 120; // 3 次メッシュの高さ = 30 秒
const LNG_CELLS_PER_DEG = 80; // 3 次メッシュの幅 = 45 秒
const EPS = 1e-9; // 浮動小数の誤差でマス目の角が下にずれるのを防ぐ

/** 緯度経度（世界測地系）を 3 次メッシュ 8 桁にする。範囲の外や数でない値は throw する。 */
export function latLngToMesh3(lat: number, lng: number): MeshCode {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new RangeError(`緯度経度が数ではありません: ${lat}, ${lng}`);
  const latCells = Math.floor(lat * LAT_CELLS_PER_DEG + EPS);
  const lngCells = Math.floor((lng - 100) * LNG_CELLS_PER_DEG + EPS);
  const p = Math.floor(latCells / 80); // 1 次: 緯度 40 分 = 80 マス
  const u = Math.floor(lngCells / 80); // 1 次: 経度 1 度 = 80 マス
  if (latCells < 0 || lngCells < 0 || p > 99 || u > 99) {
    throw new RangeError(`メッシュの範囲の外です（北緯 0〜66 度、東経 100〜200 度）: ${lat}, ${lng}`);
  }
  const q = Math.floor((latCells % 80) / 10); // 2 次: 0〜7
  const v = Math.floor((lngCells % 80) / 10);
  const r = latCells % 10; // 3 次: 0〜9
  const w = lngCells % 10;
  return `${String(p).padStart(2, "0")}${String(u).padStart(2, "0")}${q}${v}${r}${w}`;
}

/** 3 次メッシュ 8 桁の中心。不正なコードは throw する。 */
export function mesh3Center(code: MeshCode): { lat: number; lng: number } {
  const b = mesh3Bounds(code);
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** 3 次メッシュ 8 桁の四隅（南、北の緯度と、西、東の経度）。不正なコードは throw する。 */
export function mesh3Bounds(code: MeshCode): { south: number; north: number; west: number; east: number } {
  if (!/^\d{8}$/.test(code)) throw new RangeError(`メッシュコードは 8 桁の数字です: ${code}`);
  const p = Number(code.slice(0, 2));
  const u = Number(code.slice(2, 4));
  const q = Number(code[4]);
  const v = Number(code[5]);
  const r = Number(code[6]);
  const w = Number(code[7]);
  if (q > 7 || v > 7) throw new RangeError(`メッシュコードの 2 次の桁は 0〜7 です: ${code}`);
  const latCells = p * 80 + q * 10 + r;
  const lngCells = u * 80 + v * 10 + w;
  return {
    south: latCells / LAT_CELLS_PER_DEG,
    north: (latCells + 1) / LAT_CELLS_PER_DEG,
    west: 100 + lngCells / LNG_CELLS_PER_DEG,
    east: 100 + (lngCells + 1) / LNG_CELLS_PER_DEG,
  };
}
