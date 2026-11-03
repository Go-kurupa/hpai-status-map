import { describe, expect, it } from "vitest";
import { hasHpaiWord, normalizeForMatch } from "@hpai/shared/text";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { seasonOf } from "@hpai/shared/season";
import { FIXED_TEXT } from "@hpai/shared/wording";

describe("functions から @hpai/shared を読める", () => {
  it("shared の関数と値を import できる", () => {
    expect(normalizeForMatch("⻲岡市")).toBe("亀岡市");
    expect(hasHpaiWord("⿃インフルエンザ")).toBe(true);
    expect(seasonOf("2026-06-01")).toBe(2026);
    expect(FIXED_TEXT.replayBanner).toBe("去年の再現です");
    expect(DEFAULT_RUNTIME_SETTINGS.softLimitJpy).toBe(8000);
  });
});
