// 費用の数え方（X-09）。単価は shared/src/budget.ts にだけある。ここは camelCase の変換、シーズンの計算、報告の文面を確かめる。
// 測っていないものは「未計測」「未実測」と出し、見積もりは「見積もり（推定）」と分ける（作り話の数字を実測のように出さない）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import type { MeasuredUsage } from "@hpai/shared/replay";
import type { EvalSummary, HistoryCase } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import {
  ASSUMED_DOCS_PER_CASE,
  ASSUMED_DOCUMENT_TOKENS,
  ASSUMED_MODEL,
  buildCostReport,
  estimateSeasonCost,
  MONTHLY_BUDGET_JPY,
  PEAK_SEASON_CASES,
  PREV_SEASON_CASES,
  runCostReport,
  toTokenUsage,
} from "../lib/cost";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const UNMEASURED_USAGE: MeasuredUsage = { status: "unmeasured", documents: 0, byModel: {}, measuredAt: null };
const MEASURED_USAGE: MeasuredUsage = {
  status: "measured",
  documents: 10,
  byModel: {
    "claude-opus-5-5": { inputTokens: 40000, outputTokens: 12000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    "claude-haiku-5-5": { inputTokens: 30000, outputTokens: 3000, cacheReadTokens: 1000, cacheWriteTokens: 2000 },
  },
  measuredAt: "2026-11-06T10:00:00+09:00",
};
const SUMMARY: EvalSummary = {
  measuredAt: "2026-11-05T17:00:00+09:00",
  metrics: [
    { name: "documents", value: 54, denominator: null, unit: "文書", note: "試みた全文書" },
    { name: "detection_prev_season", value: 24, denominator: 24, unit: "件", note: null },
  ],
  unmeasured: ["detection_title_classification"],
  costPerDocumentUsd: 0.0412,
};

describe("toTokenUsage（camelCase の変換だけ）", () => {
  it("入力 5000、出力 1500 を estimateUsd(opus-5-5) に通すと 0.05 ドル", () => {
    const u = toTokenUsage({ inputTokens: 5000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(estimateUsd("claude-opus-5-5", u)).toBeCloseTo(0.05, 10);
  });

  it("キャッシュの 2 項目が移る（読み → cache_read_input_tokens、書き込み → cache_creation_input_tokens）", () => {
    const u = toTokenUsage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 300, cacheWriteTokens: 400 });
    expect(u).toEqual({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 300, cache_creation_input_tokens: 400 });
  });

  it("値を足したり丸めたりしない", () => {
    const u = toTokenUsage({ inputTokens: 123_456, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 9 });
    expect([u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens]).toEqual([123_456, 7, 0, 9]);
  });
});

describe("estimateSeasonCost", () => {
  it("30 事例 × 12 文書 × 0.05 ドル × 150 円 = 2700 円（設計書の「約 2,900 円」は 8 円への丸め）", () => {
    const r = estimateSeasonCost({ usdPerDocument: 0.05, cases: 30, docsPerCase: 12, jpyPerUsd: 150 });
    expect(r.usd).toBeCloseTo(18, 10);
    expect(r.jpy).toBeCloseTo(2700, 6);
    expect(30 * 12 * 8).toBe(2880); // 8 円に丸めた計算。2,900 円はこれを丸めた値
  });

  it("前季 24 事例は 2160 円、過去最多 84 事例は 7560 円", () => {
    expect(estimateSeasonCost({ usdPerDocument: 0.05, cases: PREV_SEASON_CASES, docsPerCase: 12, jpyPerUsd: 150 }).jpy).toBeCloseTo(2160, 6);
    expect(estimateSeasonCost({ usdPerDocument: 0.05, cases: PEAK_SEASON_CASES, docsPerCase: 12, jpyPerUsd: 150 }).jpy).toBeCloseTo(7560, 6);
  });

  it("0 事例は 0。負や数でない入力は投げる（黙って 0 にしない）", () => {
    expect(estimateSeasonCost({ usdPerDocument: 0.05, cases: 0, docsPerCase: 12, jpyPerUsd: 150 })).toEqual({ usd: 0, jpy: 0 });
    expect(() => estimateSeasonCost({ usdPerDocument: -1, cases: 1, docsPerCase: 12, jpyPerUsd: 150 })).toThrow();
    expect(() => estimateSeasonCost({ usdPerDocument: Number.NaN, cases: 1, docsPerCase: 12, jpyPerUsd: 150 })).toThrow();
  });
});

describe("仮定の定数", () => {
  it("1 文書 入力 5000・出力 1500 の Opus 5.5 は 0.05 ドル、1 事例 12 文書、月 3000 円", () => {
    expect(ASSUMED_MODEL).toBe("claude-opus-5-5");
    expect(ASSUMED_DOCUMENT_TOKENS).toEqual({ inputTokens: 5000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(ASSUMED_DOCS_PER_CASE).toBe(12);
    expect(MONTHLY_BUDGET_JPY).toBe(3000);
  });

  it("前季 24 事例と過去最多 84 事例は、過去の事例の一覧（cases.json、関連農場を除く）の件数と一致する", () => {
    const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history", "cases.json"), "utf8")) as HistoryCase[];
    const bySeason = new Map<number, number>();
    for (const c of cases) if (!c.related) bySeason.set(c.season, (bySeason.get(c.season) ?? 0) + 1);
    expect(bySeason.get(2025)).toBe(PREV_SEASON_CASES);
    expect(Math.max(...bySeason.values())).toBe(PEAK_SEASON_CASES);
  });
});

describe("buildCostReport", () => {
  it("何も測っていない: 未計測・未実測と出し、円は『見積もり（推定）』の行にだけ出る", () => {
    const text = buildCostReport({ usage: UNMEASURED_USAGE, summary: null });
    expect(text).toContain("未計測");
    expect(text).toContain("試験はまだ実行していません");
    expect(text).toContain("未実測");
    for (const line of text.split("\n").filter((l) => /円|ドル|\$/.test(l))) {
      expect(line, line).toMatch(/見積もり（推定）/);
    }
    expect(text).not.toMatch(/トークン\s*[:：]\s*\d/); // 測っていないトークン数を書かない
  });

  it("見積もり（推定）の行: 前季 2160 円、過去最多 7560 円、30 事例は 2700 円。実測ではないと書く", () => {
    const text = buildCostReport({ usage: UNMEASURED_USAGE, summary: null });
    expect(text).toContain("2,160 円");
    expect(text).toContain("7,560 円");
    expect(text).toContain("2,700 円");
    expect(text).toContain("実測ではありません");
  });

  it("再現を測った: モデルごとのトークン数（実測）と、1 文書あたりの費用（計算）を出す", () => {
    const text = buildCostReport({ usage: MEASURED_USAGE, summary: null });
    expect(text).toContain("claude-opus-5-5");
    expect(text).toContain("40,000");
    expect(text).toContain("2026-11-06");
    const usd = estimateUsd("claude-opus-5-5", toTokenUsage(MEASURED_USAGE.byModel["claude-opus-5-5"]!)) + estimateUsd("claude-haiku-5-5", toTokenUsage(MEASURED_USAGE.byModel["claude-haiku-5-5"]!));
    expect(text).toContain(`${+(usd / 10).toPrecision(4)}`);
    expect(text).toContain("実測");
    expect(text).not.toContain("再現 1 回分: 未計測");
  });

  it("再現を測った: 1 シーズンの計算にその 1 文書あたりの費用を使う", () => {
    const usd =
      estimateUsd("claude-opus-5-5", toTokenUsage(MEASURED_USAGE.byModel["claude-opus-5-5"]!)) + estimateUsd("claude-haiku-5-5", toTokenUsage(MEASURED_USAGE.byModel["claude-haiku-5-5"]!));
    const jpy = Math.round(estimateSeasonCost({ usdPerDocument: usd / 10, cases: 24, docsPerCase: 12, jpyPerUsd: 150 }).jpy);
    const text = buildCostReport({ usage: MEASURED_USAGE, summary: null });
    expect(text).toContain(`${jpy.toLocaleString("en-US")} 円`);
  });

  it("試験の結果があれば時点と 1 文書あたりの費用を出し、unmeasured は未実測と出す", () => {
    const text = buildCostReport({ usage: UNMEASURED_USAGE, summary: SUMMARY });
    expect(text).toContain("2026-11-05");
    expect(text).toContain("24/24");
    expect(text).toContain("0.0412");
    expect(text).toMatch(/detection_title_classification.*未実測/);
    expect(text).not.toContain("試験はまだ実行していません");
  });

  it("月 3,000 円との比較がある。禁じた語（削減、時間短縮、安全、安心）がない", () => {
    for (const usage of [UNMEASURED_USAGE, MEASURED_USAGE]) {
      const text = buildCostReport({ usage, summary: SUMMARY });
      expect(text).toContain("3,000 円");
      expect(text).not.toMatch(/削減|時間短縮/);
      expect(findForbiddenPhrases(text)).toEqual([]);
    }
  });
});

describe("runCostReport（ファイルから読む入口）", () => {
  const withRoot = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-report-"));
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    return dir;
  };

  it("ファイルが無くても投げず、未計測・試験はまだ実行していない、と出す", () => {
    const dir = withRoot({});
    try {
      const text = runCostReport(dir);
      expect(text).toContain("未計測");
      expect(text).toContain("試験はまだ実行していません");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("壊れた JSON は黙って 0 にせず、読めなかったと出す", () => {
    const dir = withRoot({ "data/replay/measured-usage.json": "{ not json", "evals/results/summary.json": "[]" });
    try {
      const text = runCostReport(dir);
      expect(text).toContain("読めませんでした");
      expect(text).toContain("未計測");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("測った記録があれば集計する", () => {
    const dir = withRoot({
      "data/replay/measured-usage.json": JSON.stringify(MEASURED_USAGE),
      "evals/results/summary.json": JSON.stringify(SUMMARY),
    });
    try {
      const text = runCostReport(dir);
      expect(text).toContain("40,000");
      expect(text).toContain("24/24");
      expect(text).toContain("0.0412");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("このリポジトリの記録で投げない", () => {
    expect(() => runCostReport(ROOT)).not.toThrow();
    expect(runCostReport(ROOT)).toContain("月 3,000 円");
  });
});
