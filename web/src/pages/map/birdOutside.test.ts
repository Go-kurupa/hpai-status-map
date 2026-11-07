import { describe, expect, it } from "vitest";
import { haversineKm } from "@hpai/shared/geo";
import type { WildBird } from "@hpai/shared/types";
import { birdPosition, birdsFarText } from "./birdOutside";

const bird = (o: Partial<WildBird> & { id: string }): WildBird => ({
  season: 2026,
  date: "2026-11-02",
  prefCode: "05",
  muniCode: null,
  muniName: null,
  species: null,
  test: "hpai_confirmed",
  focusZone: { from: null, to: null },
  sourceUrl: "https://example.invalid/b",
  ...o,
});

const CENTER = [140, 39] as const;
const index = {
  "05210": { center: [140.1, 39.1] as [number, number] }, // 中心から約 14 km
  "01631": { center: [143, 43] as [number, number] }, // 遠い
};
const anchors = { "05": [140.2, 39.2] as [number, number], "46": [130.6, 31.6] as [number, number] };

describe("birdPosition（地図と同じ印の位置）", () => {
  it("町の中心、なければ県の代表の位置、どちらもなければ null", () => {
    expect(birdPosition({ muniCode: "05210", prefCode: "05" }, index, anchors)).toEqual([140.1, 39.1]);
    expect(birdPosition({ muniCode: null, prefCode: "05" }, index, anchors)).toEqual([140.2, 39.2]);
    expect(birdPosition({ muniCode: "99999", prefCode: "46" }, index, anchors)).toEqual([130.6, 31.6]);
    expect(birdPosition({ muniCode: null, prefCode: "01" }, index, anchors)).toBeNull();
    expect(birdPosition({ muniCode: null, prefCode: "05" }, index, null)).toBeNull();
  });
});

describe("birdsFarText（約 60 km より遠い野鳥の陽性）", () => {
  it("遠い陽性の県名だけ。近い件と陰性は入れない", () => {
    const birds = [
      bird({ id: "a", muniCode: "05210", prefCode: "05" }),
      bird({ id: "b", muniCode: "01631", prefCode: "01" }),
      bird({ id: "c", muniCode: null, prefCode: "46" }),
      bird({ id: "n", muniCode: "01631", prefCode: "01", test: "negative", date: "2026-11-05" }),
    ];
    expect(birdsFarText(birds, CENTER, index, anchors, 60)).toBe("北海道・鹿児島県");
  });

  it("位置が決まらない陽性は、地図に印がないので入れる。遠い陽性がなければ null", () => {
    expect(birdsFarText([bird({ id: "u", muniCode: null, prefCode: "01" })], CENTER, index, anchors, 60)).toBe("北海道");
    expect(birdsFarText([bird({ id: "a", muniCode: "05210" })], CENTER, index, anchors, 60)).toBeNull();
  });

  it("境目: ちょうどの距離は近い側（より遠いものだけ）", () => {
    const d = haversineKm(CENTER, [140.1, 39.1]);
    const b = [bird({ id: "a", muniCode: "05210" })];
    expect(birdsFarText(b, CENTER, index, anchors, d)).toBeNull();
    expect(birdsFarText(b, CENTER, index, anchors, d - 0.001)).toBe("秋田県");
  });
});
