import { describe, expect, it } from "vitest";
import { addDays, diffDays, jstDateOf, toJstIso } from "../src/dates";
import { currentSeason, seasonAgoLabel, seasonOf } from "../src/season";

describe("seasonOf / currentSeason / seasonAgoLabel", () => {
  it("6 月 1 日にシーズンが替わる", () => {
    expect(seasonOf("2026-05-31")).toBe(2025);
    expect(seasonOf("2026-06-01")).toBe(2026);
    expect(seasonOf("2025-12-20")).toBe(2025);
    expect(seasonOf("2026-01-01")).toBe(2025);
    expect(seasonOf("2026-12-31")).toBe(2026);
  });

  it("日付でない文字列は投げる", () => {
    expect(() => seasonOf("2026/05/31")).toThrow(RangeError);
    expect(() => seasonOf("2026-13-01")).toThrow(RangeError);
    expect(() => seasonOf("2026-02-30")).toThrow(RangeError);
  });

  it("今のシーズンは日本時間で数える", () => {
    expect(currentSeason(new Date("2026-05-31T15:00:00Z"))).toBe(2026); // JST で 6/1
    expect(currentSeason(new Date("2026-05-31T14:59:59Z"))).toBe(2025); // JST で 5/31
    expect(currentSeason(new Date("2026-11-03T00:00:00Z"))).toBe(2026);
  });

  it("今季、1 年前、n 年前", () => {
    expect([2026, 2025, 2024].map((s) => seasonAgoLabel(s, 2026))).toEqual(["今季", "1 年前", "2 年前"]);
    expect(seasonAgoLabel(2020, 2026)).toBe("6 年前");
  });

  it("未来のシーズンは投げる", () => {
    expect(() => seasonAgoLabel(2027, 2026)).toThrow(RangeError);
  });
});

describe("toJstIso / jstDateOf", () => {
  it("日本時間（+09:00）の ISO 8601 にする", () => {
    expect(toJstIso(new Date("2025-12-20T00:00:00Z"))).toBe("2025-12-20T09:00:00+09:00");
    expect(toJstIso(new Date("2025-12-31T15:30:45Z"))).toBe("2026-01-01T00:30:45+09:00");
  });

  it("ミリ秒を落とす", () => {
    expect(toJstIso(new Date("2025-12-20T00:00:00.789Z"))).toBe("2025-12-20T09:00:00+09:00");
  });

  it("不正な日時は投げる", () => {
    expect(() => toJstIso(new Date("x"))).toThrow(RangeError);
  });

  it("日本時間の日付", () => {
    expect(jstDateOf(new Date("2026-05-31T15:00:00Z"))).toBe("2026-06-01");
    expect(jstDateOf(new Date("2026-05-31T14:59:59Z"))).toBe("2026-05-31");
  });
});

describe("addDays / diffDays", () => {
  it("日数を足す", () => {
    expect(addDays("2025-12-30", 22)).toBe("2026-01-21");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("日数の差", () => {
    expect(diffDays("2026-01-21", "2025-12-30")).toBe(22);
    expect(diffDays("2025-12-30", "2026-01-21")).toBe(-22);
    expect(diffDays("2026-03-01", "2026-03-01")).toBe(0);
    expect(diffDays("2024-03-01", "2024-02-28")).toBe(2);
  });

  it("addDays と diffDays は逆の操作", () => {
    expect(diffDays(addDays("2025-11-05", 90), "2025-11-05")).toBe(90);
  });

  it("小数の日数は投げる", () => {
    expect(() => addDays("2025-12-30", 1.5)).toThrow(RangeError);
  });
});
