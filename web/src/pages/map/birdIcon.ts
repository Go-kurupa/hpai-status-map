// 野鳥の印（2026-11-07 作者の決定 A: 墨色の丸に白い鳥の形。検査中は白地の丸に墨の鳥）。
// 地図（MapView の addImage）、代わりの地図（SvgMap）、凡例（Legend）が同じ形を使う。画素は canvas を使わず直に作る。
import type { Rgb, RgbaImage } from "./hatch";

/**
 * 鳥の形（横向きの水鳥。頭とくちばしがあり、小さくても鳥と読める形。羽を広げた形は小さいと「∨」の矢印に見えたので使わない）。
 * 28 × 28 の枠の中の多角形。右向き
 */
export const BIRD_POLY: ReadonlyArray<readonly [number, number]> = [
  [4.6, 13.2],
  [7.5, 14.6],
  [11, 14.8],
  [14.5, 14.6],
  [16.2, 13.8],
  [16.4, 11.2],
  [17, 9.2],
  [18.6, 8.2],
  [20.2, 8.4],
  [21.2, 9.4],
  [23.8, 10.2],
  [23.8, 11],
  [21.2, 11.4],
  [20.4, 12.4],
  [19.6, 14.2],
  [21.4, 16],
  [21, 18.4],
  [19, 20.2],
  [15, 21],
  [10.5, 20.8],
  [7.4, 19.6],
  [5.8, 17.6],
  [5.2, 15.4],
];
/** SVG の points の文字列 */
export const BIRD_POINTS = BIRD_POLY.map(([x, y]) => `${x},${y}`).join(" ");
/** 枠の大きさと丸の半径（28 の枠の中） */
export const BIRD_BOX = 28;
export const BIRD_R = 12.5;
/** 地図での大きさ（CSS の px）。どの倍率でも同じ */
export const BIRD_ICON_PX = 26;

/** 点 (x, y) が多角形の中か（偶奇の規則） */
function inPoly(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = BIRD_POLY.length - 1; i < BIRD_POLY.length; j = i++) {
    const [xi, yi] = BIRD_POLY[i]!;
    const [xj, yj] = BIRD_POLY[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const WHITE: Rgb = [255, 255, 255];

/**
 * 野鳥の印の画像。confirmed は墨の丸に白い鳥、screening は白地の丸に墨の縁と墨の鳥。どちらも外に白い縁を付けて地図の上で浮かせる。
 * size は画素（pixelRatio 2 なら CSS の size / 2 px）。
 */
export function birdImage(kind: "confirmed" | "screening", ink: Rgb, size = 56): RgbaImage {
  const img: RgbaImage = { width: size, height: size, data: new Uint8Array(size * size * 4) };
  const k = size / BIRD_BOX;
  const c = size / 2;
  const r = BIRD_R * k;
  const halo = 1.3 * k;
  const ring = 1.8 * k;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      const d = Math.hypot(x - c, y - c);
      let col: Rgb | null = null;
      if (d <= r) {
        const bird = inPoly(x / k, y / k);
        if (kind === "confirmed") col = bird ? WHITE : ink;
        else col = bird || d > r - ring ? ink : WHITE;
      } else if (d <= r + halo) col = WHITE;
      if (col) {
        const i = (py * size + px) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    }
  }
  return img;
}
