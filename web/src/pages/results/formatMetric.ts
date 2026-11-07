// 試験の指標の見せ方（X-09）。値は丸めず、分母があれば 24/24 の形にする。
import type { EvalMetricName, EvalSummary } from "@hpai/shared/types";

export type Metric = EvalSummary["metrics"][number];

/** "24/24 件"、"54 文書"。0 は 0 のまま出す */
export function formatMetric(m: Metric): string {
  const v = m.denominator === null ? String(m.value) : `${m.value}/${m.denominator}`;
  return m.unit ? `${v} ${m.unit}` : v;
}

/** 画面に出す並びと日本語の名前。契約 2.2 の EvalMetricName の全部 */
export const METRIC_LABEL: Readonly<Record<EvalMetricName, string>> = {
  documents: "試みた文書",
  read_refusals: "読みの拒否",
  format_errors: "形式の誤り",
  primary_muni_errors: "市町村の読み違い",
  primary_stage_errors: "段階の読み違い",
  primary_date_errors: "日付の読み違い",
  primary_headcount_errors: "羽数の読み違い",
  published_mandatory_errors: "自動で載せた文書の必須項目の誤り",
  published_headcount_errors: "自動で載せた文書の羽数の誤り",
  auto_published_documents: "自動で載せると決めた文書",
  review_documents: "人の確認に回った文書",
  second_reader_mismatches: "2 つの AI の結果の食い違い",
  tamper_rejected: "入れ替えた結果のうち、落ちたもの",
  detection_prev_season: "前季の確認の発表の検知",
  detection_title_classification: "国の題の分類",
};
export const METRIC_ORDER = Object.keys(METRIC_LABEL) as EvalMetricName[];
