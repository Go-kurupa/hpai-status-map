// 対策の相談: consultAsk の中身。
// 画面に出すカードの内容は、カードのデータから出す。Claude の返事（答えの文とカードの id）は検査に通ったものだけを使う。
// 検査に落ちたとき、Claude が使えないとき、予算が止まっているときは、決まった文（OUT_OF_SCOPE_TEXT）に戻す。
// 順序: 入力の検査 → 範囲外の問い → 資料 → 予算 → 回数の確保 → Claude → 使用量を積む → 返事の検査。
// 入力の問いの文はログにも、エラーの文にも出さない。農場の名前、位置、記録は読まない。
// このファイルは db を受け取らない。予算と回数の読み書きは deps の関数（index.ts が usage/ を差し込む）。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isDraftBudgetStopped } from "@hpai/shared/budget";
import type { TokenUsage, UsageMonth } from "@hpai/shared/budget";
import { isOutOfScopeQuestion } from "@hpai/shared/consult/scope";
import { findTopic } from "@hpai/shared/consult/topics";
import type { ConsultCard } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT, validateFollowup } from "@hpai/shared/consult/validate";
import type { RuntimeSettings } from "@hpai/shared/types";
import type { ReadAttempt } from "../read/claude";
import { CONSULT_MAX_CARDS, CONSULT_MODEL, buildAskRequest, callAsk } from "./claude";
import type { ConsultData } from "./data";

/** 会員 1 人が 1 日（日本時間）に頼める回数（話題と文の合計）。 */
export const CONSULT_DAILY_LIMIT = 10;
/** 審査員の入口の、全体の 1 日の回数。 */
export const CONSULT_JUDGE_DAILY_LIMIT = 30;
/** 聞く文の長さの上限（文字の数）。 */
export const CONSULT_MAX_QUESTION = 300;

export type ConsultNotice = null | "daily_limit" | "budget_stop";

export interface ConsultAskResponse {
  answer: string;
  cards: ConsultCard[];
  outOfScope: boolean;
  /** Claude を呼ばなかった理由（予算の停止、1 日の回数）。呼んだときと、範囲外の問いは null */
  notice: ConsultNotice;
}

export interface ConsultCaller {
  uid: string;
  /** custom claim の member */
  member: boolean;
}

export interface ConsultDeps {
  /** Claude の client を作る。鍵はここで読む（呼ぶのは、権限と入力の検査と予算と回数を通った後だけ） */
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
  /** 審査員の入口の、全体の 1 日の分を 1 回確保する。reserve と同じ約束 */
  reserveJudge(now: Date): Promise<boolean>;
  /** 同梱のカード。読めなければ throw */
  data(): Promise<ConsultData>;
}

type Who = { judge: true } | { judge: false; uid: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** judge: true（真偽値の true だけ）ならログインなし。それ以外は会員だけ。 */
function authorize(caller: ConsultCaller | null, data: unknown): Who {
  if (isRecord(data) && data["judge"] === true) return { judge: true };
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.member) throw new HttpsError("permission-denied", "会員だけが使えます");
  return { judge: false, uid: caller.uid };
}

/** question と topicId はどちらか一方だけ。話題は決まった聞く文に置き換える。エラーの文に入力を入れない。 */
function parseAsk(data: unknown): string {
  const question = isRecord(data) ? data["question"] : undefined;
  const topicId = isRecord(data) ? data["topicId"] : undefined;
  if (question !== undefined && topicId !== undefined) throw new HttpsError("invalid-argument", "文か話題のどちらか一方にしてください");
  if (topicId !== undefined) {
    const topic = typeof topicId === "string" ? findTopic(topicId) : undefined;
    if (!topic) throw new HttpsError("invalid-argument", "話題の指定が違います");
    return topic.question;
  }
  if (typeof question !== "string" || question.trim() === "") throw new HttpsError("invalid-argument", "質問を入れてください");
  if (Array.from(question).length > CONSULT_MAX_QUESTION) throw new HttpsError("invalid-argument", `質問は ${CONSULT_MAX_QUESTION} 字までです`);
  return question.trim();
}

async function loadData(deps: ConsultDeps): Promise<ConsultData> {
  try {
    return await deps.data();
  } catch (e) {
    logger.error("対策の相談: 資料を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
    throw new HttpsError("unavailable", "資料を読めませんでした。しばらくしてからもう一度お試しください");
  }
}

type Gate = { ok: true; settings: RuntimeSettings } | { ok: false; notice: Exclude<ConsultNotice, null>; reason: string };

/** 予算を確かめ、1 日の回数を 1 回確保する。通れば settings、通れなければ画面に出す notice と、ログ用の理由の種類。 */
async function gate(deps: ConsultDeps, who: Who, now: Date): Promise<Gate> {
  let settings: RuntimeSettings;
  try {
    settings = await deps.settings();
    // soft の上限で止める。読み取り（発生の文書）の予算を残すため、hard までは使わない
    if (isDraftBudgetStopped(await deps.month(now), settings)) return { ok: false, notice: "budget_stop", reason: "budget_stop" };
  } catch (e) {
    // 予算を読めないときは Claude を呼ばない（上限を越えて使わないため）
    logger.error("対策の相談: 予算を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, notice: "budget_stop", reason: "budget_unavailable" };
  }
  try {
    // 確認と加算は deps の中で原子的に行われる。止まっている日は数えない
    const reserved = who.judge ? await deps.reserveJudge(now) : await deps.reserve(who.uid, now);
    if (!reserved) return { ok: false, notice: "daily_limit", reason: "daily_limit" };
  } catch (e) {
    logger.error("対策の相談: 回数を確かめられませんでした", { error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, notice: "budget_stop", reason: "limit_unavailable" };
  }
  return { ok: true, settings };
}

/** 拒否や途中で切れた呼び出しも課金されるので、usage があれば積む。積めなくても結果は返す。 */
async function recordUsage<T>(deps: ConsultDeps, attempt: ReadAttempt<T>, now: Date, settings: RuntimeSettings): Promise<void> {
  if (attempt.usage === undefined) return;
  try {
    await deps.record(CONSULT_MODEL, attempt.usage, now, settings);
  } catch (e) {
    logger.error("対策の相談: 使用量を積めませんでした", { error: e instanceof Error ? e.name : "unknown" });
  }
}

/** `{question | topicId, judge?}` → おすすめの文と引いたカード。会員だけ（judge: true のときはログインなし）。 */
export async function handleConsultAsk(deps: ConsultDeps, caller: ConsultCaller | null, data: unknown): Promise<ConsultAskResponse> {
  const who = authorize(caller, data);
  const question = parseAsk(data);
  const fixed = (notice: ConsultNotice): ConsultAskResponse => ({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: true, notice });

  // 健康・区域・診断の問いは、Claude を呼ばず、回数も費用も使わずに決まった文を返す
  if (isOutOfScopeQuestion(question)) {
    logger.info("対策の相談(ask)", { outOfScope: true, notice: null, judge: who.judge, failureKinds: ["out_of_scope_question"] });
    return fixed(null);
  }

  const { cards } = await loadData(deps);
  // 答えに引いてよいのは、確認済みのカード全部
  const allowed = cards.cards.filter((c) => c.approved);
  // 引くカードが無いなら、Claude に頼むことがない（回数も使わない）
  if (allowed.length === 0) {
    logger.info("対策の相談(ask)", { outOfScope: true, notice: null, judge: who.judge, failureKinds: ["no_cards"] });
    return fixed(null);
  }

  const now = deps.now();
  const g = await gate(deps, who, now);
  if (!g.ok) {
    logger.info("対策の相談(ask)", { outOfScope: true, notice: g.notice, judge: who.judge, failureKinds: [g.reason] });
    return fixed(g.notice);
  }

  const attempt = await callAsk(deps.client(), buildAskRequest(allowed, question));
  await recordUsage(deps, attempt, now, g.settings);

  // 第 3 引数のカードは数字の検査に使う（渡さないと、数字を含む答えが全部落ちる）。5 枚を超えたら先頭の 5 枚だけ使う
  const result = validateFollowup(attempt.ok ? attempt.value : null, allowed.map((c) => c.id), allowed, CONSULT_MAX_CARDS);
  const byId = new Map(allowed.map((c) => [c.id, c]));
  logger.info("対策の相談(ask)", {
    outOfScope: result.outOfScope,
    notice: null,
    judge: who.judge,
    failureKinds: attempt.ok ? [] : [`claude:${attempt.reason}`],
  });
  return {
    answer: result.answer,
    cards: result.cardIds.map((id) => byId.get(id)).filter((c): c is ConsultCard => c !== undefined),
    outOfScope: result.outOfScope,
    notice: null,
  };
}
