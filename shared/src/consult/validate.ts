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
  /** 決まった文に倒れた理由の符号（通ったときは空）。答えの文は入らない */
  failures: string[];
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

// 答えの文の、事実としては数えない数字を取り除く（箇条書きの番号と、項目の数）。
//  - 行頭（前に空白可）の番号: 「1.」「1．」「1、」「1)」「1）」「（1）」「①」。「1.5」の 1. は番号ではない。
//  - 「N点」「Nつ」「N項目」「N個」のうち、N が limit（1 回に選ぶカードの上限）以下のもの。
// それ以外（「3倍」「2cm」「100m」「6点」）は、そのまま検査する。行頭の判定が要るので、空白や改行を除く正規化の前に行う。
const LEADING_CIRCLED = /^[\s\u3000]*[①-⑩]/u;
const LEADING_NUMBER = /^\s*(?:\d+\s*(?:[.、)](?!\d))|\(\d+\))/u;
const COUNT_WORD = /(\d+)(\s*(?:点|つ|項目|個))/gu;
const DEFAULT_COUNT_LIMIT = 5;

function withoutListNumbers(text: string, maxCards: number): string {
  const limit = Number.isFinite(maxCards) ? maxCards : DEFAULT_COUNT_LIMIT;
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(LEADING_CIRCLED, "").normalize("NFKC").replace(LEADING_NUMBER, ""))
    .join("\n")
    .replace(COUNT_WORD, (m: string, n: string, unit: string) => (Number(n) <= limit ? unit : m));
}

function unknownNumbers(text: string, allowed: Set<string>, maxCards: number): string[] {
  return numbersOf(withoutListNumbers(text, maxCards)).filter((n) => !allowed.has(n));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// カードの id の形（答えの文には書かせない。画面が選んだカードを答えの下に並べる）。
const CARD_ID = String.raw`(?:maff|papers|overseas|okayama|aphis|paper|defra)-[A-Za-z0-9]+(?:/[A-Za-z0-9]+)*`;
const SEP = String.raw`\s*[、，,]\s*`;
const ID_ONLY_BRACKET = new RegExp(String.raw`[（(]\s*${CARD_ID}(?:${SEP}${CARD_ID})*\s*[）)]`, "gu");
const ID_AFTER_SEP = new RegExp(String.raw`${SEP}${CARD_ID}`, "gu");
const ID_BEFORE_SEP = new RegExp(String.raw`${CARD_ID}${SEP}`, "gu");
const BARE_ID = new RegExp(CARD_ID, "gu");

/**
 * 答えの文からカードの id の書き込みを取り除く。検査（長さ・数字）の前に通し、返す answer も取り除いた後のもの。
 *  - id だけの括弧（「（maff-M01）」「（maff-M13a/M13b）」）は括弧ごと消す。
 *  - 括弧の中で他の言葉と並ぶ id（「（基準上の義務、maff-M01）」）は、id と読点だけ消す。
 *  - 括弧の外の id も消す。
 */
export function stripCardRefs(text: string): string {
  return text.replace(ID_ONLY_BRACKET, "").replace(ID_AFTER_SEP, "").replace(ID_BEFORE_SEP, "").replace(BARE_ID, "");
}

// 落ちたときの結果。failures は理由の符号だけ（答えの文、相談者の文は入れない）。
const fallbackOf = (failures: string[]): FollowupResult => ({ answer: OUT_OF_SCOPE_TEXT, cardIds: [], outOfScope: true, failures });

// cards は数字の検査に使う。渡さないときは数字を確かめられないので、数字を含む答えは通さない。
// maxCards は使うカードの上限。許された id に絞り、重なりを除いた後の先頭の maxCards 枚だけを使う（数字の検査もその分だけ）。
// extraText は相談の文。相談者が書いた数字（「300 羽の平飼い」の 300）は、答えにそのまま書いてよい。
// 落ちたときの failures の符号: shape / claude_out_of_scope / no_valid_id / too_long / url / unknown_number:<数字> / empty。通ったときは空。
export function validateFollowup(
  raw: unknown,
  allowedIds: string[],
  cards: ConsultCard[] = [],
  maxCards: number = Infinity,
  extraText: string = "",
): FollowupResult {
  if (!isRecord(raw) || typeof raw.answer !== "string" || !Array.isArray(raw.cardIds)) return fallbackOf(["shape"]);
  if (raw.outOfScope === true) return fallbackOf(["claude_out_of_scope"]);

  const allowed = new Set(allowedIds);
  const cardIds = [
    ...new Set(raw.cardIds.filter((id): id is string => typeof id === "string" && allowed.has(id))),
  ].slice(0, maxCards);
  if (cardIds.length === 0) return fallbackOf(["no_valid_id"]);

  // カードの id の書き込みを取り除いてから検査する（返す answer もこの後のもの）
  const answer = stripCardRefs(raw.answer);
  // 答えの落ちる理由は、見つかった分を全部残す（調べのため）
  const failures = lengthAndUrlFailures(answer, ANSWER_MAX_CHARS);
  const cited = cards.filter((c) => cardIds.includes(c.id));
  for (const n of new Set(unknownNumbers(answer, allowedNumbers(cited, extraText), maxCards))) failures.push(`unknown_number:${n}`);
  if (answer.trim() === "") failures.push("empty");
  if (failures.length > 0) return fallbackOf(failures);

  return { answer, cardIds, outOfScope: false, failures: [] };
}
