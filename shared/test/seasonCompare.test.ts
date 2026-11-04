import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareSeasons, seasonSpan } from "../src/seasonCompare";
import type { HistoryCase } from "../src/types";

const real = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../data/history/cases.json"), "utf8")) as HistoryCase[];

function mk(season: number, date: string, o: Partial<HistoryCase> = {}): HistoryCase {
  return { season, no: 1, prefCode: "33", muniCode: "33202", muniNameThen: "x", date, birdUse: null, housing: null, headCount: null, sourceUrl: "https://example.test", related: false, ...o };
}

describe("compareSeasons: 実データ", () => {
  const rows = compareSeasons(real, "2026-11-04");
  it("6 シーズンの合計は 52、25、84、11、51、24（古い順、計 247）", () => {
    expect(rows.map((r) => r.season)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(rows.map((r) => r.total)).toEqual([52, 25, 84, 11, 51, 24]);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(247);
  });
  it("月ごとの件数の合計もシーズンの合計と一致する（6〜9 月は 0 件）", () => {
    for (const r of rows) expect(r.months.reduce((s, m) => s + m.count, 0)).toBe(r.total);
    expect(rows[0]!.months.map((m) => m.month)).toEqual([10, 11, 12, 1, 2, 3, 4, 5]);
  });
  it("最初の発生の日は関連農場を除いた最も早い日", () => {
    expect(rows[0]!.firstDate).toBe("2020-11-05");
    for (const r of rows) expect(real.filter((h) => h.season === r.season && !h.related).map((h) => h.date).sort()[0]).toBe(r.firstDate);
  });
});

describe("compareSeasons: 数え方", () => {
  it("関連農場は件数に入れない", () => {
    const r = compareSeasons([mk(2024, "2024-11-01"), mk(2024, "2024-11-02", { related: true })], "2026-11-04");
    expect(r[0]!.total).toBe(1);
    expect(r[0]!.countToDate).toBe(1);
    expect(r[0]!.months.find((m) => m.month === 11)!.count).toBe(1);
  });
  it("今季のシーズンの行は含めない", () => {
    expect(compareSeasons([mk(2026, "2026-10-30"), mk(2025, "2025-12-01")], "2026-11-04").map((r) => r.season)).toEqual([2025]);
  });
  it("同じ月日までは、その日を含めて数える（11 月 4 日）", () => {
    const h = [mk(2024, "2024-11-03"), mk(2024, "2024-11-04"), mk(2024, "2024-11-05"), mk(2024, "2025-01-10")];
    const r = compareSeasons(h, "2026-11-04")[0]!;
    expect(r.countToDate).toBe(2);
    expect(r.total).toBe(4);
  });
  it("年をまたぐ月日（1 月 10 日）は、前の年の秋の発生も含めて数える", () => {
    const h = [mk(2024, "2024-11-03"), mk(2024, "2025-01-10"), mk(2024, "2025-01-11")];
    expect(compareSeasons(h, "2027-01-10")[0]!.countToDate).toBe(2);
  });
  it("シーズンの境: 5 月 31 日はシーズン全体、6 月 1 日は新しいシーズンの初日で 0 件", () => {
    const h = [mk(2024, "2024-11-03"), mk(2024, "2025-05-31")];
    const may = compareSeasons([...h, mk(2025, "2025-12-01")], "2026-05-31");
    expect(may.map((r) => [r.season, r.countToDate, r.total])).toEqual([[2024, 2, 2]]);
    const jun = compareSeasons([...h, mk(2025, "2025-12-01")], "2026-06-01");
    expect(jun.map((r) => [r.season, r.countToDate, r.total])).toEqual([[2024, 0, 2], [2025, 0, 1]]);
  });
  it("うるう日の発生は 2 月 28 日までには入らず、3 月 1 日までには入る", () => {
    const h = [mk(2023, "2024-02-29")];
    expect(compareSeasons(h, "2026-02-28")[0]!.countToDate).toBe(0);
    expect(compareSeasons(h, "2026-03-01")[0]!.countToDate).toBe(1);
  });
  it("件数の多かった県は上位 5 つ、同数は県コードの順", () => {
    const h = [
      ...Array.from({ length: 3 }, () => mk(2024, "2024-11-01", { prefCode: "01" })),
      ...["02", "03", "04", "05", "06", "07"].map((p) => mk(2024, "2024-11-02", { prefCode: p })),
    ];
    const top = compareSeasons(h, "2026-11-04")[0]!.topPrefs;
    expect(top.map((t) => t.prefCode)).toEqual(["01", "02", "03", "04", "05"]);
    expect(top[0]).toEqual({ prefCode: "01", name: "北海道", count: 3 });
  });
  it("seasonSpan", () => {
    expect(seasonSpan(2026)).toBe("2026/27");
    expect(seasonSpan(2099)).toBe("2099/00");
  });
});
