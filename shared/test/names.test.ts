import { describe, expect, it } from "vitest";
import { muniCoreName } from "../src/read/names";

describe("muniCoreName", () => {
  it.each([
    ["苫田郡鏡野町", "鏡野町"],
    ["岡山市北区", "岡山市"],
    ["東京都港区", "港区"],
    ["郡山市", "郡山市"],
    ["大和郡山市", "大和郡山市"],
    ["港区", "港区"],
    ["津山市", "津山市"],
    ["北九州市小倉北区", "北九州市"],
    ["岡山県津山市", "津山市"],
    ["京都府京都市", "京都市"],
    ["　鏡野 町 ", "鏡野町"],
    ["岡山市", "岡山市"],
  ])("%s → %s", (input, expected) => {
    expect(muniCoreName(input)).toBe(expected);
  });
});
