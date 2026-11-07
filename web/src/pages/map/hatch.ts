// 地図に載せる小さな画像（斜線）を、画素から直に作る。canvas も外部の画像ファイルも使わない。
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
 * 斜線。既定は右上がり（"up"）。周期 12 画素の中の 3 画素が線で、繰り返しても継ぎ目が出ない。
 * 疑い（--lv1 の線）と、確認できていない県（--muted の線）に使う。
 * 右下がり（"down"）は右上がりの左右反転で、過去シーズンとの重ね合わせの「比べる 2」に使う（設計書 2026-11-06-data-explore E8）。
 */
export function hatchImage(color: Rgb, period = HATCH_PERIOD, stripe = HATCH_STRIPE, dir: "up" | "down" = "up"): RgbaImage {
  const img = blank(period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      const sx = dir === "up" ? x : period - 1 - x;
      if ((sx + y) % period < stripe) put(img, x, y, color);
    }
  }
  return img;
}

/**
 * 色で塗りつぶし、斜線を白く抜いた模様（過去シーズンとの重ね合わせ。作者 11/6 夜の決定「C」）。
 * 細い色の斜線だけでは背景の地図に埋もれるので、町を色で塗る。白い線の向き（up は右上がり、down は右下がり、cross は両方）で
 * 「比べる 1 だけ」「比べる 2 だけ」「両方」を見分けられるようにし、色だけで読ませない。
 */
export function filledHatchImage(color: Rgb, dir: "up" | "down" | "cross", period = HATCH_PERIOD, stripe = HATCH_STRIPE): RgbaImage {
  const img = blank(period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      const up = (x + y) % period < stripe;
      const down = (period - 1 - x + y) % period < stripe;
      const white = dir === "up" ? up : dir === "down" ? down : up || down;
      const i = (y * period + x) * 4;
      const [r, g, b] = white ? WHITE : color;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      // 少しだけ透かして、下の地図の線がうっすら見えるようにする
      img.data[i + 3] = white ? 230 : 235;
    }
  }
  return img;
}

/** 網目（右上がりと右下がりの和）。重ね合わせの「両方で発生」に使っていた（いまは filledHatchImage の cross） */
export function crossHatchImage(color: Rgb, period = HATCH_PERIOD, stripe = HATCH_STRIPE): RgbaImage {
  const img = blank(period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      if ((x + y) % period < stripe || (period - 1 - x + y) % period < stripe) put(img, x, y, color);
    }
  }
  return img;
}


/** "#b3261e" → [179, 38, 30] */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`色は #rrggbb で書いてください: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
