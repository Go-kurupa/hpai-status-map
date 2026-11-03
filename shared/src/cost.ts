// 費用の計算（X-09）。純粋な計算だけ。単価は budget.ts にだけある（ここに書かない）。
// 測ったものは「実測」、仮定から出したものは「見積もり（推定）」と、呼ぶ側が分けて出せるように、根拠の種類を持たせる。
import { estimateUsd, type TokenUsage } from "./budget";
import type { MeasuredUsage, ModelTokens } from "./replay";
import type { EvalSummary } from "./types";

/** 見積もりの仮定（設計書 §15）: 1 文書 入力 5,000・出力 1,500 トークンを Opus 5.5 で読む。実測ではない。 */
export const ASSUMED_MODEL = "claude-opus-5-5";
/** 別の読み手の既定（DEFAULT_RUNTIME_SETTINGS.secondModel）。見積もりの 1 行目には含めず、同じトークン数の仮定で足した行を別に出す */
export const ASSUMED_SECOND_MODEL = "claude-haiku-5-5";
export const ASSUMED_DOCUMENT_TOKENS: Readonly<ModelTokens> = Object.freeze({ inputTokens: 5000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 });
/** 1 事例で読む文書の数。仮定（実測していない） */
export const ASSUMED_DOCS_PER_CASE = 12;
/** 予算の通知の線は月 3,000 円（設計書 §15【決定】）。読み取りを止める線は月 10,000 円（2026-11-04 利用者の決定、DEFAULT_RUNTIME_SETTINGS.hardLimitJpy） */
export const MONTHLY_BUDGET_JPY = 3000;
/** 前季（2025）の事例の数と、過去 6 シーズンで最多の数（cases.json の関連農場を除く件数。試験が照らす） */
export const PREV_SEASON_CASES = 24;
export const PEAK_SEASON_CASES = 84;
/** 設計書 §15 の見積もりの例（事例が集中した月）。仮定 */
export const BUSY_MONTH_CASES = 30;

/** データの camelCase を API の使用量の形（snake_case）に移すだけ。足したり丸めたりしない。 */
export function toTokenUsage(u: ModelTokens): TokenUsage {
  return {
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cache_read_input_tokens: u.cacheReadTokens,
    cache_creation_input_tokens: u.cacheWriteTokens,
  };
}

const nonNegative = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** 1 シーズン（または 1 か月）の費用。丸めない。入力が負や数でなければ投げる（黙って 0 にしない）。 */
export function estimateSeasonCost(p: { usdPerDocument: number; cases: number; docsPerCase: number; jpyPerUsd: number }): { usd: number; jpy: number } {
  for (const [k, v] of Object.entries(p)) if (!nonNegative(v)) throw new Error(`estimateSeasonCost: ${k} は 0 以上の数にしてください（${String(v)}）`);
  const usd = p.usdPerDocument * p.cases * p.docsPerCase;
  return { usd, jpy: usd * p.jpyPerUsd };
}

/** 測った使用量の合計のドル。モデルごとの単価で計算する（請求画面の額ではない）。 */
export function usageUsd(usage: Pick<MeasuredUsage, "byModel">): number {
  let usd = 0;
  for (const [model, tokens] of Object.entries(usage.byModel)) usd += estimateUsd(model, toTokenUsage(tokens));
  return usd;
}

/** 1 文書あたりのドル。測っていない（status が measured でない、文書が 0）ときは null。 */
export function replayUsdPerDocument(usage: MeasuredUsage): number | null {
  if (usage.status !== "measured" || usage.documents <= 0) return null;
  return usageUsd(usage) / usage.documents;
}

export type CostBasisId = "replay" | "eval" | "assumed" | "assumed_with_second";
export interface CostBasis {
  id: CostBasisId;
  /** 実測の使用量から計算した（replay、eval）か、仮定から出した（assumed）か */
  measured: boolean;
  label: string;
  usdPerDocument: number;
}

/**
 * 1 シーズンの計算の根拠。測ったものがあれば先に並べ、仮定の見積もりは最後に置く（実測と取り違えない）。
 * 単価はすべて通常の API のもの（Batch は半額。BATCH_NOTE）。試験の行は、実行方式（通常か Batch か）が summary.json に残らないので方式不明。
 */
export function costBases(usage: MeasuredUsage, summary: EvalSummary | null): CostBasis[] {
  const bases: CostBasis[] = [];
  const replay = replayUsdPerDocument(usage);
  if (replay !== null) bases.push({ id: "replay", measured: true, label: "再現の実測から", usdPerDocument: replay });
  if (summary && summary.costPerDocumentUsd !== null && nonNegative(summary.costPerDocumentUsd))
    bases.push({ id: "eval", measured: true, label: "読み取りの試験から（別の読み手を含む 1 文書。実行方式は記録なし）", usdPerDocument: summary.costPerDocumentUsd });
  const tokens = toTokenUsage(ASSUMED_DOCUMENT_TOKENS);
  const primary = estimateUsd(ASSUMED_MODEL, tokens);
  bases.push({ id: "assumed", measured: false, label: "見積もり（推定）: 主の読み手だけ（別の読み手を含まない）", usdPerDocument: primary });
  bases.push({
    id: "assumed_with_second",
    measured: false,
    label: "見積もり（推定）: 別の読み手（Haiku）にも同じ量を読ませたと仮定して足した",
    usdPerDocument: primary + estimateUsd(ASSUMED_SECOND_MODEL, tokens),
  });
  return bases;
}

/** 見積もりの単価の前提。Batch は半額になるが、見積もりは通常の API の単価で出している */
export const PRICE_NOTE = "単価は通常の API のものです。Batch で読めば、この約半分になりえます。";

/** 月の上限の中で読める事例の数（端数は切り捨て）。1 事例の費用が 0 なら null（割れない） */
export function monthlyCaseCapacity(b: CostBasis, jpyPerUsd: number): number | null {
  const perCase = b.usdPerDocument * ASSUMED_DOCS_PER_CASE * jpyPerUsd;
  if (!(perCase > 0)) return null;
  return Math.floor(MONTHLY_BUDGET_JPY / perCase + 1e-9);
}

/** 0.05 → "0.05"。有効数字 4 桁。見せるための整形で、計算には使わない */
export const formatUsd = (usd: number): string => String(+usd.toPrecision(4));
export const formatJpy = (jpy: number): string => `${Math.round(jpy).toLocaleString("en-US")} 円`;

// ── 読み込みの検査（静的ファイルは作り手が変えうる。形が違えば「無い」と同じに扱い、0 とは読まない） ──
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function parseEvalSummary(x: unknown): EvalSummary | null {
  if (!isObj(x) || typeof x.measuredAt !== "string" || !Array.isArray(x.metrics) || !Array.isArray(x.unmeasured)) return null;
  if (!x.unmeasured.every((n) => typeof n === "string")) return null;
  if (!(x.costPerDocumentUsd === null || isNum(x.costPerDocumentUsd))) return null;
  for (const m of x.metrics) {
    if (!isObj(m) || typeof m.name !== "string" || !isNum(m.value) || typeof m.unit !== "string") return null;
    if (!(m.denominator === null || isNum(m.denominator)) || !(m.note === null || typeof m.note === "string")) return null;
  }
  return x as unknown as EvalSummary;
}

export function parseMeasuredUsage(x: unknown): MeasuredUsage | null {
  if (!isObj(x) || (x.status !== "measured" && x.status !== "unmeasured") || !isNum(x.documents) || !isObj(x.byModel)) return null;
  if (!(x.measuredAt === null || typeof x.measuredAt === "string")) return null;
  for (const t of Object.values(x.byModel)) {
    if (!isObj(t) || !isNum(t.inputTokens) || !isNum(t.outputTokens) || !isNum(t.cacheReadTokens) || !isNum(t.cacheWriteTokens)) return null;
  }
  // 測ったと言いながら中身がない記録は、null（読み込む側は「読めなかった」として扱い、作り話の「0 円」を出さない）
  if (x.status === "measured" && (x.documents <= 0 || Object.keys(x.byModel).length === 0 || x.measuredAt === null)) return null;
  return x as unknown as MeasuredUsage;
}
