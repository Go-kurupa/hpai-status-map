// 地図に載せる小さな画像（斜線と野鳥の印）を、画素から直に作る。canvas も外部の画像ファイルも使わない。
// maplibre の addImage に渡せる形（RGBA、straight alpha）。
export type Rgb = readonly [number, number, number];

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const WHITE: Rgb = [255, 255, 255];

function blank(size: number): RgbaImage {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

function put(img: RgbaImage, x: number, y: number, [r, g, b]: Rgb): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = 255;
}

/** 斜線の周期と線の太さ（画素）。代わりの地図（SvgMap）の SVG の模様も同じ数を使う */
export const HATCH_PERIOD = 12;
export const HATCH_STRIPE = 3;
/** 地図に登録するときの画素の比（addImage の pixelRatio）。1 画素は 1 / HATCH_PIXEL_RATIO の CSS の px */
export const HATCH_PIXEL_RATIO = 2;

/**
 * 右上がりの斜線。周期 12 画素の中の 3 画素が線で、繰り返しても継ぎ目が出ない。
 * 疑い（--lv1 の線）と、確認できていない県（--muted の線）に使う。
 */
export function hatchImage(color: Rgb, period = HATCH_PERIOD, stripe = HATCH_STRIPE): RgbaImage {
  const img = blank(period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      if ((x + y) % period < stripe) put(img, x, y, color);
    }
  }
  return img;
}

function shape(size: number, paint: (dx: number, dy: number) => Rgb | null): RgbaImage {
  const img = blank(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = paint(x + 0.5 - size / 2, y + 0.5 - size / 2);
      if (c) put(img, x, y, c);
    }
  }
  return img;
}

/** 野鳥の「検査中」の印。輪（中は抜ける）。白い縁で地図の上でも見える */
export function ringImage(color: Rgb, size = 24): RgbaImage {
  const outer = size * 0.3;
  const inner = size * 0.18;
  return shape(size, (dx, dy) => {
    const d = Math.hypot(dx, dy);
    if (d >= inner && d <= outer) return color;
    if ((d >= inner - 1.5 && d < inner) || (d > outer && d <= outer + 1.5)) return WHITE;
    return null;
  });
}

/** 野鳥の「高病原性の確定」の印。塗りつぶした四角。白い縁つき */
export function squareImage(color: Rgb, size = 24): RgbaImage {
  const half = size * 0.26;
  return shape(size, (dx, dy) => {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d <= half) return color;
    if (d <= half + 1.5) return WHITE;
    return null;
  });
}

/** "#b3261e" → [179, 38, 30] */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`色は #rrggbb で書いてください: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
