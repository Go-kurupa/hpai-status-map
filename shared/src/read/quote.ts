// 引用の照合（I-04）。引用が本文にあるか、値（数、日付、時刻、半径）がその引用から取り出せるかを見る純粋な関数。
// 本文も引用も normalizeForMatch を通して比べる（部首用の文字、全角、空白、改行を同じに扱う）。
import { normalizeForMatch } from "../text";
import type { ReadDate } from "./types";

const norm = normalizeForMatch;

/** コンマ区切りの数（75,137）を 1 つの数にした、正規化済みの文字列。 */
function prep(s: string): string {
  return norm(s).replace(/(?<=\d),(?=\d)/gu, "");
}

/** 正規化した本文に、引用がそのまま（空白を除いて）含まれる。空の引用は false。 */
export function quoteInNormalized(quote: string, normalizedDoc: string): boolean {
  const nq = norm(quote);
  return nq.length > 0 && normalizedDoc.includes(nq);
}

export function quoteExists(quote: string, docText: string): boolean {
  return quoteInNormalized(quote, norm(docText));
}

/** 値が引用の中にある（文字列の項目）。空の値は false。 */
export function valueInQuote(value: string, quote: string): boolean {
  const nv = norm(value);
  return nv.length > 0 && norm(quote).includes(nv);
}

// ── 数 ──
const UNIT: Readonly<Record<string, number>> = { 億: 1e8, 万: 1e4, 千: 1e3, 百: 100 };
const NUM_TOKEN = /(\d+(?:\.\d+)?)([億万千百])?/gu;

/** 「43万」「4万3千」「0.6万」「9000」を 1 つの数にする。小数の誤差は丸める。 */
function exprValue(expr: string): number {
  let total = 0;
  for (const m of expr.matchAll(NUM_TOKEN)) {
    const n = Number(m[1]);
    total += m[2] ? n * UNIT[m[2]]! : n;
  }
  return Math.round(total);
}

// 数の式は 1 つのまとまりとして読み、途中の数（43万の 43）は候補にしない。羽がすぐ後ろに付くものだけ。
const HEADCOUNT = /(?<![\d.])(\d+(?:\.\d+)?[億万千百]?(?:\d+(?:\.\d+)?[億万千百])*(?:\d+(?:\.\d+)?)?)羽/gu;

/** 羽数の値が、引用の「N羽」「約43万羽」「４万３千羽」などから取り出せる。 */
export function headCountInQuote(value: number, quote: string): boolean {
  for (const m of prep(quote).matchAll(HEADCOUNT)) {
    if (exprValue(m[1]!) === value) return true;
  }
  return false;
}

function exampleNumbers(quote: string): Array<{ n: number; national: boolean }> {
  const s = prep(quote);
  const out: Array<{ n: number; national: boolean }> = [];
  for (const m of s.matchAll(/(\d+)例目/gu)) {
    const before = s.slice(Math.max(0, m.index - 4), m.index);
    out.push({ n: Number(m[1]), national: /国内|全国/u.test(before) });
  }
  return out;
}

/** 「国内8例目」「全国で8例目」から。 */
export function nationalNoInQuote(value: number, quote: string): boolean {
  return exampleNumbers(quote).some((e) => e.national && e.n === value);
}

/** 国内でない N例目（「県内1例目」「本県で2例目」）から。 */
export function prefNoInQuote(value: number, quote: string): boolean {
  return exampleNumbers(quote).some((e) => !e.national && e.n === value);
}

// ── 日付 ──
interface DateCandidate {
  year: number | null;
  month: number;
  day: number;
}

const ERA_OFFSET: Readonly<Record<string, number>> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988, 昭和: 1925, S: 1925 };

function eraYear(era: string | undefined, y: string | undefined): number | null {
  if (y === undefined) return null;
  const n = y === "元" ? 1 : Number(y);
  if (era) return n + ERA_OFFSET[era]!;
  return y.length === 4 ? n : null; // 元号のない 1〜2 桁の年は決められない
}

function dateCandidates(nq: string): DateCandidate[] {
  const out: DateCandidate[] = [];
  for (const m of nq.matchAll(/(?:(令和|平成|昭和|R|H|S)?(\d{1,4}|元)年)?(\d{1,2})月(\d{1,2})日/gu)) {
    out.push({ year: eraYear(m[1], m[2]), month: Number(m[3]), day: Number(m[4]) });
  }
  for (const m of nq.matchAll(/(?<![\d/.\-])(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?![\d/])/gu)) {
    out.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  }
  for (const m of nq.matchAll(/(?<![A-Za-z\d])([RHS])(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?!\d)/gu)) {
    out.push({ year: eraYear(m[1], m[2]), month: Number(m[3]), day: Number(m[4]) });
  }
  for (const m of nq.matchAll(/(?<![\d/.\-])(\d{1,2})\/(\d{1,2})(?![\d/])/gu)) {
    out.push({ year: null, month: Number(m[1]), day: Number(m[2]) });
  }
  return out;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "HH:MM" の時刻が、引用の「午後2時26分」「14時26分」「14:26」「午前9時」などと合う。「12時間」は時刻でない。 */
export function timeInQuote(time: string, quote: string): boolean {
  const nq = prep(quote);
  const found = new Set<string>();
  for (const m of nq.matchAll(/(午前|午後)?(\d{1,2})時(?!間)(?:(\d{1,2})分)?/gu)) {
    let h = Number(m[2]);
    if (m[1] === "午後" && h < 12) h += 12;
    if (m[1] === "午前" && h === 12) h = 0;
    found.add(`${pad2(h)}:${pad2(Number(m[3] ?? 0))}`);
  }
  for (const m of nq.matchAll(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/gu)) found.add(`${pad2(Number(m[1]))}:${m[2]}`);
  if (nq.includes("正午")) found.add("12:00");
  return found.has(time);
}

/**
 * 日付の値が引用に書かれている。月日が合い、値に年があれば引用にも同じ年がある（値の年が null なら月日だけ）。
 * 値に時刻があれば、引用の時刻とも合うこと。
 */
export function dateInQuote(d: ReadDate, quote: string): boolean {
  const hit = dateCandidates(prep(quote)).some(
    (c) => c.month === d.month && c.day === d.day && (d.year === null || c.year === d.year),
  );
  return hit && (d.time === null || timeInQuote(d.time, quote));
}

/**
 * 「本日」「同日」で日を指し、年月日が引用のどこにも書かれていない。
 * その日付は、呼び出し側が文書から取り出した発表日で決める（引用の中では決まらない）。
 */
export function isRelativeDayQuote(quote: string): boolean {
  const nq = prep(quote);
  return /本日|同日/u.test(nq) && dateCandidates(nq).length === 0;
}

/** 「本日」だけの引用で、日付の値が発表日（IsoDate）と同じ。値に年があれば年も、時刻は引用で照合する。 */
export function relativeDateInQuote(d: ReadDate, quote: string, announcedOn: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(announcedOn);
  if (!m || !isRelativeDayQuote(quote)) return false;
  return (
    d.month === Number(m[2]) && d.day === Number(m[3]) && (d.year === null || d.year === Number(m[1])) && (d.time === null || timeInQuote(d.time, quote))
  );
}

// ── 半径 ──
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * 半径 km の値が、引用の「。」で分けた 1 つの文に、「半径」「${km}km か ${km}キロ」「移動制限か搬出制限」とともにある。
 * 「自粛」のある文は数えない（区域の外への自粛の要請の 10km を区域の半径にしない）。農場数、日数は km が付かないので落ちる。
 */
export function radiusInQuote(km: number, quote: string): boolean {
  const km_ = new RegExp(`(?<![\\d.])${escapeRe(String(km))}(?:km|キロ)`, "u");
  const lead = new RegExp(`(?<![\\d.])${escapeRe(String(km))}[~〜\\-]\\d+(?:\\.\\d+)?(?:km|キロ)`, "u"); // 「3~10km」の 3
  return prep(quote)
    .split("。")
    .some((s) => s.includes("半径") && (km_.test(s) || lead.test(s)) && /移動制限|搬出制限/u.test(s) && !s.includes("自粛"));
}
