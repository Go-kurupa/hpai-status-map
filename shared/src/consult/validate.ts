// 対策の相談: Claude の返事の検査。
// 画面に出すものはカードのデータから出す。Claude の返事（答えの文とカードの id）は、検査に通ったものだけを使う。
// 落ちたら決まった文（OUT_OF_SCOPE_TEXT）を返す。
import { normalizeForMatch } from "../text";
import { OUT_OF_SCOPE_TEXT } from "./scope";
import type { ConsultCard } from "./types";

export { OUT_OF_SCOPE_TEXT };

// 答えの字数の上限。
const ANSWER_MAX_CHARS = 400;

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

// 書いてよい数字: 引いたカードの quote、appliesTo、action にある数字と、相談の文（extraText）に書かれた数字。
function allowedNumbers(cards: ConsultCard[], extraText: string): Set<string> {
  const set = new Set<string>(numbersOf(extraText));
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

const FOLLOWUP_FALLBACK: FollowupResult = { answer: OUT_OF_SCOPE_TEXT, cardIds: [], outOfScope: true };

// cards は数字の検査に使う。渡さないときは数字を確かめられないので、数字を含む答えは通さない。
// maxCards は使うカードの上限。許された id に絞り、重なりを除いた後の先頭の maxCards 枚だけを使う（数字の検査もその分だけ）。
// extraText は相談の文。相談者が書いた数字（「300 羽の平飼い」の 300）は、答えにそのまま書いてよい。
export function validateFollowup(
  raw: unknown,
  allowedIds: string[],
  cards: ConsultCard[] = [],
  maxCards: number = Infinity,
  extraText: string = "",
): FollowupResult {
  const fallback = (): FollowupResult => ({ ...FOLLOWUP_FALLBACK, cardIds: [] });
  if (!isRecord(raw) || typeof raw.answer !== "string" || !Array.isArray(raw.cardIds)) return fallback();
  if (raw.outOfScope === true) return fallback();

  const allowed = new Set(allowedIds);
  const cardIds = [
    ...new Set(raw.cardIds.filter((id): id is string => typeof id === "string" && allowed.has(id))),
  ].slice(0, maxCards);
  if (cardIds.length === 0) return fallback();

  if (lengthAndUrlFailures(raw.answer, ANSWER_MAX_CHARS).length > 0) return fallback();
  const cited = cards.filter((c) => cardIds.includes(c.id));
  if (unknownNumbers(raw.answer, allowedNumbers(cited, extraText)).length > 0) return fallback();
  if (raw.answer.trim() === "") return fallback();

  return { answer: raw.answer, cardIds, outOfScope: false };
}
