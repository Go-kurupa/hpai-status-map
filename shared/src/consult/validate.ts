// 対策の見直し相談: Claude の返事の検査。
// 画面に出すものはカードのデータから出す。Claude の返事（カードの id、順、短い理由）は、
// 検査に通ったものだけを使う。全部落ちたら、プログラムの順（候補の順、理由なし）を返す。
import { normalizeForMatch } from "../text";
import { OUT_OF_SCOPE_TEXT } from "./scope";
import type { Candidate } from "./select";
import type { ConsultCard } from "./types";

export { OUT_OF_SCOPE_TEXT };

// 理由の字数の上限。
const REASON_MAX_CHARS = 120;
// 続けての質問への答えの字数の上限。
const ANSWER_MAX_CHARS = 400;

export interface PlanRow {
  cardId: string;
  // 短い理由。Claude の返事が使えないときは null。
  reason: string | null;
  // 同じ条件の「研究では効果が測られていない」カード（注意として別に付ける）。
  noDifference: ConsultCard[];
}

export interface PlanResult {
  rows: PlanRow[];
  source: "claude" | "program";
  failures: string[];
}

export interface FollowupResult {
  answer: string;
  cardIds: string[];
  outOfScope: boolean;
}

// 長さと URL の判定。functions の lengthAndUrlFailures と同じ判定を、shared に小さく持つ。
function lengthAndUrlFailures(text: string, maxChars: number): string[] {
  const failures: string[] = [];
  if (Array.from(text).length > maxChars) failures.push("too_long");
  if (/https?:|www\./iu.test(normalizeForMatch(text))) failures.push("url");
  return failures;
}

// 漢数字（〇〜九、十、百、千、万）を整数にする。「二十」は 20、「二〇」は 20。
function kanjiToInt(k: string): number {
  const digit = "〇一二三四五六七八九";
  if (![...k].some((c) => "十百千万".includes(c))) {
    return Number([...k].map((c) => digit.indexOf(c)).join(""));
  }
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let num = 0;
  for (const c of k) {
    const d = digit.indexOf(c);
    if (d >= 0) num = d;
    else if (c === "万") {
      total += (section + num || 1) * 10000;
      section = 0;
      num = 0;
    } else {
      section += (num || 1) * (unit[c] ?? 0);
      num = 0;
    }
  }
  return total + section + num;
}

// 「倍」「割」「%」「羽」「戸」の直前の漢数字は数字として扱う（三倍、二十羽）。十分、一部は対象外。
const KANJI_COUNT = /[〇一二三四五六七八九十百千万]+(?=倍|割|%|羽|戸)/gu;

// 文に書いてある数字。正規化の後で数える（全角の数字も同じ数字）。漢数字の数量も数字にする。
function numbersOf(s: string): string[] {
  const n = normalizeForMatch(s);
  const kanji = (n.match(KANJI_COUNT) ?? []).map((k) => String(kanjiToInt(k)));
  return [...(n.match(/\d+/gu) ?? []), ...kanji];
}

// 引いたカードに書いてよい数字: quote、appliesTo、action にある数字。
function allowedNumbers(cards: ConsultCard[]): Set<string> {
  const set = new Set<string>();
  for (const card of cards) {
    for (const text of [card.quote, card.appliesTo, card.action]) {
      for (const n of numbersOf(text)) set.add(n);
    }
  }
  return set;
}

function unknownNumbers(text: string, allowed: Set<string>): string[] {
  return numbersOf(text).filter((n) => !allowed.has(n));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 行の noDifference: 行のカードと条件の印が 1 つ以上重なる、確認済みの「効果が測られていない」カード。
function noDifferenceFor(card: ConsultCard, allCards: ConsultCard[]): ConsultCard[] {
  const tags = new Set(card.conditionTags);
  return allCards.filter(
    (c) =>
      c.approved &&
      c.evidence === "study-no-difference" &&
      c.id !== card.id &&
      c.conditionTags.some((t) => tags.has(t)),
  );
}

export function validatePlan(raw: unknown, candidates: Candidate[], allCards: ConsultCard[]): PlanResult {
  const byId = new Map<string, Candidate>();
  for (const cand of candidates) byId.set(cand.card.id, cand);

  const failures: string[] = [];
  const rows: PlanRow[] = [];
  const seen = new Set<string>();

  const items = isRecord(raw) && Array.isArray(raw.items) ? (raw.items as unknown[]) : null;
  if (items === null) {
    failures.push("shape");
  } else {
    items.forEach((item, i) => {
      if (!isRecord(item) || typeof item.cardId !== "string" || typeof item.reason !== "string") {
        failures.push(`item[${i}]:shape`);
        return;
      }
      const cand = byId.get(item.cardId);
      if (!cand) {
        failures.push(`item[${i}]:unknown_id`);
        return;
      }
      if (seen.has(item.cardId)) {
        failures.push(`item[${i}]:duplicate`);
        return;
      }
      const reasonFailures = lengthAndUrlFailures(item.reason, REASON_MAX_CHARS);
      if (unknownNumbers(item.reason, allowedNumbers([cand.card])).length > 0) reasonFailures.push("number");
      if (reasonFailures.length > 0) {
        failures.push(...reasonFailures.map((f) => `item[${i}]:${f}`));
        return;
      }
      seen.add(item.cardId);
      // 空の理由は理由なしとして扱う（id と順は検査を通っている）。
      const reason = item.reason.trim() === "" ? null : item.reason;
      rows.push({ cardId: item.cardId, reason, noDifference: noDifferenceFor(cand.card, allCards) });
    });
  }

  if (rows.length > 0) return { rows, source: "claude", failures };

  // 全部落ちた。プログラムの順（候補の順）を理由なしで返す。
  return {
    rows: candidates.map((cand) => ({
      cardId: cand.card.id,
      reason: null,
      noDifference: noDifferenceFor(cand.card, allCards),
    })),
    source: "program",
    failures,
  };
}

const FOLLOWUP_FALLBACK: FollowupResult = { answer: OUT_OF_SCOPE_TEXT, cardIds: [], outOfScope: true };

// cards は数字の検査に使う。渡さないときは数字を確かめられないので、数字を含む答えは通さない。
export function validateFollowup(raw: unknown, allowedIds: string[], cards: ConsultCard[] = []): FollowupResult {
  const fallback = (): FollowupResult => ({ ...FOLLOWUP_FALLBACK, cardIds: [] });
  if (!isRecord(raw) || typeof raw.answer !== "string" || !Array.isArray(raw.cardIds)) return fallback();
  if (raw.outOfScope === true) return fallback();

  const allowed = new Set(allowedIds);
  const cardIds = [
    ...new Set(raw.cardIds.filter((id): id is string => typeof id === "string" && allowed.has(id))),
  ];
  if (cardIds.length === 0) return fallback();

  if (lengthAndUrlFailures(raw.answer, ANSWER_MAX_CHARS).length > 0) return fallback();
  const cited = cards.filter((c) => cardIds.includes(c.id));
  if (unknownNumbers(raw.answer, allowedNumbers(cited)).length > 0) return fallback();
  if (raw.answer.trim() === "") return fallback();

  return { answer: raw.answer, cardIds, outOfScope: false };
}
