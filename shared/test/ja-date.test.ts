import { describe, expect, it } from "vitest";
import { formatJaDate } from "../src/jaDate";

describe("formatJaDate", () => {
  it("月と日の頭の 0 を落として『12月19日』にする", () => {
    expect(formatJaDate("2025-12-19")).toBe("12月19日");
    expect(formatJaDate("2026-01-05")).toBe("1月5日");
    expect(formatJaDate("2026-02-28")).toBe("2月28日");
  });

  it("年を出さない（年をまたぐ表示でも月日だけ）", () => {
    expect(formatJaDate("2027-05-31")).toBe("5月31日");
  });

  it("日付でない文字や存在しない日は RangeError", () => {
    expect(() => formatJaDate("2025/12/19")).toThrow(RangeError);
    expect(() => formatJaDate("2025-13-01")).toThrow(RangeError);
    expect(() => formatJaDate("2025-02-30")).toThrow(RangeError);
    expect(() => formatJaDate("")).toThrow(RangeError);
  });
});
