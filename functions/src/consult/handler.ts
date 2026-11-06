// 対策の見直し相談: consultPlan と consultFollowup の中身。
// 画面に出すカードの内容は、カードのデータから出す。Claude の返事（カードの id、順、短い理由、答え）は検査に通ったものだけを使う。
// 検査に落ちたとき、Claude が使えないとき、予算が止まっているときは、画面が空にならない形に戻す
// （plan はプログラムの順、followup は決まった文）。
// 順序: 入力の検査 → 範囲外の問い（followup）→ 予算 → 回数の確保 → Claude → 使用量を積む → 返事の検査。
// 入力の問いの文はログにも、エラーの文にも出さない。農場の名前、位置、記録は読まない。
// このファイルは db を受け取らない。予算と回数の読み書きは deps の関数（index.ts が usage/ を差し込む）。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isDraftBudgetStopped } from "@hpai/shared/budget";
import type { TokenUsage, UsageMonth } from "@hpai/shared/budget";
import { selectCandidates } from "@hpai/shared/consult/select";
import { isOutOfScopeQuestion } from "@hpai/shared/consult/scope";
import type { ConsultCard, ConsultProfile } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT, validateFollowup, validatePlan } from "@hpai/shared/consult/validate";
import type { RuntimeSettings } from "@hpai/shared/types";
import type { ReadAttempt } from "../read/claude";
import { CONSULT_MODEL, buildFollowupRequest, buildPlanRequest, callFollowup, callPlan } from "./claude";
import type { ConsultData } from "./data";
import { JUDGE_PROFILE } from "./judgeProfile";

/** 会員 1 人が 1 日（日本時間）に頼める回数（plan と followup の合計）。 */
export const CONSULT_DAILY_LIMIT = 10;
/** 審査員の入口の、全体の 1 日の回数。 */
export const CONSULT_JUDGE_DAILY_LIMIT = 30;
/** 続けての質問の長さの上限（文字の数）。 */
export const CONSULT_MAX_QUESTION = 300;

// profile の大きさの上限（問いの数、id の長さ）。実際の問いより十分に大きく、悪用を止める程度。
const PROFILE_MAX_ENTRIES = 50;
const PROFILE_MAX_LENGTH = 100;

export type ConsultNotice = null | "daily_limit" | "budget_stop";

export interface ConsultPlanResponse {
  rows: { card: ConsultCard; reason: string | null; noDifference: ConsultCard[] }[];
  source: "claude" | "program";
  notice: ConsultNotice;
}

export interface ConsultFollowupResponse {
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
  /** 同梱のカードと条件の問い。読めなければ throw */
  data(): Promise<ConsultData>;
  /** 審査員の入口で使う答え。試験で差し替えるため。既定は JUDGE_PROFILE */
  judgeProfile?: ConsultProfile;
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

function parseProfile(data: unknown): ConsultProfile {
  const raw = isRecord(data) ? data["profile"] : undefined;
  if (!isRecord(raw)) throw new HttpsError("invalid-argument", "答えの形が違います");
  const entries = Object.entries(raw);
  if (entries.length > PROFILE_MAX_ENTRIES) throw new HttpsError("invalid-argument", "答えの形が違います");
  for (const [k, v] of entries) {
    if (typeof v !== "string" || k.length > PROFILE_MAX_LENGTH || v.length > PROFILE_MAX_LENGTH) {
      throw new HttpsError("invalid-argument", "答えの形が違います");
    }
  }
  // 自前のプロパティとして写す（"__proto__" という名前の問いでも prototype を書き換えない）
  return Object.fromEntries(entries) as ConsultProfile;
}

function parseFollowup(data: unknown): { question: string; cardId: string } {
  const question = isRecord(data) ? data["question"] : undefined;
  const cardId = isRecord(data) ? data["cardId"] : undefined;
  if (typeof question !== "string" || question.trim() === "") throw new HttpsError("invalid-argument", "質問を入れてください");
  if (Array.from(question).length > CONSULT_MAX_QUESTION) throw new HttpsError("invalid-argument", `質問は ${CONSULT_MAX_QUESTION} 字までです`);
  if (typeof cardId !== "string" || cardId === "" || cardId.length > PROFILE_MAX_LENGTH) throw new HttpsError("invalid-argument", "カードの指定が違います");
  return { question: question.trim(), cardId };
}

async function loadData(deps: ConsultDeps): Promise<ConsultData> {
  try {
    return await deps.data();
  } catch (e) {
    logger.error("対策の見直し相談: 資料を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
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
    logger.error("対策の見直し相談: 予算を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, notice: "budget_stop", reason: "budget_unavailable" };
  }
  try {
    // 確認と加算は deps の中で原子的に行われる。止まっている日は数えない
    const reserved = who.judge ? await deps.reserveJudge(now) : await deps.reserve(who.uid, now);
    if (!reserved) return { ok: false, notice: "daily_limit", reason: "daily_limit" };
  } catch (e) {
    logger.error("対策の見直し相談: 回数を確かめられませんでした", { error: e instanceof Error ? e.name : "unknown" });
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
    logger.error("対策の見直し相談: 使用量を積めませんでした", { error: e instanceof Error ? e.name : "unknown" });
  }
}

/** ログに残す理由の種類。行の番号は落とす（理由は符号だけで、返事の断片を含まない）。 */
function failureKind(f: string): string {
  return f.replace(/^item\[\d+\]:/u, "item:");
}

/** `{profile, judge?}` → 見直す順。会員だけ（judge: true のときは、架空の農場の答えでログインなし）。 */
export async function handleConsultPlan(deps: ConsultDeps, caller: ConsultCaller | null, data: unknown): Promise<ConsultPlanResponse> {
  const who = authorize(caller, data);
  const profile = who.judge ? (deps.judgeProfile ?? JUDGE_PROFILE) : parseProfile(data);
  const { cards, questions } = await loadData(deps);
  const allCards = cards.cards;

  const candidates = selectCandidates(allCards, questions, profile);
  const byId = new Map(candidates.map((c) => [c.card.id, c.card]));
  const toResponse = (raw: unknown, notice: ConsultNotice, failures: string[]): ConsultPlanResponse => {
    const result = validatePlan(raw, candidates, allCards);
    logger.info("対策の見直し相談(plan)", {
      source: result.source,
      notice,
      judge: who.judge,
      failureKinds: [...new Set([...failures, ...result.failures].map(failureKind))],
    });
    return {
      rows: result.rows.map((r) => ({ card: byId.get(r.cardId) as ConsultCard, reason: r.reason, noDifference: r.noDifference })),
      source: result.source,
      notice,
    };
  };

  // 候補が無いなら、Claude に頼むことがない（回数も使わない）
  if (candidates.length === 0) return toResponse(null, null, ["no_candidates"]);

  const now = deps.now();
  const g = await gate(deps, who, now);
  if (!g.ok) return toResponse(null, g.notice, [g.reason]);

  const attempt = await callPlan(deps.client(), buildPlanRequest(allCards, questions, profile, candidates));
  await recordUsage(deps, attempt, now, g.settings);
  return toResponse(attempt.ok ? attempt.value : null, null, attempt.ok ? [] : [`claude:${attempt.reason}`]);
}

/** `{question, cardId, profile, judge?}` → 答えと引いたカード。 */
export async function handleConsultFollowup(deps: ConsultDeps, caller: ConsultCaller | null, data: unknown): Promise<ConsultFollowupResponse> {
  const who = authorize(caller, data);
  const { question, cardId } = parseFollowup(data);
  const fixed = (notice: ConsultNotice): ConsultFollowupResponse => ({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: true, notice });

  // 健康・区域・診断の問いは、Claude を呼ばず、回数も費用も使わずに決まった文を返す
  if (isOutOfScopeQuestion(question)) {
    logger.info("対策の見直し相談(followup)", { outOfScope: true, notice: null, judge: who.judge, failureKinds: ["out_of_scope_question"] });
    return fixed(null);
  }

  const { cards } = await loadData(deps);
  const allCards = cards.cards;
  const card = allCards.find((c) => c.id === cardId && c.approved);
  if (!card) throw new HttpsError("invalid-argument", "カードの指定が違います");

  // 答えに引いてよいのは、その行のカードと、条件の印が 1 つ以上重なる確認済みのカード
  const tags = new Set(card.conditionTags);
  const allowed = allCards.filter((c) => c.id === card.id || (c.approved && c.conditionTags.some((t) => tags.has(t))));

  const now = deps.now();
  const g = await gate(deps, who, now);
  if (!g.ok) {
    logger.info("対策の見直し相談(followup)", { outOfScope: true, notice: g.notice, judge: who.judge, failureKinds: [g.reason] });
    return fixed(g.notice);
  }

  const attempt = await callFollowup(deps.client(), buildFollowupRequest(allowed, question));
  await recordUsage(deps, attempt, now, g.settings);

  // 第 3 引数のカードは数字の検査に使う（渡さないと、数字を含む答えが全部落ちる）
  const result = validateFollowup(attempt.ok ? attempt.value : null, allowed.map((c) => c.id), allCards);
  const byId = new Map(allowed.map((c) => [c.id, c]));
  logger.info("対策の見直し相談(followup)", {
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
