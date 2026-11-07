// 対策項目の「けさの確認」が出す、次の自己点検の期限（farms.selfCheckDue から今日以降でいちばん近い日）
import { describe, expect, it } from "vitest";
import { hasSelfCheckDue, latestSelfCheckDue, nextSelfCheckDue } from "../src/notices";

describe("nextSelfCheckDue", () => {
  it("今日以降でいちばん近い期限と、あと何日か", () => {
    expect(nextSelfCheckDue({ "2026-01": "2026-01-31", "2026-02": "2026-02-27", "2025-12": "2025-12-28" }, "2026-01-05")).toEqual({
      month: "2026-01",
      date: "2026-01-31",
      daysLeft: 26,
    });
  });

  it("今日が期限なら、あと 0 日（今日）", () => {
    expect(nextSelfCheckDue({ "2026-01": "2026-01-05" }, "2026-01-05")).toEqual({ month: "2026-01", date: "2026-01-05", daysLeft: 0 });
  });

  it("過ぎた期限だけなら null", () => {
    expect(nextSelfCheckDue({ "2025-12": "2025-12-28" }, "2026-01-05")).toBeNull();
  });

  it("登録がない・欄が壊れているときは null（例外にしない）", () => {
    expect(nextSelfCheckDue({}, "2026-01-05")).toBeNull();
    expect(nextSelfCheckDue(undefined, "2026-01-05")).toBeNull();
    expect(nextSelfCheckDue(null, "2026-01-05")).toBeNull();
    expect(nextSelfCheckDue(["2026-01-31"], "2026-01-05")).toBeNull();
  });

  it("日付でない値・実在しない日は読み飛ばす", () => {
    expect(nextSelfCheckDue({ "2026-01": "1 月末", "2026-02": "2026-02-30", "2026-03": 5, "2026-04": "2026-04-30" }, "2026-01-05")).toEqual({
      month: "2026-04",
      date: "2026-04-30",
      daysLeft: 115,
    });
  });

  it("同じ日の期限が 2 つあれば、月の早い方", () => {
    expect(nextSelfCheckDue({ "2026-02": "2026-01-31", "2026-01": "2026-01-31" }, "2026-01-05")?.month).toBe("2026-01");
  });
});

describe("hasSelfCheckDue（登録が 1 件でもあるか。過ぎた期限も数える）", () => {
  it("正しい日付が 1 件でもあれば true（過ぎた期限だけでも true）", () => {
    expect(hasSelfCheckDue({ "2025-12": "2025-12-28" })).toBe(true);
    expect(hasSelfCheckDue({ "2026-01": "2026-01-31" })).toBe(true);
  });

  it("登録がない・欄が壊れている・日付でない値と実在しない日だけなら false（nextSelfCheckDue の読み飛ばしとそろえる）", () => {
    expect(hasSelfCheckDue({})).toBe(false);
    expect(hasSelfCheckDue(undefined)).toBe(false);
    expect(hasSelfCheckDue(null)).toBe(false);
    expect(hasSelfCheckDue(["2026-01-31"])).toBe(false);
    expect(hasSelfCheckDue({ "2026-01": "1 月末", "2026-02": "2026-02-30", "2026-03": 5 })).toBe(false);
  });
});

describe("latestSelfCheckDue（登録した期限のうちいちばん遅い日。過ぎた期限も数える）", () => {
  it("いちばん遅い日を返し、壊れた値は数えない", () => {
    expect(latestSelfCheckDue({ "2025-11": "2025-11-28", "2025-12": "2025-12-28" })).toBe("2025-12-28");
    expect(latestSelfCheckDue({ "2026-01": "2026-01-31", "2026-02": "壊れた値", "2026-03": 5 })).toBe("2026-01-31");
  });
  it("登録がない・形が違うときは null", () => {
    expect(latestSelfCheckDue({})).toBeNull();
    expect(latestSelfCheckDue(undefined)).toBeNull();
    expect(latestSelfCheckDue(["2026-01-31"])).toBeNull();
  });
});
