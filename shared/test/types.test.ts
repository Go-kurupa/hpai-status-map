import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_SETTINGS } from "../src/types";

describe("DEFAULT_RUNTIME_SETTINGS", () => {
  it("契約 2.2 の既定値", () => {
    expect(DEFAULT_RUNTIME_SETTINGS).toEqual({
      softLimitJpy: 8000,
      hardLimitJpy: 10000,
      jpyPerUsd: 150,
      autoPublishEnabled: false,
      primaryModel: "claude-opus-5-5",
      primaryEffort: "medium",
      secondModel: "claude-haiku-5-5",
    });
  });

  it("凍結してあり、書き換えで他の呼び出しに伝わらない", () => {
    expect(Object.isFrozen(DEFAULT_RUNTIME_SETTINGS)).toBe(true);
  });
});
