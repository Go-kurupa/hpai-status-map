// 声かけ文の雛形と検査（M-18、設計書 §7）。説明文（M-19）の検査も同じ部品を使う。純粋関数だけ。
// 検査はすべて normalizeForMatch の後。語は ASCII ではなく日本語なので、正規化した語どうしで探す。
import { formatJaDate } from "./jaDate";
import { normalizeForMatch } from "./text";
import type { Case, IsoDate } from "./types";
import { findForbiddenPhrases } from "./wording";

export type DraftStage = "suspected" | "confirmed";

export interface DraftFacts {
  muniName: string;
  date: IsoDate;
  stage: DraftStage;
}

/** 下書きの元になる、公開の事実だけ（市町村、日付、段階）。農場の名前、位置、記録は持たない。 */
export function workerMessageTemplate(f: DraftFacts): string {
  const d = formatJaDate(f.date);
  return f.stage === "suspected"
    ? `${d}、${f.muniName}で鳥インフルエンザの疑いの発表がありました（確定ではありません）。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`
    : `${d}、${f.muniName}で鳥インフルエンザの発生が確認されました。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`;
}

/** 文に書いてよい日付の数字（年、月、日。頭の 0 は付けない。formatJaDate と同じ書き方）。 */
export function dateNumbers(date: IsoDate): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`日付の形が違います（YYYY-MM-DD）: ${date}`);
  formatJaDate(date); // 存在しない日は RangeError
  return [m[1]!, String(Number(m[2])), String(Number(m[3]))];
}

/**
 * 下書きを作ってよい事例か。作ってよいなら元になる事実を返し、そうでなければ null。
 * 確認中（まだ公開していない）、再現、否定、市町村なし、疑いも確定もない事例は作らない。
 * 確定があれば確定の日、なければ疑いの日。
 */
export function draftFactsOf(c: Case): DraftFacts | null {
  if (c.confirmState === "reviewing" || c.confirmState === "replay") return null;
  if (c.negation === "negated") return null;
  if (c.muniCode === null || c.muniName === null || c.muniName === "") return null;
  const stage: DraftStage | null = c.stages.confirmed ? "confirmed" : c.stages.suspected ? "suspected" : null;
  if (stage === null) return null;
  const stamp = c.stages[stage];
  if (!stamp) return null;
  return { muniName: c.muniName, date: stamp.date, stage };
}

export interface CheckResult {
  ok: boolean;
  failures: string[];
}

/** 煽る語。 */
const SENSATIONAL = ["危険", "危ない", "緊急事態", "非常事態", "パニック", "恐怖", "壊滅", "猛威", "爆発", "まん延", "蔓延", "大流行", "絶対", "ホットスポット", "また発生しやすい"] as const;
/** 人の健康を断定する語。 */
const HEALTH = ["感染しません", "感染しない", "うつりません", "うつらない", "受診", "病院", "発症"] as const;

const KANJI_NUMBER = /[〇一二三四五六七八九十百千万億]+(?:羽|キロ|km|件|例|割|%|人)/giu;
const AVOID_VERB = /行かない|行かず|立ち寄らない|近づかない/u;

/** 数、漢数字の数、煽る語、禁句、人の健康。声かけ文と説明文に共通。normalized は正規化済みの文。 */
function commonFailures(normalized: string, allowedNumbers: readonly string[]): string[] {
  const out: string[] = [];
  const allowed = new Set(allowedNumbers);
  for (const n of new Set(normalized.match(/\d+/gu) ?? [])) if (!allowed.has(n)) out.push(`unknown_number:${n}`);
  for (const k of new Set(normalized.match(KANJI_NUMBER) ?? [])) out.push(`unknown_kanji_number:${k}`);
  for (const w of SENSATIONAL) if (normalized.includes(normalizeForMatch(w))) out.push(`sensational:${w}`);
  for (const p of findForbiddenPhrases(normalized)) out.push(`forbidden:${p}`);
  for (const w of HEALTH) if (normalized.includes(normalizeForMatch(w))) out.push(`health:${w}`);
  return out;
}

/**
 * 声かけ文の検査。市町村名と日付がある、2 つの核（発生地の近くに行かない、消毒と着替え）がある、
 * 事実にない数字がない、煽る語がない、禁句がない、人の健康を断定しない。
 */
export function checkWorkerMessage(text: string, f: { muniName: string; date: IsoDate; allowedNumbers: readonly string[] }): CheckResult {
  const t = normalizeForMatch(text);
  const failures: string[] = [];
  if (!t.includes(normalizeForMatch(f.muniName))) failures.push("missing_muni");
  const [, month, day] = dateNumbers(f.date);
  // 12月19日 の中の 2月19日 を日付と認めない（直前が数字でないこと）
  if (!new RegExp(`(?<!\\d)${month}月${day}日`, "u").test(t)) failures.push("missing_date");
  if (!(t.includes("近く") && AVOID_VERB.test(t))) failures.push("missing_core_avoid");
  if (!(t.includes("消毒") && t.includes("着替え"))) failures.push("missing_core_disinfect");
  failures.push(...commonFailures(t, f.allowedNumbers));
  return { ok: failures.length === 0, failures };
}

/** 近隣への説明文（M-19）の検査。声かけ文の核は求めない。 */
export function checkNeighborText(text: string, allowedNumbers: readonly string[]): CheckResult {
  const failures = commonFailures(normalizeForMatch(text), allowedNumbers);
  return { ok: failures.length === 0, failures };
}
