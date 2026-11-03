import { describe, expect, it } from "vitest";
import { decideReadBudget, estimateUsd, looksLikeProgressTitle } from "../src/budget";
import type { UsageMonth } from "../src/budget";
import { DEFAULT_RUNTIME_SETTINGS } from "../src/types";

const S = DEFAULT_RUNTIME_SETTINGS;
const month = (estimatedJpy: number): UsageMonth => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedJpy,
});

describe("estimateUsd", () => {
  it("Opus 5.5: 入力 5,000、出力 1,500 は 0.05 ドル、150 円で 7.5 円", () => {
    const usd = estimateUsd("claude-opus-5-5", { input_tokens: 5000, output_tokens: 1500 });
    expect(usd).toBeCloseTo(0.05, 10);
    expect(usd * S.jpyPerUsd).toBeCloseTo(7.5, 8);
  });

  it("Batch は半額", () => {
    const u = { input_tokens: 5000, output_tokens: 1500, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 };
    expect(estimateUsd("claude-opus-5-5", u, { batch: true })).toBeCloseTo(estimateUsd("claude-opus-5-5", u) / 2, 12);
  });

  it("Opus 5.5 のキャッシュ: 読みは 0.20、書き込みは入力の 1.25 倍（= 5.00）", () => {
    expect(estimateUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2, 10);
    expect(estimateUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5, 10);
  });

  it("キャッシュの項目が null や無しでも数える", () => {
    const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: null, cache_creation_input_tokens: null };
    expect(estimateUsd("claude-opus-5-5", u)).toBeCloseTo(0.024, 10);
  });

  it("Haiku 5.5: 合計入力 100K 以下は 0.10/0.50", () => {
    expect(estimateUsd("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 10_000 })).toBeCloseTo(0.01 + 0.005, 10);
  });

  it("Haiku 5.5: 合計入力が 100K を超えると 0.50/2.50（キャッシュも合計に入れる）", () => {
    expect(estimateUsd("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 10_000 })).toBeCloseTo(100_001 * 0.5e-6 + 10_000 * 2.5e-6, 10);
    // input 60K + キャッシュ読み 30K + キャッシュ書き 10.001K = 100,001
    const u = { input_tokens: 60_000, output_tokens: 0, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 10_001 };
    const expected = 60_000 * 0.5e-6 + 30_000 * 0.05e-6 + 10_001 * 0.5e-6 * 1.25;
    expect(estimateUsd("claude-haiku-5-5", u)).toBeCloseTo(expected, 10);
  });

  it("Haiku 5.5 のキャッシュ読みは 0.01（100K 以下）", () => {
    expect(estimateUsd("claude-haiku-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000 })).toBeCloseTo(0.001, 10);
    // 合計入力が 100K を超える側は 0.05
    expect(estimateUsd("claude-haiku-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.05, 10);
  });

  it("Sonnet 5.5 は 2/10", () => {
    expect(estimateUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12, 10);
  });

  it("知らないモデルは Opus の値で数える", () => {
    const u = { input_tokens: 5000, output_tokens: 1500 };
    expect(estimateUsd("claude-unknown-9", u)).toBeCloseTo(estimateUsd("claude-opus-5-5", u), 12);
  });
});

describe("looksLikeProgressTitle", () => {
  it.each([
    "防疫措置状況（第15報、…）",
    "防疫措置状況（第２報、…）",
    "防疫措置の進捗について",
    "続報です",
  ])("進捗報: %s", (title) => {
    expect(looksLikeProgressTitle(title)).toBe(true);
  });

  it.each([
    "（特報、殺処分完了）",
    "（特報、発生農場の防疫措置完了）",
    "移動制限区域を解除しました",
    "疑われる事例に係る遺伝子検査の結果",
    "防疫措置状況（第1報）",
  ])("進捗報ではない: %s", (title) => {
    expect(looksLikeProgressTitle(title)).toBe(false);
  });

  it("完了・解除・特報があれば、第N報でも進捗報にしない", () => {
    expect(looksLikeProgressTitle("防疫措置状況（第3報、防疫措置完了）")).toBe(false);
  });
});

describe("decideReadBudget", () => {
  it("1,999 円は read", () => {
    expect(decideReadBudget(month(1999), S, "防疫措置状況（第3報）")).toBe("read");
  });
  it("2,000 円で進捗報だけ skip_progress（2,499 円も同じ）", () => {
    expect(decideReadBudget(month(2000), S, "防疫措置状況（第3報）")).toBe("skip_progress");
    expect(decideReadBudget(month(2499), S, "防疫措置状況（第3報）")).toBe("skip_progress");
  });
  it("2,000 円でも進捗報でなければ read", () => {
    expect(decideReadBudget(month(2000), S, "（特報、疑似患畜の確認）")).toBe("read");
    expect(decideReadBudget(month(2499), S, "（特報、疑似患畜の確認）")).toBe("read");
  });
  it("2,500 円は stop", () => {
    expect(decideReadBudget(month(2500), S, "防疫措置状況（第3報）")).toBe("stop");
    expect(decideReadBudget(month(2500), S, "（特報、疑似患畜の確認）")).toBe("stop");
  });
  it("上限は設定から読む", () => {
    expect(decideReadBudget(month(100), { ...S, softLimitJpy: 100, hardLimitJpy: 200 }, "続報")).toBe("skip_progress");
    expect(decideReadBudget(month(200), { ...S, softLimitJpy: 100, hardLimitJpy: 200 }, "続報")).toBe("stop");
  });
});
