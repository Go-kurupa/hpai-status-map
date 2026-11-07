import { describe, expect, it } from "vitest";
import {
  computeMortality,
  MORTALITY_TEXT,
  toMortalityDays,
  type MortalityDay,
  type MortalityResult,
} from "../src/mortality";
import { addDays } from "../src/dates";
import type { DeathRecord, ExclusionKind, IsoDate } from "../src/types";
import { findForbiddenPhrases } from "../src/wording";
import { normalizeForMatch } from "../src/text";

const TODAY: IsoDate = "2026-01-31";

function day(offset: number, deaths: number, flockSize = 1000, exclusion: ExclusionKind | null = null): MortalityDay {
  return { date: addDays(TODAY, offset), deaths, flockSize, exclusion };
}

/** 当日 q、その前の 20 日が p（21 日分）。1000 羽。 */
function series(past: number, today: number, flockSize = 1000): MortalityDay[] {
  const days = [day(0, today, flockSize)];
  for (let i = 1; i <= 20; i++) days.push(day(-i, past, flockSize));
  return days;
}

function evaluated(r: MortalityResult) {
  if (r.status !== "evaluated") throw new Error(`evaluated でない: ${JSON.stringify(r)}`);
  return r;
}

describe("computeMortality: 状態", () => {
  it("記録がなければ no_record", () => {
    expect(computeMortality([], TODAY)).toEqual({ status: "no_record" });
  });

  it("当日の記録がなければ、過去があっても no_record", () => {
    const past = series(1, 1).slice(1);
    expect(computeMortality(past, TODAY)).toEqual({ status: "no_record" });
  });

  it("当日より後の日付は無視する", () => {
    const days = [...series(1, 1), day(1, 999)];
    expect(evaluated(computeMortality(days, TODAY)).windowDates[0]).toBe(TODAY);
  });

  it("当日が除外なら today_excluded", () => {
    const days = series(1, 5);
    days[0] = day(0, 5, 1000, "equipment");
    expect(computeMortality(days, TODAY)).toEqual({ status: "today_excluded", kind: "equipment" });
  });

  it("当日の羽数が 0（空舎）なら today_excluded の empty", () => {
    const days = series(1, 0);
    days[0] = day(0, 0, 0);
    expect(computeMortality(days, TODAY)).toEqual({ status: "today_excluded", kind: "empty" });
  });

  it("有効な日が 20 日なら insufficient", () => {
    expect(computeMortality(series(1, 1).slice(0, 20), TODAY)).toEqual({
      status: "insufficient",
      validDays: 20,
      needed: 21,
    });
  });

  it("21 日で evaluated", () => {
    const r = evaluated(computeMortality(series(1, 1), TODAY));
    expect(r.windowDates).toHaveLength(21);
  });

  it("除外の日は insufficient の日数に入らない", () => {
    const days = series(1, 1).slice(0, 20);
    days[3] = day(-3, 1, 1000, "disaster");
    expect(computeMortality(days, TODAY)).toEqual({ status: "insufficient", validDays: 19, needed: 21 });
  });

  it("順序が違っても同じ結果", () => {
    const days = series(1, 5);
    const a = computeMortality(days, TODAY);
    const b = computeMortality([...days].reverse(), TODAY);
    expect(b).toEqual(a);
  });
});

describe("computeMortality: 窓と除外", () => {
  function twentyTwoDays(excludeOffset: number, kind: ExclusionKind, deathsOnExcluded = 500): MortalityDay[] {
    const days: MortalityDay[] = [];
    for (let i = 0; i <= 21; i++) days.push(day(-i, 10));
    days[-excludeOffset] = day(excludeOffset, deathsOnExcluded, 1000, kind);
    return days;
  }

  it("5 日前が equipment の除外: 窓に入らず、最後は 21 日前、平均に入らない", () => {
    const r = evaluated(computeMortality(twentyTwoDays(-5, "equipment"), TODAY));
    expect(r.windowDates).toHaveLength(21);
    expect(r.windowDates).not.toContain(addDays(TODAY, -5));
    expect(r.windowDates[0]).toBe(TODAY);
    expect(r.windowDates[20]).toBe(addDays(TODAY, -21));
    expect(r.averageRate).toBeCloseTo(0.01, 12);
    expect(r.skippedMissingDates).toEqual([]);
  });

  it.each<ExclusionKind>(["disease", "equipment", "temperature", "disaster", "empty", "other"])(
    "除外 %s の日は同じように窓から外れる",
    (kind) => {
      const r = evaluated(computeMortality(twentyTwoDays(-5, kind), TODAY));
      expect(r.windowDates).not.toContain(addDays(TODAY, -5));
      expect(r.windowDates[20]).toBe(addDays(TODAY, -21));
      expect(r.averageRate).toBeCloseTo(0.01, 12);
    },
  );

  it("羽数 0 の日（空舎）も飛ばす", () => {
    const days = twentyTwoDays(-5, "other");
    days[5] = day(-5, 0, 0);
    const r = evaluated(computeMortality(days, TODAY));
    expect(r.windowDates).not.toContain(addDays(TODAY, -5));
    expect(r.windowDates[20]).toBe(addDays(TODAY, -21));
    expect(r.averageRate).toBeCloseTo(0.01, 12);
    expect(r.skippedMissingDates).toEqual([]);
  });

  it("記録のない日は skippedMissingDates に出し、さらに遡る（索引 Q2）", () => {
    const days: MortalityDay[] = [];
    for (let i = 0; i <= 21; i++) if (i !== 5) days.push(day(-i, 10));
    const r = evaluated(computeMortality(days, TODAY));
    expect(r.windowDates).toHaveLength(21);
    expect(r.windowDates[20]).toBe(addDays(TODAY, -21));
    expect(r.skippedMissingDates).toEqual([addDays(TODAY, -5)]);
  });

  it("窓より古い記録の抜けは数えない", () => {
    const r = evaluated(computeMortality([...series(1, 1), day(-40, 1)], TODAY));
    expect(r.skippedMissingDates).toEqual([]);
    expect(r.windowDates[20]).toBe(addDays(TODAY, -20));
  });

  it("窓より古い日の不正な値は見ない", () => {
    const r = computeMortality([...series(1, 1), day(-21, Number.NaN)], TODAY);
    expect(r.status).toBe("evaluated");
  });
});

describe("computeMortality: 判定", () => {
  it("過去 0、当日 1 は当たる", () => {
    const r = evaluated(computeMortality(series(0, 1), TODAY));
    expect(r.hit).toBe(true);
    expect(r.todayRate).toBeCloseTo(0.001, 12);
  });

  it("過去 0、当日 0 は当たらない", () => {
    const r = evaluated(computeMortality(series(0, 0), TODAY));
    expect(r.hit).toBe(false);
    expect(r.averageRate).toBe(0);
  });

  it("過去 1、当日 10 は当たる", () => {
    expect(evaluated(computeMortality(series(1, 10), TODAY)).hit).toBe(true);
  });

  it("過去 10、当日 11 は当たらない", () => {
    expect(evaluated(computeMortality(series(10, 11), TODAY)).hit).toBe(false);
  });

  it("索引 Q1: 当日を平均に含める。過去 19、当日 40 はちょうど 2 倍で当たる", () => {
    const r = evaluated(computeMortality(series(19, 40), TODAY));
    expect(r.averageRate).toBeCloseTo(0.02, 12);
    expect(r.todayRate).toBeCloseTo(0.04, 12);
    expect(r.hit).toBe(true);
  });

  it("索引 Q1: 過去 19、当日 39 は当たらない", () => {
    expect(evaluated(computeMortality(series(19, 39), TODAY)).hit).toBe(false);
  });

  it("索引 Q1: 過去 1、当日 2 は当たらない（当日を含めないなら当たる）", () => {
    const r = evaluated(computeMortality(series(1, 2), TODAY));
    expect(r.hit).toBe(false);
    // 含めない読みなら平均 0.001 の 2 倍で当たる
    expect(r.todayRate).toBeGreaterThanOrEqual(2 * 0.001 - 1e-12);
  });

  it("索引 Q1: 日別の率の平均にする（羽数が途中で変わると、合計÷羽数日の読みとは判定が分かれる）", () => {
    const days: MortalityDay[] = [day(0, 15, 500)];
    for (let i = 1; i <= 10; i++) days.push(day(-i, 10, 1000));
    for (let i = 11; i <= 20; i++) days.push(day(-i, 10, 500));
    const r = evaluated(computeMortality(days, TODAY));
    expect(r.averageRate).toBeCloseTo((10 * 0.01 + 10 * 0.02 + 0.03) / 21, 12);
    expect(r.hit).toBe(false);
    // 合計 ÷ 羽数日の読みなら 0.01387 で、当日 0.03 は 2 倍以上になる
    const pooled = (10 * 10 + 10 * 10 + 15) / (10 * 1000 + 10 * 500 + 500);
    expect(pooled).toBeCloseTo(0.01387, 5);
    expect(0.03 >= 2 * pooled).toBe(true);
  });

  it("索引 Q1: 当日を含めない読みでも同じ分かれ方になる値（500 羽 14 羽）", () => {
    const days: MortalityDay[] = [day(0, 14, 500)];
    for (let i = 1; i <= 10; i++) days.push(day(-i, 10, 1000));
    for (let i = 11; i <= 20; i++) days.push(day(-i, 10, 500));
    // 21 日目が必要なので 500 羽 10 羽をもう 1 日足す（窓は 21 日）
    days.push(day(-21, 10, 500));
    const r = evaluated(computeMortality(days, TODAY));
    expect(r.windowDates).toHaveLength(21);
    expect(r.hit).toBe(false);
  });

  it("当日の率は、当日の死亡数÷当日の羽数で出す", () => {
    const r = evaluated(computeMortality(series(0, 5, 500), TODAY));
    expect(r.todayRate).toBeCloseTo(0.01, 12);
  });
});

describe("computeMortality: 入力の誤り（黙って当たらない扱いにしない）", () => {
  const bad: Array<[string, number]> = [
    ["NaN", Number.NaN],
    ["負の数", -1],
    ["小数", 1.5],
    ["羽数を超える値", 1001],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(bad)("当日の死亡数が %s なら invalid_input", (_name, value) => {
    const days = series(1, 1);
    days[0] = day(0, value);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [TODAY] });
  });

  it.each(bad)("窓の中の死亡数が %s なら invalid_input で、その日を返す", (_name, value) => {
    const days = series(1, 1);
    days[7] = day(-7, value);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -7)] });
  });

  it("複数の日の誤りをすべて返す（新しい順）", () => {
    const days = series(1, 1);
    days[3] = day(-3, Number.NaN);
    days[9] = day(-9, -2);
    expect(computeMortality(days, TODAY)).toEqual({
      status: "invalid_input",
      dates: [addDays(TODAY, -3), addDays(TODAY, -9)],
    });
  });

  it("20 日分しかなくても、誤りがあれば insufficient より先に invalid_input", () => {
    const days = series(1, 1).slice(0, 20);
    days[4] = day(-4, Number.NaN);
    expect(computeMortality(days, TODAY).status).toBe("invalid_input");
  });

  it("羽数が NaN の日は羽数 0 として飛ばさず invalid_input", () => {
    const days = series(1, 1);
    days[6] = day(-6, 1, Number.NaN);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -6)] });
  });

  it("羽数が負の数の日も invalid_input", () => {
    const days = series(1, 1);
    days[6] = day(-6, 0, -10);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -6)] });
  });

  it("当日の羽数が負の数でも invalid_input", () => {
    const days = series(1, 1);
    days[0] = day(0, 1, -5);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [TODAY] });
  });

  it("羽数 0 で死亡数が 1 以上の日は、飛ばさず invalid_input（羽数を超える）", () => {
    const days = series(1, 1);
    days[6] = day(-6, 1, 0);
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -6)] });
  });

  it("除外の日の値は計算に使わないので、誤りでも invalid_input にしない", () => {
    const days = series(1, 1);
    days.push(day(-21, 1, 1000));
    days[6] = day(-6, Number.NaN, 1000, "equipment");
    expect(computeMortality(days, TODAY).status).toBe("evaluated");
  });

  it("当日が知らない除外の種類（\"foo\"）なら、500 羽でも today_excluded にせず invalid_input", () => {
    const days = series(1, 1);
    days[0] = { date: TODAY, deaths: 5, flockSize: 500, exclusion: "foo" as unknown as ExclusionKind };
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [TODAY] });
  });

  it.each<[string, unknown]>([
    ["空文字", ""],
    ["undefined", undefined],
    ["知らない語", "foo"],
    ["文字列のオブジェクト", { kind: "equipment" }],
  ])("窓の中の除外の種類が %s なら、黙って平均から抜かず invalid_input", (_name, value) => {
    const days = series(1, 1);
    days[5] = { date: addDays(TODAY, -5), deaths: 1, flockSize: 1000, exclusion: value as ExclusionKind };
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -5)] });
  });

  it("当日の除外の種類が undefined でも invalid_input", () => {
    const days = series(1, 1);
    days[0] = { date: TODAY, deaths: 1, flockSize: 1000, exclusion: undefined as unknown as ExclusionKind };
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [TODAY] });
  });

  it("除外が文字列のまま保存された記録は、toMortalityDays を通しても invalid_input", () => {
    const records: DeathRecord[] = [];
    for (let i = 20; i >= 0; i--) {
      records.push({ date: addDays(TODAY, -i), houseId: "h1", deaths: 1, flockSizeAt: 1000, exclusion: null });
    }
    const broken = records[10] as DeathRecord;
    records[10] = { ...broken, exclusion: "equipment" as unknown as DeathRecord["exclusion"] };
    expect(computeMortality(toMortalityDays(records), TODAY)).toEqual({
      status: "invalid_input",
      dates: [broken.date],
    });
  });

  it("6 種類の除外はすべて通る（invalid にならない）", () => {
    for (const kind of ["disease", "equipment", "temperature", "disaster", "empty", "other"] as const) {
      const days = series(1, 1);
      days.push(day(-21, 1));
      days[5] = day(-5, 1, 1000, kind);
      expect(computeMortality(days, TODAY).status).toBe("evaluated");
    }
  });

  it("当日のつもりの記録が不正な形だけなら、no_record でなく invalid_input", () => {
    const days = [{ date: "2026/01/31", deaths: 500, flockSize: 1000, exclusion: null }];
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: ["2026/01/31"] });
  });

  it("不正な形の日付は、当日の除外より先に返す", () => {
    const days = [
      { date: TODAY, deaths: 1, flockSize: 1000, exclusion: "equipment" as ExclusionKind },
      { date: "20260130", deaths: 1, flockSize: 1000, exclusion: null },
    ];
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: ["20260130"] });
  });

  it("同じ日が 2 件あれば invalid_input（どちらを使うか決めない）", () => {
    const days = [...series(1, 1), day(-4, 3)];
    expect(computeMortality(days, TODAY)).toEqual({ status: "invalid_input", dates: [addDays(TODAY, -4)] });
  });

  it("日付の形が違う記録は invalid_input", () => {
    const days = [...series(1, 1), { date: "2026/01/05", deaths: 1, flockSize: 1000, exclusion: null }];
    const r = computeMortality(days, TODAY);
    expect(r).toEqual({ status: "invalid_input", dates: ["2026/01/05"] });
  });

  it("誤りがない 21 日で evaluated の結果に NaN が入らない", () => {
    const r = evaluated(computeMortality(series(3, 4), TODAY));
    expect(Number.isFinite(r.todayRate)).toBe(true);
    expect(Number.isFinite(r.averageRate)).toBe(true);
  });
});

describe("toMortalityDays", () => {
  function record(date: IsoDate, deaths: number, flockSizeAt: number, kind: ExclusionKind | null): DeathRecord {
    return { date, houseId: "h1", deaths, flockSizeAt, exclusion: kind ? { kind, note: "メモ" } : null };
  }

  it("flockSizeAt と除外の種類を写し、日付順にする", () => {
    const input = [
      record("2026-01-03", 2, 900, null),
      record("2026-01-01", 1, 1000, "equipment"),
      record("2026-01-02", 0, 950, null),
    ];
    expect(toMortalityDays(input)).toEqual([
      { date: "2026-01-01", deaths: 1, flockSize: 1000, exclusion: "equipment" },
      { date: "2026-01-02", deaths: 0, flockSize: 950, exclusion: null },
      { date: "2026-01-03", deaths: 2, flockSize: 900, exclusion: null },
    ]);
  });

  it("入力を書き換えない。空は空", () => {
    const input = [record("2026-01-02", 0, 950, null), record("2026-01-01", 1, 1000, null)];
    const copy = structuredClone(input);
    toMortalityDays(input);
    expect(input).toEqual(copy);
    expect(toMortalityDays([])).toEqual([]);
  });

  it("computeMortality にそのまま渡せる", () => {
    const records: DeathRecord[] = [];
    for (let i = 20; i >= 0; i--) records.push(record(addDays(TODAY, -i), 1, 1000, null));
    expect(computeMortality(toMortalityDays(records), TODAY).status).toBe("evaluated");
  });
});

describe("MORTALITY_TEXT", () => {
  const entries = Object.entries(MORTALITY_TEXT);

  it("キーは決めた 7 つ", () => {
    expect(Object.keys(MORTALITY_TEXT).sort()).toEqual(
      ["definition", "exceptions", "hit", "invalidInput", "insufficient", "reading", "symptoms"].sort(),
    );
  });

  it.each(entries)("%s は空でなく、禁止語がない", (_key, text) => {
    expect(text.length).toBeGreaterThan(0);
    expect(findForbiddenPhrases(text)).toEqual([]);
  });

  it("symptoms に「特定症状」がない（告示でなく防疫指針の記述のため）", () => {
    expect(normalizeForMatch(MORTALITY_TEXT.symptoms)).not.toContain("特定症状");
  });

  it("決めた文を使う", () => {
    expect(MORTALITY_TEXT.insufficient).toBe("まだ計算できません");
    expect(MORTALITY_TEXT.invalidInput).toBe("入力を確かめてください");
    expect(MORTALITY_TEXT.hit).toBe("設備の故障など明らかな理由がなければ、直ちに家畜保健衛生所へ通報してください（基準 項目 32）");
    expect(MORTALITY_TEXT.definition).toContain("2 倍以上");
    expect(MORTALITY_TEXT.definition).toContain("通算 21 日間");
    expect(MORTALITY_TEXT.reading).toContain("家畜保健衛生所へ確かめてください");
    expect(MORTALITY_TEXT.exceptions).toContain("この画面は例に当たるかを判定しません");
  });
});
