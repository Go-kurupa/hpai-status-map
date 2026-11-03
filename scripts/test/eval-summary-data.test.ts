// 読み取りの試験の結果（evals/results/summary.json）と、費用の記録・docs の整合（X-09）。
// 有料の試験を実行するまで summary.json は無い。無いときは「無い」ことを正直に出し、あるときだけ合格の条件を確かめる。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvalSummary, parseMeasuredUsage } from "@hpai/shared/cost";
import type { EvalSummary } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SUMMARY_PATH = path.join(ROOT, "evals", "results", "summary.json");
const HAS_SUMMARY = fs.existsSync(SUMMARY_PATH);
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe.skipIf(!HAS_SUMMARY)("evals/results/summary.json（試験を実行した後にだけ検査する）", () => {
  const raw: unknown = HAS_SUMMARY ? JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8")) : null;
  const summary = parseEvalSummary(raw) as EvalSummary;
  const metric = (name: string) => summary.metrics.find((m) => m.name === name);

  it("EvalSummary の形", () => {
    expect(parseEvalSummary(raw)).not.toBeNull();
  });

  it("detection_prev_season は 24/24", () => {
    expect(metric("detection_prev_season")).toMatchObject({ value: 24, denominator: 24 });
  });

  it("documents は 30 以上", () => {
    expect(metric("documents")!.value).toBeGreaterThanOrEqual(30);
  });

  it.each(["primary_muni_errors", "primary_stage_errors", "primary_date_errors"])("%s は 0", (name) => {
    expect(metric(name)?.value).toBe(0);
  });

  it("測っていないものは unmeasured にあり、metrics に 0 として入っていない", () => {
    for (const name of summary.unmeasured) expect(metric(name), name).toBeUndefined();
  });
});

describe("summary.json が無いとき", () => {
  it("無いことを docs/cost.md と read-eval-log が『まだ実行していない』と書いている（作り話の結果を書いていない）", () => {
    if (HAS_SUMMARY) return;
    expect(read("docs/cost.md")).toContain("試験はまだ実行していません");
    expect(read("docs/read-eval-log.md")).toContain("有料の実行");
  });
});

describe("measured-usage.json と docs/cost.md", () => {
  const usage = parseMeasuredUsage(JSON.parse(read("data/replay/measured-usage.json")));
  const cost = read("docs/cost.md");

  it("measured-usage.json は読める形", () => {
    expect(usage).not.toBeNull();
  });

  it("未計測の間は docs/cost.md も未計測と書き、実測の数字の表を持たない", () => {
    if (usage?.status === "measured") return;
    expect(cost).toContain("未計測");
    expect(cost).not.toMatch(/\|\s*claude-[a-z0-9-]+\s*\|\s*[\d,]+\s*\|/); // モデル別トークンの実測の行
  });

  it("見積もりは『見積もり（推定）』と分け、実測ではないと書いている", () => {
    expect(cost).toContain("見積もり（推定）");
    expect(cost).toContain("実測ではありません");
  });

  it("設計書 §15 の「約 2,900 円」は 8 円への丸めで、計算は 2,700 円と書いている", () => {
    expect(cost).toContain("2,900 円");
    expect(cost).toContain("2,700 円");
    expect(cost).toContain("8 円");
  });

  it("前季 24 事例、過去最多 84 事例、1 事例 12 文書は仮定、月 3,000 円との比較がある", () => {
    expect(cost).toContain("24 事例");
    expect(cost).toContain("84 事例");
    expect(cost).toMatch(/12 文書[^。]*仮定/);
    expect(cost).toContain("3,000 円");
  });

  it("禁じた語がない。削減時間は測っていないと言う場合も『削減』『時間短縮』の語を使わない", () => {
    expect(cost).not.toMatch(/削減|時間短縮/);
    expect(findForbiddenPhrases(cost)).toEqual([]);
  });

  it("秘密や個人の情報の形（鍵、メール、電話）がない", () => {
    expect(cost).not.toMatch(/sk-ant-|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\d{2,4}-\d{2,4}-\d{3,4}/);
  });
});
