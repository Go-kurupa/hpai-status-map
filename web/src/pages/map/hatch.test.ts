import { describe, expect, it } from "vitest";
import { crossHatchImage, hatchImage, ringImage, squareImage } from "./hatch";

function alphaAt(img: { width: number; data: Uint8Array | Uint8ClampedArray }, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3]!;
}

describe("画像", () => {
  it("斜線は、線の色の画素と透明な画素の両方があり、周期で繰り返す", () => {
    const img = hatchImage([179, 38, 30]);
    expect(img.data.length).toBe(img.width * img.height * 4);
    const alphas = new Set<number>();
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) alphas.add(alphaAt(img, x, y));
    expect([...alphas].sort()).toEqual([0, 255]);
    const first = img.data.slice(0, 4);
    expect([...first]).toEqual(alphaAt(img, 0, 0) === 255 ? [179, 38, 30, 255] : [0, 0, 0, 0]);
  });

  it("斜線は右上がり（x+y が一定の画素が同じ濃さ）", () => {
    const img = hatchImage([0, 0, 0]);
    const a = alphaAt(img, 3, 0);
    expect(alphaAt(img, 2, 1)).toBe(a);
    expect(alphaAt(img, 1, 2)).toBe(a);
  });

  it("右下がりの斜線は、右上がりの左右反転。既定は今までと同じ右上がり", () => {
    const up = hatchImage([0, 0, 0]);
    const down = hatchImage([0, 0, 0], undefined, undefined, "down");
    expect([...hatchImage([0, 0, 0], undefined, undefined, "up").data]).toEqual([...up.data]);
    for (let y = 0; y < up.height; y++) for (let x = 0; x < up.width; x++) expect(alphaAt(down, x, y)).toBe(alphaAt(up, up.width - 1 - x, y));
  });

  it("網目は、右上がりと右下がりの和", () => {
    const up = hatchImage([0, 0, 0]);
    const down = hatchImage([0, 0, 0], undefined, undefined, "down");
    const cross = crossHatchImage([0, 0, 0]);
    for (let y = 0; y < up.height; y++)
      for (let x = 0; x < up.width; x++) expect(alphaAt(cross, x, y)).toBe(Math.max(alphaAt(up, x, y), alphaAt(down, x, y)));
  });

  it("野鳥の印は、検査中が輪で確定が塗りつぶし（形で区別できる）", () => {
    const ring = ringImage([27, 29, 33]);
    const sq = squareImage([27, 29, 33]);
    const c = Math.floor(ring.width / 2);
    expect(alphaAt(ring, c, c)).toBe(0);
    expect(alphaAt(sq, c, c)).toBe(255);
  });
});
