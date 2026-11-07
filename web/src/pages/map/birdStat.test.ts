import { describe, expect, it } from "vitest";
import type { WildBird } from "@hpai/shared/types";
import { birdPrefsText } from "./birdStat";

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

describe("birdPrefsText（野鳥の陽性の県名）", () => {
  it("陽性がなければ null", () => {
    expect(birdPrefsText([])).toBeNull();
    expect(birdPrefsText([bird({ id: "n", test: "negative" })])).toBeNull();
  });

  it("否定を除き、同じ県は 1 回だけ。新しい日付の順、同じ日は県の番号の順", () => {
    const birds = [
      bird({ id: "c", prefCode: "46" }),
      bird({ id: "a", prefCode: "05" }),
      bird({ id: "b", prefCode: "01" }),
      bird({ id: "d", prefCode: "05", date: "2026-11-05", test: "screening_positive" }),
      bird({ id: "e", prefCode: "04", date: "2026-10-27", test: "negative" }),
    ];
    expect(birdPrefsText(birds)).toBe("秋田県・北海道・鹿児島県"); // 秋田は 11/5 の件があるので先
  });

  it("5 県以上は最初の 3 県と県の数にする", () => {
    const codes = ["01", "05", "04", "46", "33"];
    const birds = codes.map((c, i) => bird({ id: c, prefCode: c, date: `2026-11-0${i + 1}` }));
    expect(birdPrefsText(birds)).toBe("岡山県・鹿児島県・宮城県など 5 都道府県");
    expect(birdPrefsText(birds.slice(0, 4))).toBe("鹿児島県・宮城県・秋田県・北海道");
  });
});
