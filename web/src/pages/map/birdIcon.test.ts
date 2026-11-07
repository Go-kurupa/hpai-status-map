import { describe, expect, it } from "vitest";
import { BIRD_BOX, BIRD_POINTS, BIRD_POLY, BIRD_R, birdImage } from "./birdIcon";

const INK = [26, 26, 26] as const;
const at = (img: { width: number; data: Uint8Array }, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const WHITE = [255, 255, 255, 255];
const INK_PX = [...INK, 255];

describe("birdImage（野鳥の印 A）", () => {
  const size = 56;
  const k = size / BIRD_BOX;
  // 鳥の胴の中の点と、丸の中で鳥の外の点（28 の枠の座標）
  const inBird = [Math.floor(13 * k), Math.floor(18 * k)] as const;
  const inDisc = [Math.floor(14 * k), Math.floor(5 * k)] as const;

  it("確定は墨の丸に白い鳥。検査中は白地の丸に墨の鳥（形と塗りで見分けられる）", () => {
    const c = birdImage("confirmed", INK, size);
    const s = birdImage("screening", INK, size);
    expect(at(c, ...inBird)).toEqual(WHITE);
    expect(at(c, ...inDisc)).toEqual(INK_PX);
    expect(at(s, ...inBird)).toEqual(INK_PX);
    expect(at(s, ...inDisc)).toEqual(WHITE);
  });

  it("丸の外の角は透明。丸のすぐ外は白い縁（地図の上で浮かせる）", () => {
    for (const kind of ["confirmed", "screening"] as const) {
      const img = birdImage(kind, INK, size);
      expect(at(img, 0, 0)[3]).toBe(0);
      const edge = Math.floor(size / 2 + BIRD_R * k + 0.6 * k);
      expect(at(img, edge, Math.floor(size / 2))).toEqual(WHITE);
    }
  });

  it("鳥の形は枠と丸の中に収まる。SVG の points は同じ多角形", () => {
    for (const [x, y] of BIRD_POLY) {
      expect(Math.hypot(x - BIRD_BOX / 2, y - BIRD_BOX / 2)).toBeLessThan(BIRD_R);
    }
    expect(BIRD_POINTS.split(" ")).toHaveLength(BIRD_POLY.length);
  });
});
