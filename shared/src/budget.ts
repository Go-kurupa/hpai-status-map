// 読み取りの費用の数え方と、月の予算での判断（契約 2.2、設計書 §15）。純粋な計算だけ。
import { normalizeForMatch } from "./text";
import type { RuntimeSettings } from "./types";

export interface UsageMonth {
  // usage/{YYYY-MM}
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedJpy: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

// 100 万トークンあたりのドル
interface Rate {
  input: number;
  output: number;
  cacheRead: number;
}

const OPUS_5_5: Rate = { input: 4, output: 20, cacheRead: 0.2 };
const SONNET_5_5: Rate = { input: 2, output: 10, cacheRead: 0.2 };
const HAIKU_5_5: Rate = { input: 0.1, output: 0.5, cacheRead: 0.01 };
const HAIKU_5_5_LONG: Rate = { input: 0.5, output: 2.5, cacheRead: 0.05 };
const HAIKU_LONG_THRESHOLD = 100_000; // 合計入力がこれを超えると高い単価

const CACHE_WRITE_FACTOR = 1.25; // 書き込みは、その単価の入力の 1.25 倍

function rateFor(model: string, totalInput: number): Rate {
  if (model.includes("haiku-5-5")) return totalInput > HAIKU_LONG_THRESHOLD ? HAIKU_5_5_LONG : HAIKU_5_5;
  if (model.includes("sonnet-5-5")) return SONNET_5_5;
  // opus-5-5 と、知らないモデル（安く見積もらない）
  return OPUS_5_5;
}

/** 1 回の呼び出しのドル。Batch は半額。キャッシュの項目は null や無しを 0 とする。 */
export function estimateUsd(model: string, u: TokenUsage, o?: { batch?: boolean }): number {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const rate = rateFor(model, u.input_tokens + cacheRead + cacheWrite);
  const usd =
    (u.input_tokens * rate.input +
      u.output_tokens * rate.output +
      cacheRead * rate.cacheRead +
      cacheWrite * rate.input * CACHE_WRITE_FACTOR) /
    1_000_000;
  return o?.batch ? usd / 2 : usd;
}

const PROGRESS_NEGATIVE = /完了|解除|特報/u;
const PROGRESS_POSITIVE = /第(?:[2-9]|\d{2,})報|進捗|続報/u;

/** 防疫措置の進捗報の題か。予算が厳しいときに読みを飛ばしてよい文書の見分けだけに使う。 */
export function looksLikeProgressTitle(title: string): boolean {
  const t = normalizeForMatch(title);
  if (PROGRESS_NEGATIVE.test(t)) return false;
  return PROGRESS_POSITIVE.test(t);
}

/** 月の費用で読む／進捗報だけ飛ばす／全部止める、を決める。境界は含む（>=）。 */
export function decideReadBudget(month: UsageMonth, s: RuntimeSettings, title: string): "read" | "skip_progress" | "stop" {
  if (month.estimatedJpy >= s.hardLimitJpy) return "stop";
  if (month.estimatedJpy >= s.softLimitJpy && looksLikeProgressTitle(title)) return "skip_progress";
  return "read";
}
