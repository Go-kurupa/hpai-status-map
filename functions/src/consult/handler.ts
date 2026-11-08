// 対策の相談: consultAsk の中身。
// 画面に出すカードの内容は、カードのデータから出す。Claude の返事（答えの文とカードの id）は検査に通ったものだけを使う。
// 返事の検査に落ちたとき、Claude が拒否したとき、予算が止まっているときは、決まった文（OUT_OF_SCOPE_TEXT）に戻す。
// Claude の呼び出しが失敗したとき（鍵を読めない、通信の失敗、途中で切れた、形の違い）は決まった文を出さず、notice: "unavailable"（答えは空）を返す。
// 順序: 入力の検査（question か topicId、前の往復 history の形、農場の条件 farm の形）→ 範囲外の問い → 資料 → 予算 → 回数の確保 → 鍵を読んで client を作る → Claude → 使用量を積む → 返事の検査。
// 前の往復（history）は Claude に問いの意味を読む材料として渡すだけ。問いが範囲外の語に当たる前の往復は渡さず、答えだけが当たるときは答えを空にする（新しい問いが当たれば決まった文）。数字の検査に使うのは、相談者が書いた問い（新しい問いと前の問いを文ごとに。前の答えは入れない）。
// 発生の件数の問いは、Claude が選んだ数え方（stats）でプログラムが過去の事例を数え、表を付ける。件数だけの問いは、対策の答えなしで表だけを返す。
// 近くの町の問い（groupBy "near"）は、条件の町の中心から約 60 km 以内の町の事例の一覧（距離は索引の町の中心どうし）。条件の町がなければ決まった文。
// 農場の条件（farm）は、本人が登録して「登録した農場の情報で相談する」を選んだ飼育目的と飼い方、市町村コード、近くの発生の状況（画面が数えた約 60 km 以内の
// 今季の件数と区域の可能性）、鶏舎ごとの鳥の種類と飼養羽数（2026-11-08 豪さんの決定）。形を厳しく検査し（shared の parseFarmCondition）、
// 町の名前は地理の索引から引いて足す（画面が送った名前は受けない。索引にないコードは invalid-argument）。Claude にカードを選ぶ材料として渡し、
// 返事に使った条件を付ける（画面が答えの近くに出す）。条件がなければ今までどおり（Claude にも返事にも farm の項目を作らない）。
// 入力の問いの文はログにも、エラーの文にも出さない。農場の名前、マス目、記録は読まない（条件も Firestore から読まず、送られてきたものだけ）。
// このファイルは db を受け取らない。予算と回数の読み書きは deps の関数（index.ts が usage/ を差し込む）。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isDraftBudgetStopped } from "@hpai/shared/budget";
import type { TokenUsage, UsageMonth } from "@hpai/shared/budget";
import { isOutOfScopeQuestion } from "@hpai/shared/consult/scope";
import { computeStats, parseStatsQuery, type MuniCenterIndex, type NearOrigin } from "@hpai/shared/consult/stats";
import { jstDateOf } from "@hpai/shared/dates";
import { JUDGE_UID } from "@hpai/shared/judge";
import { findTopic } from "@hpai/shared/consult/topics";
import { farmNumberTexts, parseFarmCondition, townNameOf, type MuniNameIndex } from "@hpai/shared/consult/farmCondition";
import { CONSULT_DAILY_LIMIT, CONSULT_HISTORY_ANSWER_MAX, CONSULT_MAX_HISTORY, CONSULT_MAX_QUESTION } from "@hpai/shared/consult/types";
import type { ConsultAnswerCard, ConsultAskResponse, ConsultCard, ConsultFarmCondition, ConsultFarmUsed, ConsultNotice, ConsultSource, ConsultTurn } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT, validateAsk, validateFollowUps } from "@hpai/shared/consult/validate";
import type { RuntimeSettings } from "@hpai/shared/types";
import type { ReadAttempt } from "../read/claude";
import { CONSULT_MAX_CARDS, CONSULT_MODEL, buildAskRequest, callAsk, type AskOutput } from "./claude";
import type { ConsultData } from "./data";

/** 会員 1 人が 1 日（日本時間）に頼める回数（話題と文の合計）。画面の文と同じ数（shared が正）。 */
export { CONSULT_DAILY_LIMIT };
/** 審査員の会員（JUDGE_UID。審査員は全員この会員）の、全体の 1 日の回数。 */
export const CONSULT_JUDGE_DAILY_LIMIT = 60;
/** 聞く文の長さの上限（文字の数）。shared が正。 */
export { CONSULT_MAX_QUESTION };

export type { ConsultAskResponse, ConsultNotice };

export interface ConsultCaller {
  uid: string;
  /** custom claim の member */
  member: boolean;
}

export interface ConsultDeps {
  /** Claude の client を作る。鍵はここで読む（呼ぶのは、権限と入力の検査と予算と回数を通った後だけ。throw したら unavailable） */
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
  /** 審査員の会員の、全体の 1 日の分を 1 回確保する。reserve と同じ約束 */
  reserveJudge(now: Date): Promise<boolean>;
  /** 同梱のカード。読めなければ throw */
  data(): Promise<ConsultData>;
  /** 同梱の地理の索引（市町村コード → 名前と県と町の中心）。条件に市町村コードがあるときだけ呼ぶ。読めなければ throw */
  muniIndex(): Promise<MuniNameIndex & MuniCenterIndex>;
}

/** judge は審査員の会員（uid が JUDGE_UID）。審査員は全員この 1 つの会員なので、回数は全体で数える */
type Who = { judge: boolean; uid: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 会員だけ。ログインなしの入口（以前の judge: true）はない。送られてきた judge の項目は見ない。 */
function authorize(caller: ConsultCaller | null): Who {
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.member) throw new HttpsError("permission-denied", "会員だけが使えます");
  return { judge: caller.uid === JUDGE_UID, uid: caller.uid };
}

/** question と topicId はどちらか一方だけ。話題は決まった聞く文に置き換える。エラーの文に入力を入れない。 */
function parseAsk(data: unknown): string {
  // null は項目がないのと同じに扱う
  const question = isRecord(data) ? (data["question"] ?? undefined) : undefined;
  const topicId = isRecord(data) ? (data["topicId"] ?? undefined) : undefined;
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

/**
 * 同じ相談の前の往復。項目がない／null は []。形が違えば invalid-argument（エラーの文に入力を入れない）。{question, answer} 以外の項目は捨てる。
 * 問いが範囲外の語（健康・区域・診断）に当たる往復は、Claude に渡さない（偽の前の往復で語の見分けをすり抜けさせない）。
 * 答えだけが当たる往復は、答えを空にして問いだけ渡す（正しい答えにも「陽性」「症状」などは出るので、往復ごと落とすと続きの文脈が消える）。
 */
function parseHistory(data: unknown): ConsultTurn[] {
  const raw = isRecord(data) ? (data["history"] ?? undefined) : undefined;
  if (raw === undefined) return [];
  const bad = () => new HttpsError("invalid-argument", "前の相談の形が違います");
  if (!Array.isArray(raw) || raw.length > CONSULT_MAX_HISTORY) throw bad();
  return raw.map((t: unknown): ConsultTurn => {
    if (!isRecord(t)) throw bad();
    const q = t["question"];
    const a = t["answer"];
    if (typeof q !== "string" || typeof a !== "string") throw bad();
    const qt = q.trim();
    if (qt === "" || Array.from(qt).length > CONSULT_MAX_QUESTION || Array.from(a).length > CONSULT_HISTORY_ANSWER_MAX) throw bad();
    return { question: qt, answer: a };
  })
    .filter((t) => !isOutOfScopeQuestion(t.question))
    .map((t) => (isOutOfScopeQuestion(t.answer) ? { question: t.question, answer: "" } : t));
}

/**
 * 農場の条件。項目がない／null は条件なし（null）。列挙の外の値、型の違い、知らない項目（農場名、マス目、町の名前、羽数の幅など）、
 * 空の条件、飼育目的も飼い方もない条件、範囲の外の件数・羽数・鶏舎の数は invalid-argument（エラーの文に入力を入れない）。
 */
function parseFarm(data: unknown): ConsultFarmCondition | null {
  const r = parseFarmCondition(isRecord(data) ? data["farm"] : undefined);
  if (!r.ok) throw new HttpsError("invalid-argument", "飼い方の条件の形が違います");
  return r.value;
}

/**
 * 市町村コードから町の名前を索引で引いて足す。索引にないコードは invalid-argument。索引が読めないときは unavailable（資料と同じ。回数を使う前）。
 * 市町村コードのない条件はそのまま（origin は null）。origin は近くの町の一覧の起点（索引はここで 1 回だけ読み、一覧にも使う）。
 */
async function withTown(deps: ConsultDeps, farm: ConsultFarmCondition | null): Promise<{ farm: ConsultFarmUsed | null; origin: NearOrigin | null }> {
  if (!farm?.muniCode) return { farm, origin: null };
  let index: MuniNameIndex & MuniCenterIndex;
  try {
    index = await deps.muniIndex();
  } catch (e) {
    logger.error("対策の相談: 地理の索引を読めませんでした", { error: e instanceof Error ? e.name : "unknown" });
    throw new HttpsError("unavailable", "資料を読めませんでした。しばらくしてからもう一度お試しください");
  }
  const town = townNameOf(index, farm.muniCode);
  if (town === null) throw new HttpsError("invalid-argument", "飼い方の条件の形が違います");
  return { farm: { ...farm, town }, origin: { muniCode: farm.muniCode, town, index } };
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

/** ログに残す理由の種類。unknown_number:<数字>、unsupported_quantity:<語> は後ろを落として種類だけにする。 */
function failureKind(f: string): string {
  return f.replace(/^unknown_number:.*$/u, "unknown_number").replace(/^unsupported_quantity:.*$/u, "unsupported_quantity");
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

/** カードに資料の情報を付ける。資料が見つからない（読み込みの検査で起きない）カードは出さない。 */
function answerCardOf(card: ConsultCard | undefined, sources: ReadonlyMap<string, ConsultSource>): ConsultAnswerCard[] {
  const s = card ? sources.get(card.sourceId) : undefined;
  if (!card || !s) return [];
  return [{ ...card, source: { id: s.id, title: s.title, publisher: s.publisher, url: s.url, domestic: s.domestic, license: s.license } }];
}

/** `{question | topicId, history?, farm?}` → おすすめの文と引いたカード。会員だけ（審査員の会員は、回数を全体で数える）。 */
export async function handleConsultAsk(deps: ConsultDeps, caller: ConsultCaller | null, data: unknown): Promise<ConsultAskResponse> {
  const who = authorize(caller);
  const question = parseAsk(data);
  const history = parseHistory(data);
  // 審査員の会員も見本の農場を持つので、条件はほかの会員と同じに扱う。町の名前の引き当ても入力の検査のうち（範囲外の問いより先）
  const { farm, origin } = await withTown(deps, parseFarm(data));
  // 条件を付けた相談で、Claude に渡そうとしたときだけ、返事に使った条件を付ける（付けない相談の返事の形は今までどおり）
  const withFarm = (r: ConsultAskResponse): ConsultAskResponse => (farm ? { ...r, farm } : r);
  const unavailable = (w: Who, kind: string): ConsultAskResponse => {
    logger.info("対策の相談(ask)", { outOfScope: false, notice: "unavailable", judge: w.judge, withFarm: farm !== null, failureKinds: [kind] });
    return withFarm({ answer: "", cards: [], outOfScope: false, notice: "unavailable", followUps: [], stats: null });
  };
  // Claude を呼ぶ前に決まった文で返すとき（範囲外の語、カードなし、予算・回数）は、条件を使っていないので付けない
  const fixed = (notice: ConsultNotice): ConsultAskResponse => ({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: true, notice, followUps: [], stats: null });

  // 健康・区域・診断の問いは、Claude を呼ばず、回数も費用も使わずに決まった文を返す
  if (isOutOfScopeQuestion(question)) {
    logger.info("対策の相談(ask)", { outOfScope: true, notice: null, judge: who.judge, failureKinds: ["out_of_scope_question"] });
    return fixed(null);
  }

  const { cards, history: pastCases } = await loadData(deps);
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

  // 鍵を読む処理も、回数を確保した後の try の中。失敗は Claude の呼び出しの失敗と同じ（unavailable）
  let attempt: ReadAttempt<AskOutput>;
  try {
    attempt = await callAsk(deps.client(), buildAskRequest(allowed, question, history, jstDateOf(now), farm));
  } catch (e) {
    logger.error("対策の相談: Claude の準備に失敗しました", { error: e instanceof Error ? e.name : "unknown" });
    return unavailable(who, "client_unavailable");
  }
  await recordUsage(deps, attempt, now, g.settings);
  // 拒否は決まった文のまま（検査に回す）。それ以外の失敗は、答えを作れなかったこととして伝える
  if (!attempt.ok && attempt.reason !== "refusal") return unavailable(who, `claude:${attempt.reason}`);

  // 第 3 引数のカードと第 5 引数の相談の文は数字の検査に使う（渡さないと、数字を含む答えが全部落ちる）。5 枚を超えたら先頭の 5 枚だけ使う
  // 条件で渡した数（鶏舎の番号は渡した棟数まで、羽数とその合計、近くの発生の件数と約 60 km）だけを加える。答えが条件を言い直しても落とさない
  const farmText = farm ? farmNumberTexts(farm) : [];
  const result = validateAsk(attempt.ok ? attempt.value : null, allowed.map((c) => c.id), allowed, CONSULT_MAX_CARDS, [...history.map((t) => t.question), question, ...farmText]);
  // 発生の件数の問い: Claude は数え方だけを選ぶ。件数と表の文はプログラムが過去の事例から組む。Claude が範囲外とした問いでは数えない
  // 近くの町の一覧は条件の町（origin）から測る。条件がなければ決まった文の stats（一覧なし）
  const statsQuery = attempt.ok && attempt.value.outOfScope !== true ? parseStatsQuery(attempt.value.stats) : null;
  const stats = statsQuery ? computeStats(pastCases, statsQuery, origin) : null;
  const byId = new Map(allowed.map((c) => [c.id, c]));
  const sources = new Map(cards.sources.map((x) => [x.id, x]));
  logger.info("対策の相談(ask)", {
    outOfScope: result.outOfScope,
    notice: null,
    judge: who.judge,
    historyTurns: history.length,
    withFarm: farm !== null,
    stats: statsQuery?.groupBy ?? null,
    // 落ちた理由の符号だけ（数字は落とす。答えの文と相談の文は入れない）
    failureKinds: [...new Set([...(attempt.ok ? [] : [`claude:${attempt.reason}`]), ...result.failures.map(failureKind)])],
  });
  const followUps = attempt.ok ? validateFollowUps(attempt.value.followUps) : [];
  if (result.outOfScope && stats) {
    // 件数の問いだけ（対策の答えがない、または答えが検査に落ちた）: 件数の表だけを返す。検査に落ちた答えの文は出さない
    return withFarm({ answer: "", cards: [], outOfScope: false, notice: null, followUps, stats });
  }
  return withFarm({
    answer: result.answer,
    cards: result.cardIds.flatMap((id) => answerCardOf(byId.get(id), sources)),
    outOfScope: result.outOfScope,
    notice: null,
    followUps: !result.outOfScope && result.cardIds.length > 0 ? followUps : [],
    stats: result.outOfScope ? null : stats,
  });
}
