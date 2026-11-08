// これまでの相談（1 つの相談 = 続けて聞いた往復のまとまり）。会員の分は、この端末のブラウザ（localStorage）にだけ残す。
// 作品のサーバーには送らない。審査員の入口は残さない（呼び手が保存しない）。
// 読み書きは失敗しても画面を止めない（非公開のウィンドウ、容量の上限、壊れた中身）。読めない中身は捨てる。
import type { ConsultAskResponse, ConsultTurn } from "@hpai/shared/consult/types";
import { parseStoredFarm } from "@hpai/shared/consult/farmCondition";
import { STATS_GROUP_BYS, seasonRangeText } from "@hpai/shared/consult/stats";
import { DISTANCE_BAND_KM } from "@hpai/shared/level";
import { CONSULT_TOPICS } from "@hpai/shared/consult/topics";
import { CONSULT_MAX_HISTORY, EVIDENCE_LABEL } from "@hpai/shared/consult/types";

export interface ConsultHistoryTurn {
  /** 画面に出した聞く文（話題のときは話題の文） */
  question: string;
  result: ConsultAskResponse;
  /** 聞いた時刻（ミリ秒） */
  at: number;
}

export interface ConsultConversation {
  id: string;
  /** 一覧の題。最初の聞く文 */
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ConsultHistoryTurn[];
  /** 話題のボタンで始めた相談の話題（一覧の札で絞るため）。文で始めた相談と、この項目ができる前の記録にはない */
  topicId?: string;
}

/** 残す相談の数。古いもの（最後に聞いた時刻が古い順）から捨てる */
export const MAX_CONVERSATIONS = 20;
/** 1 つの相談に残す往復の数。古い往復から捨てる */
export const MAX_TURNS = 10;

const KEY_PREFIX = "hpai.consult.history.v1:";

/** 会員ごとの置き場所。同じ端末をほかの会員が使っても混ざらない */
export function historyKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const NOTICES = new Set([null, "daily_limit", "budget_stop", "unavailable"]);

/** 画面が読む項目だけを確かめる（形の違うカードで画面を落とさない） */
function isCard(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { id, action, quote, caveats, evidence, source } = v;
  if (typeof id !== "string" || typeof action !== "string" || typeof quote !== "string" || !isStringArray(caveats)) return false;
  if (typeof evidence !== "string" || !Object.hasOwn(EVIDENCE_LABEL, evidence)) return false;
  if (source === undefined) return true;
  return (
    isRecord(source) &&
    typeof source["title"] === "string" &&
    typeof source["publisher"] === "string" &&
    typeof source["url"] === "string" &&
    typeof source["domestic"] === "boolean" &&
    typeof source["license"] === "string"
  );
}

/** 件数の表。画面が読む項目だけを確かめる */
function isStats(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { query, title, summary, labelHeader, rows, rest, total, outOfRange } = v;
  // 画面は query.prefCode を読む（県の表にだけリスクの文を出す）。query のない古い形・壊れた中身は捨てる
  if (!isRecord(query) || !STATS_GROUP_BYS.includes(query["groupBy"] as never)) return false;
  if (query["prefCode"] !== null && typeof query["prefCode"] !== "string") return false;
  if (query["season"] !== null && typeof query["season"] !== "number") return false;
  if (typeof title !== "string" || typeof summary !== "string" || typeof labelHeader !== "string") return false;
  if (typeof total !== "number" || typeof outOfRange !== "boolean") return false;
  if (!Array.isArray(rows) || !rows.every((r) => isRecord(r) && typeof r["label"] === "string" && typeof r["count"] === "number")) return false;
  if (!(rest === null || (isRecord(rest) && typeof rest["rows"] === "number" && typeof rest["count"] === "number"))) return false;
  // 近くの町の一覧（groupBy "near"）。"near" には一覧が要り、それ以外の数え方には付かない
  const near = v["near"];
  if (query["groupBy"] !== "near") return near === undefined;
  return isNearList(near);
}

const NEAR_ROW_TEXTS = ["date", "place", "use", "headCount", "distance", "sourceUrl"] as const;

/** 近くの町の事例の一覧。画面が読む項目だけを確かめる */
function isNearList(v: unknown): boolean {
  if (!isRecord(v) || typeof v["noFarm"] !== "boolean" || typeof v["more"] !== "number" || !Array.isArray(v["rows"])) return false;
  return v["rows"].every((r: unknown) => isRecord(r) && NEAR_ROW_TEXTS.every((k) => typeof r[k] === "string"));
}

/**
 * 今回使った条件。関数の入力の検査と同じ形に、関数が足した町の名前と、2026-11-08 より前の記録の羽数の幅を許す（parseStoredFarm）。
 * 空・知らない項目・列挙の外は捨てる（古い記録も読めるように、幅つきの形も通す）
 */
function isFarm(v: unknown): boolean {
  return parseStoredFarm(v) !== null;
}

function isResult(v: unknown): v is ConsultAskResponse {
  return (
    isRecord(v) &&
    typeof v["answer"] === "string" &&
    Array.isArray(v["cards"]) &&
    v["cards"].every(isCard) &&
    typeof v["outOfScope"] === "boolean" &&
    NOTICES.has(v["notice"] as string | null) &&
    (v["followUps"] === undefined || isStringArray(v["followUps"])) &&
    (v["stats"] === undefined || v["stats"] === null || isStats(v["stats"])) &&
    // 今回使った条件。この項目ができる前の記録と、条件を付けなかった相談にはない。あれば記録の検査（parseStoredFarm）を通るものだけ
    (v["farm"] === undefined || isFarm(v["farm"]))
  );
}

function isTurn(v: unknown): v is ConsultHistoryTurn {
  return isRecord(v) && typeof v["question"] === "string" && typeof v["at"] === "number" && isResult(v["result"]);
}

function parseConversation(v: unknown): ConsultConversation | null {
  if (!isRecord(v)) return null;
  const { id, title, createdAt, updatedAt, turns } = v;
  if (typeof id !== "string" || typeof title !== "string" || typeof createdAt !== "number" || typeof updatedAt !== "number") return null;
  if (!Array.isArray(turns)) return null;
  const good = turns.filter(isTurn);
  if (good.length === 0) return null;
  const topicId = typeof v["topicId"] === "string" ? v["topicId"] : undefined;
  return { id, title, createdAt, updatedAt, turns: good, ...(topicId ? { topicId } : {}) };
}

/** 新しい順（最後に聞いた時刻）。読めなければ空 */
export function loadConversations(key: string): ConsultConversation[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseConversation)
      .filter((c): c is ConsultConversation => c !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** 上限まで詰めて書く。容量の上限で書けなければ、古い相談を減らしてやり直す。書けなかったら false */
export function saveConversations(key: string, list: readonly ConsultConversation[]): boolean {
  let rest = trimConversations(list);
  for (;;) {
    try {
      if (rest.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(rest));
      return true;
    } catch {
      if (rest.length <= 1) return false;
      rest = rest.slice(0, Math.ceil(rest.length / 2));
    }
  }
}

/** 新しい順に並べ、相談の数と往復の数の上限で切る */
export function trimConversations(list: readonly ConsultConversation[]): ConsultConversation[] {
  return [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => (c.turns.length > MAX_TURNS ? { ...c, turns: c.turns.slice(-MAX_TURNS) } : c));
}

/** 対策の答えがあったか（答えの文とカード） */
export function hasAdvice(r: ConsultAskResponse): boolean {
  return r.cards.length > 0 && r.answer.trim() !== "";
}

/** 答えがあった往復か（対策の答えか、発生の件数の表。決まった文、回数の知らせ、答えを作れなかったときは除く） */
export function isAnswered(t: ConsultHistoryTurn): boolean {
  const r = t.result;
  return r.notice === null && !r.outOfScope && (hasAdvice(r) || Boolean(r.stats));
}

/** 続けて聞くときに関数へ渡す前の往復。答えがあった往復のうち、直前の CONSULT_MAX_HISTORY 往復 */
export function historyForAsk(turns: readonly ConsultHistoryTurn[]): ConsultTurn[] {
  return turns
    .filter(isAnswered)
    .slice(-CONSULT_MAX_HISTORY)
    // 件数だけの往復は、表のまとめの文を答えとして渡す（「では鳥取県は？」の意味を読めるように）
    .map((t) => ({ question: t.question, answer: hasAdvice(t.result) ? t.result.answer : statsAnswerForAsk(t.result.stats) }));
}

/**
 * 件数だけの往復の、前の往復として渡す答え。近くの町の一覧のまとめの文には農場の町の名前が入るので、町の名前を含まない文にする
 * （次の問いで「登録した農場の情報で相談する」を外したとき、選んでいない問いで町の名前を Claude に渡さないため。プライバシーの説明の「選んだときだけ」）
 */
function statsAnswerForAsk(stats: ConsultAskResponse["stats"]): string {
  if (!stats) return "";
  if (!stats.near || stats.near.noFarm) return stats.summary;
  const s = stats.query.season;
  return `農場の町から約 ${DISTANCE_BAND_KM} km 以内の町の発生の一覧を出しました（${s !== null ? `${seasonRangeText(s)}のシーズン` : "過去 6 シーズン"}）。`;
}

export type DayGroup = "today" | "yesterday" | "earlier";

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 最後に聞いた時刻で、今日・昨日・それより前に分ける（端末の時計の日付） */
export function dayGroupOf(updatedAt: number, now: number): DayGroup {
  const today = startOfDay(now);
  if (updatedAt >= today) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (updatedAt >= yesterday.getTime()) return "yesterday";
  return "earlier";
}

/** 今日と昨日は時刻（13:05）、それより前は日付（11/2） */
export function whenLabel(ms: number, now: number): string {
  const d = new Date(ms);
  if (dayGroupOf(ms, now) === "earlier") return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 往復の吹き出しの時刻。今日は時刻（13:05）、それより前は日付も（11/6 18:12） */
export function turnTimeLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return dayGroupOf(ms, now) === "today" ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** 一覧の札の種類。話題の id、発生の件数（"stats"）、話題のボタンを使わずに始めた相談（"free"） */
export const TAG_STATS = "stats";
export const TAG_FREE = "free";

/** 相談の話題。topicId がなければ、題が話題の名前と同じか（topicId ができる前の記録）で見る */
function topicOf(c: ConsultConversation): string | null {
  const t = CONSULT_TOPICS.find((x) => x.id === c.topicId) ?? CONSULT_TOPICS.find((x) => x.label === c.title);
  return t ? t.id : null;
}

/** 相談に付く札（1 つの相談に、話題と発生の件数の両方が付くことがある） */
export function tagsOf(c: ConsultConversation): string[] {
  const tags: string[] = [];
  const topic = topicOf(c);
  tags.push(topic ?? TAG_FREE);
  if (c.turns.some((t) => Boolean(t.result.stats))) tags.push(TAG_STATS);
  return tags;
}

/** 札ごとの相談の数。話題の並び、発生の件数、自由な相談の順。0 件の札は出さない */
export function tagCounts(list: readonly ConsultConversation[]): { tag: string; count: number }[] {
  const count = (tag: string) => list.filter((c) => tagsOf(c).includes(tag)).length;
  return [...CONSULT_TOPICS.map((t) => t.id), TAG_STATS, TAG_FREE].map((tag) => ({ tag, count: count(tag) })).filter((x) => x.count > 0);
}

/** 検索の文（題と、聞いた文に含まれるか。大文字小文字と全角半角は区別しない）と札で絞る */
export function filterConversations(list: readonly ConsultConversation[], query: string, tag: string | null): ConsultConversation[] {
  const norm = (s: string) => s.normalize("NFKC").toLowerCase();
  const q = norm(query.trim());
  return list.filter(
    (c) => (tag === null || tagsOf(c).includes(tag)) && (q === "" || [c.title, ...c.turns.map((t) => t.question)].some((s) => norm(s).includes(q))),
  );
}

let seq = 0;
/** 相談の id。端末の中で重ならなければよい */
export function newConversationId(now: number): string {
  seq += 1;
  return `c${now.toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
