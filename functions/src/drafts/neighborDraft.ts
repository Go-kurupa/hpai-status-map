// 近隣への説明文の下書き（M-19、設計書 §11）。会員が平時に、農場の対策を入力して頼む。
// Claude に渡すのは、本人が操作したときの、本人が入力した文（と宛先の種類）だけ。農場の名前、位置、記録、公式の文は渡さない。
// 入力の文は Claude への指示ではなく、下書きの材料として JSON の 1 項目に入れて渡す。
// 公式の部分（人への感染、卵や鶏肉など）は Claude を通さず、OFFICIAL_GUIDANCE の文をそのまま返す。
// 検査に落ちたとき、Claude が使えないとき、予算が止まっているときは雛形に戻す。
// このファイルは db を受け取らない。予算の読み書きは deps の関数（index.ts が usage/ を差し込む）。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isDraftBudgetStopped } from "@hpai/shared/budget";
import type { TokenUsage, UsageMonth } from "@hpai/shared/budget";
import {
  checkNeighborText,
  neighborAllowedNumbers,
  neighborOfficialPart,
  neighborTemplate,
  type NeighborAudience,
  type NeighborDraftResult,
} from "@hpai/shared/drafts";
import type { OfficialGuidance } from "@hpai/shared/guidance/official";
import { normalizeForMatch } from "@hpai/shared/text";
import type { RuntimeSettings } from "@hpai/shared/types";
import type { ReadAttempt } from "../read/claude";
import { DRAFT_MODEL, callDraft } from "./claude";

export const NEIGHBOR_SYSTEM =
  "あなたは養鶏場が近隣の住民へ配る説明文の、農場の対策の部分だけを下書きします。入力された対策だけを使います。入力にない数字と事実を足しません。人の健康、感染、卵や肉について書きません。不安をあおる語を使いません。";

/** 会員 1 人が 1 日（日本時間）に説明文を頼める回数。 */
export const NEIGHBOR_DAILY_LIMIT = 10;
/** 入力の文の長さの上限（文字の数）。 */
export const NEIGHBOR_MAX_INPUT = 2000;
/** Claude の返事の長さの上限（文字の数）。超えたら雛形に戻す。 */
export const NEIGHBOR_MAX_OUTPUT = 3000;

const AUDIENCES: ReadonlySet<unknown> = new Set<NeighborAudience>(["meeting", "circular"]);

/** user の中身。宛先の種類と、本人が入力した文だけの JSON。入力の文は引用符ごと文字列に入るので、指示としては読まれない材料になる。 */
export function buildNeighborUser(measures: string, audience: NeighborAudience): string {
  return JSON.stringify({ audience, measures });
}

/** Claude を呼ばなかった理由。月の予算の停止、予算を読めない、1 日の回数の上限、回数を確かめられない。 */
export type SkipReason = "budget_stop" | "budget_unavailable" | "daily_limit" | "limit_unavailable";

export interface NeighborDecision {
  farmPart: string;
  source: NeighborDraftResult["source"];
  failures: string[];
}

/**
 * Claude の返事を採るか、雛形に戻すか。attempt が null は「Claude を呼ばなかった」で、skipReason がその理由。
 * 雛形に戻すときは、入力の文そのものに検査に落ちる語があれば input:〜 で知らせる（雛形はその文を入れるので）。
 */
export function decideNeighborDraft(
  measures: string,
  audience: NeighborAudience,
  attempt: ReadAttempt<{ message: string }> | null,
  skipReason: SkipReason = "budget_stop",
): NeighborDecision {
  const allowed = neighborAllowedNumbers(measures);
  const template = (failures: string[]): NeighborDecision => ({
    farmPart: neighborTemplate(measures, audience),
    source: "template",
    failures: [...failures, ...checkNeighborText(measures, allowed).failures.map((f) => `input:${f}`)],
  });
  if (attempt === null) return template([skipReason]);
  if (!attempt.ok) return template([`claude:${attempt.reason}`]);

  const farmPart = attempt.value.message.trim();
  const failures: string[] = [];
  if (farmPart === "") failures.push("empty");
  if (Array.from(farmPart).length > NEIGHBOR_MAX_OUTPUT) failures.push("too_long");
  if (/https?:|www\./iu.test(normalizeForMatch(farmPart))) failures.push("url");
  failures.push(...checkNeighborText(farmPart, allowed, { input: measures }).failures);
  if (failures.length > 0) return template(failures);
  return { farmPart, source: "claude", failures: [] };
}

export interface NeighborCaller {
  uid: string;
  /** custom claim の member */
  member: boolean;
}

export interface NeighborDraftDeps {
  /** Claude の client を作る。鍵はここで読む（呼ぶのは、権限と入力の検査と予算を通った後だけ） */
  client(): Anthropic;
  now(): Date;
  settings(): Promise<RuntimeSettings>;
  month(now: Date): Promise<UsageMonth>;
  /** 使用量を今月の費用に積む（usage/ への書き込み） */
  record(model: string, usage: TokenUsage, now: Date, settings: RuntimeSettings): Promise<unknown>;
  /**
   * その会員の 1 日の分を 1 回確保する。確保できたら true、1 日の上限なら false。
   * 確認と加算は 1 つの取引（原子的）で行う実装を差し込む。確保した分は Claude が失敗しても戻さない。
   */
  reserve(uid: string, now: Date): Promise<boolean>;
  /** 試験で公式の文を差し替えるため。既定は OFFICIAL_GUIDANCE */
  guidance?: readonly OfficialGuidance[];
}

function parseInput(data: unknown): { measures: string; audience: NeighborAudience } {
  const o = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const measures = o?.["measures"];
  const audience = o?.["audience"];
  if (typeof measures !== "string" || measures.trim() === "") throw new HttpsError("invalid-argument", "農場の対策の文を入れてください");
  if (Array.from(measures).length > NEIGHBOR_MAX_INPUT) throw new HttpsError("invalid-argument", `対策の文は ${NEIGHBOR_MAX_INPUT} 字までです`);
  if (!AUDIENCES.has(audience)) throw new HttpsError("invalid-argument", "配り方の指定が違います");
  return { measures: measures.trim(), audience: audience as NeighborAudience };
}

/** ログに残す理由の種類。符号の「:」より後ろは入力や返事の断片を含みうるので落とす（input:〜 は種類まで）。 */
function failureKind(f: string): string {
  const parts = f.split(":");
  return f.startsWith("input:") ? parts.slice(0, 2).join(":") : (parts[0] ?? "");
}

/**
 * `{measures, audience}` → NeighborDraftResult。会員だけ。
 * 入力の文はログにも、エラーの文にも出さない。
 */
export async function handleNeighborDraft(deps: NeighborDraftDeps, caller: NeighborCaller | null, data: unknown): Promise<NeighborDraftResult> {
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.member) throw new HttpsError("permission-denied", "会員だけが使えます");
  const { measures, audience } = parseInput(data);

  const now = deps.now();
  let settings: RuntimeSettings | null = null;
  let stopped: boolean;
  let skipReason: SkipReason = "budget_stop";
  try {
    settings = await deps.settings();
    // soft の上限で止める。読み取り（発生の文書）の予算を残すため、hard までは使わない
    stopped = isDraftBudgetStopped(await deps.month(now), settings);
  } catch (e) {
    // 予算を読めないときは Claude を呼ばない（上限を越えて使わないため）。雛形は返す
    stopped = true;
    skipReason = "budget_unavailable";
    logger.error("近隣への説明文: 予算を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
  }
  if (!stopped) {
    // 1 日の回数。確認と加算は deps.reserve の中で原子的に行われる。止まっている日は数えない
    try {
      if (!(await deps.reserve(caller.uid, now))) {
        stopped = true;
        skipReason = "daily_limit";
      }
    } catch (e) {
      stopped = true;
      skipReason = "limit_unavailable";
      logger.error("近隣への説明文: 回数を確かめられませんでした", { error: e instanceof Error ? e.name : "unknown" });
    }
  }

  let attempt: ReadAttempt<{ message: string }> | null = null;
  if (!stopped && settings !== null) {
    attempt = await callDraft(deps.client(), NEIGHBOR_SYSTEM, buildNeighborUser(measures, audience));
    // 拒否や途中で切れた呼び出しも課金されるので、usage があれば積む
    if (attempt.usage !== undefined) {
      try {
        await deps.record(DRAFT_MODEL, attempt.usage, now, settings);
      } catch (e) {
        logger.error("近隣への説明文: 使用量を積めませんでした", { error: e instanceof Error ? e.name : "unknown" });
      }
    }
  }

  const decision = decideNeighborDraft(measures, audience, attempt, skipReason);
  logger.info("近隣への説明文を作りました", {
    source: decision.source,
    audience,
    failureKinds: [...new Set(decision.failures.map(failureKind))],
  });
  return { farmPart: decision.farmPart, officialPart: neighborOfficialPart(deps.guidance), source: decision.source, failures: decision.failures };
}
