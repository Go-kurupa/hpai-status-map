// 費用の実測と計算の報告（X-09）。実測の記録（data/replay/measured-usage.json、evals/results/summary.json）があれば集計し、
// 無ければ「未計測」「未実測」と出す。仮定から出した数字は「見積もり（推定）」と分けて書く（実測のように出さない）。
// 純粋な計算は shared/src/cost.ts にあり、画面（/results）と同じものを使う。単価は shared/src/budget.ts にだけある。
import fs from "node:fs";
import path from "node:path";
import type { MeasuredUsage } from "@hpai/shared/replay";
import { DEFAULT_RUNTIME_SETTINGS, type EvalSummary } from "@hpai/shared/types";
import {
  ASSUMED_DOCS_PER_CASE,
  BUSY_MONTH_CASES,
  costBases,
  estimateSeasonCost,
  formatJpy,
  formatUsd,
  MONTHLY_BUDGET_JPY,
  monthlyCaseCapacity,
  parseEvalSummary,
  parseMeasuredUsage,
  PEAK_SEASON_CASES,
  PREV_SEASON_CASES,
  PRICE_NOTE,
} from "@hpai/shared/cost";

export {
  ASSUMED_DOCS_PER_CASE,
  ASSUMED_DOCUMENT_TOKENS,
  ASSUMED_MODEL,
  ASSUMED_SECOND_MODEL,
  BUSY_MONTH_CASES,
  costBases,
  estimateSeasonCost,
  MONTHLY_BUDGET_JPY,
  PEAK_SEASON_CASES,
  PREV_SEASON_CASES,
  PRICE_NOTE,
  toTokenUsage,
} from "@hpai/shared/cost";

const n = (v: number): string => v.toLocaleString("en-US");
const UNMEASURED = "未計測";

/** "2026-11-06T10:00:00+09:00" → "2026-11-06 10:00"（書いてある時刻をそのまま。取れなければ元の文字） */
function at(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

// 試験の指標の並び（契約 2.2 の EvalMetricName の順）。無い指標は「未実測」と出す
const METRIC_NAMES = [
  "documents",
  "read_refusals",
  "format_errors",
  "primary_muni_errors",
  "primary_stage_errors",
  "primary_date_errors",
  "primary_headcount_errors",
  "published_mandatory_errors",
  "published_headcount_errors",
  "auto_published_documents",
  "review_documents",
  "second_reader_mismatches",
  "tamper_rejected",
  "detection_prev_season",
  "detection_title_classification",
] as const;

export interface ReportInput {
  usage: MeasuredUsage;
  summary: EvalSummary | null;
  /** 読めなかったファイルの名前（壊れている）。「無い」と区別して出す */
  unreadable?: string[];
}

function metricText(m: EvalSummary["metrics"][number]): string {
  const v = m.denominator === null ? String(m.value) : `${m.value}/${m.denominator}`;
  return `${m.unit ? `${v} ${m.unit}` : v}${m.note ? `（${m.note}）` : ""}`;
}

export function buildCostReport({ usage, summary, unreadable = [] }: ReportInput): string {
  const jpyPerUsd = DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);

  push("費用の実測と計算", "実測は API の応答の使用量。金額は shared/src/budget.ts の単価で計算した値で、請求画面の額ではありません。");
  for (const f of unreadable) push(`  ${f} を読めませんでした（壊れているか、形が違います）。測っていないものとして扱います。`);

  push("", "■ 再現 1 回分の使用量（実測）");
  if (usage.status !== "measured") {
    push("  再現 1 回分: 未計測。まだ実物の文書を読んでいません（有料の呼び出しは支払いの上限を置いてから）。");
  } else {
    push(`  時点: ${at(usage.measuredAt ?? UNMEASURED)}`, `  読んだ文書: ${usage.documents} 本`);
    for (const [model, t] of Object.entries(usage.byModel)) {
      push(`  ${model}: 入力 ${n(t.inputTokens)}、出力 ${n(t.outputTokens)}、キャッシュ読み ${n(t.cacheReadTokens)}、キャッシュ書き込み ${n(t.cacheWriteTokens)}`);
    }
    const replay = costBases(usage, null).find((b) => b.id === "replay");
    if (replay) push(`  1 文書あたりの費用（計算）: $${formatUsd(replay.usdPerDocument)}`);
  }

  push("", "■ 読み取りの試験（実測）");
  if (!summary) {
    push("  試験はまだ実行していません。各項目は未実測です。");
  } else {
    push(`  時点: ${at(summary.measuredAt)}`);
    for (const name of METRIC_NAMES) {
      const m = summary.metrics.find((x) => x.name === name);
      push(`  ${name}: ${m && !summary.unmeasured.includes(name) ? metricText(m) : "未実測"}`);
    }
    if (summary.costPerDocumentUsd !== null) push(`  試験 1 文書あたりの費用（計算。別の読み手を含む。実行方式〔通常の API か Batch か〕は記録なし）: $${formatUsd(summary.costPerDocumentUsd)}`);
  }

  push("", "■ 1 シーズンの費用（計算）", `  1 事例 ${ASSUMED_DOCS_PER_CASE} 文書は仮定です（実測していません）。見積もり（推定）の換算: 1 ドル ${jpyPerUsd} 円。${PRICE_NOTE}`);
  const bases = costBases(usage, summary);
  const line = (b: (typeof bases)[number]): string => {
    const season = (cases: number) => formatJpy(estimateSeasonCost({ usdPerDocument: b.usdPerDocument, cases, docsPerCase: ASSUMED_DOCS_PER_CASE, jpyPerUsd }).jpy);
    const cap = monthlyCaseCapacity(b, jpyPerUsd);
    const prefix = b.measured ? `計算（実測の使用量から。円額は 1 事例 ${ASSUMED_DOCS_PER_CASE} 文書の仮定を使う見積もり（推定））` : "見積もり（推定。実測ではありません）";
    const excl = b.id === "assumed" ? "。別の読み手を除く" : "";
    return (
      `  ${prefix} ${b.label}: 1 文書 $${formatUsd(b.usdPerDocument)} → 前季 ${PREV_SEASON_CASES} 事例 ${season(PREV_SEASON_CASES)}／事例が集中した月（${BUSY_MONTH_CASES} 事例と仮定） ${season(BUSY_MONTH_CASES)}／過去最多 ${PEAK_SEASON_CASES} 事例 ${season(PEAK_SEASON_CASES)}` +
      `（月 ${n(MONTHLY_BUDGET_JPY)} 円なら 1 か月に ${cap === null ? "—" : cap} 事例まで${excl}）`
    );
  };
  const measuredBases = bases.filter((b) => b.measured);
  const assumedBases = bases.filter((b) => !b.measured);
  if (measuredBases.length > 0) push("  [実測の使用量から計算]", ...measuredBases.map(line));
  push("  [見積もり（推定）。実測ではありません]", ...assumedBases.map(line));
  push(
    "  見積もり（推定）の行は、仮定の数字から計算したもので、実測ではありません。主の読み手だけの行は別の読み手（Haiku）の費用を含みません。足した行の Haiku の量も仮定で、実際の増分は未計測です。",
    "  見積もり（推定）の補足: 設計書 §15 の「約 2,900 円」は 1 文書を 8 円に丸めた値で、丸めずに計算すると 30 事例の月は 2,700 円です。",
  );
  return out.join("\n");
}

function readJson(file: string): { ok: true; value: unknown } | { ok: false; missing: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, missing: (e as NodeJS.ErrnoException).code === "ENOENT" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, missing: false };
  }
}

/** リポジトリの根から記録を読んで報告を作る。無いファイルは未計測、壊れたファイルは読めなかったと出す（投げない）。 */
export function runCostReport(root: string): string {
  const unreadable: string[] = [];
  const usageFile = "data/replay/measured-usage.json";
  const summaryFile = "evals/results/summary.json";

  let usage: MeasuredUsage = { status: "unmeasured", documents: 0, byModel: {}, measuredAt: null };
  const u = readJson(path.join(root, usageFile));
  if (u.ok) {
    const parsed = parseMeasuredUsage(u.value);
    if (parsed) usage = parsed;
    else unreadable.push(usageFile);
  } else if (!u.missing) unreadable.push(usageFile);

  let summary: EvalSummary | null = null;
  const s = readJson(path.join(root, summaryFile));
  if (s.ok) {
    summary = parseEvalSummary(s.value);
    if (!summary) unreadable.push(summaryFile);
  } else if (!s.missing) unreadable.push(summaryFile);

  return buildCostReport({ usage, summary, unreadable });
}
