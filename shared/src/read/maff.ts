// 農林水産省の報道発表の題と定型文を、Claude を使わずに読む（I-01、設計書 §9.2）。
// 純粋な関数だけ。本文は normalizeForMatch の後の文字列で見る（空白と改行が消え、全角の数字が半角になる）。
import { addDays } from "../dates";
import { PREFS, prefCodeOfName } from "../pref";
import { normalizeForMatch } from "../text";
import type { IsoDate, PrefCode } from "../types";

export type MaffItemType = "confirmed" | "movement_lifted";

const HPAI_TITLE = "高病原性鳥インフルエンザ";

/**
 * 国の報道発表の題の分類。
 * 疑似患畜の確認 → confirmed／発生に係る移動制限の解除 → movement_lifted／それ以外（遺伝子解析と NA 亜型の確定、野鳥、
 * 学校の臨時休業、輸入停止、輸出再開）→ null。両方の語がある題は読み違えを避けて null。
 */
export function isMaffOutbreakTitle(title: string): MaffItemType | null {
  const t = normalizeForMatch(title);
  if (!t.includes(HPAI_TITLE)) return null;
  if (t.includes("遺伝子解析") || t.includes("NA亜型") || t.includes("野鳥")) return null;
  const confirmed = t.includes("疑似患畜の確認");
  const lifted = t.includes("移動制限の解除");
  if (confirmed === lifted) return null;
  return confirmed ? "confirmed" : "movement_lifted";
}

const PRESS_HOST = "www.maff.go.jp";
const PRESS_PATH = "/j/press/";

/** 一覧のリンクから、確認と解除の報道発表だけを取り出す。農林水産省の報道発表（https）だけを受け、同じ url は 1 度だけ。 */
export function filterMaffItems(links: Array<{ href: string; text: string }>): Array<{ url: string; title: string; type: MaffItemType }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; title: string; type: MaffItemType }> = [];
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link.href);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || u.hostname !== PRESS_HOST || !u.pathname.startsWith(PRESS_PATH) || !u.pathname.endsWith(".html")) continue;
    const type = isMaffOutbreakTitle(link.text);
    if (type === null) continue;
    u.hash = "";
    const url = u.href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: link.text, type });
  }
  return out;
}

// ── 本文の定型文 ──
// 本文は normalizeForMatch の後の文字列で見る（空白と改行が消え、全角の数字と記号が半角になる）。
// 定型が崩れていれば null（呼び出し側は読み取りの箱に回す）。直さない、推測しない。

const PREF_NAMES = PREFS.map((p) => p.name);

/** 令和N年、または西暦の年から、実在する日付を作る。実在しなければ null。 */
function isoDate(reiwa: string | undefined, western: string | undefined, month: string, day: string): IsoDate | null {
  const year = reiwa !== undefined ? 2018 + Number(reiwa) : Number(western);
  const date = `${String(year).padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  try {
    return addDays(date, 0);
  } catch {
    return null;
  }
}

const DATE_SRC = "(?:令和(\\d+)|(\\d{4}))年(\\d+)月(\\d+)日";
function dateFrom(m: RegExpMatchArray | null, offset = 1): IsoDate | null {
  if (m === null) return null;
  return isoDate(m[offset], m[offset + 1], m[offset + 2]!, m[offset + 3]!);
}

/** 「岡山県津山市」→ 県と、その後ろ。県の名前で始まらなければ null。 */
function splitPref(s: string): { prefCode: PrefCode; rest: string } | null {
  const name = PREF_NAMES.find((n) => s.startsWith(n));
  if (name === undefined) return null;
  const prefCode = prefCodeOfName(name);
  return prefCode === null ? null : { prefCode, rest: s.slice(name.length) };
}

/** 市町村名として読める文字列か。郡は外す（白老郡白老町 → 白老町）。読めなければ null。 */
function muniOf(s: string): string | null {
  const m = /^(?:.+郡)?(.+[町村])$/.exec(s);
  const name = m !== null && s.includes("郡") ? m[1]! : s;
  return /^[^\d,.:;、。()<>「」]{1,12}[市町村区]$/.test(name) ? name : null;
}

export interface MaffPress {
  prefCode: PrefCode;
  muniName: string;
  nationalNo: number;
  date: IsoDate;
}

/**
 * 確定（疑似患畜の確認）の発表。見出しの日付、今シーズン国内N例目、冒頭文の県（と市町村）、農場の概要の所在地から取る。
 * 冒頭文に市町村がなくても所在地から取る。冒頭文と所在地の県や市町村が食い違えば null。
 */
export function parseMaffPress(body: string): MaffPress | null {
  const t = normalizeForMatch(body);
  const date = dateFrom(new RegExp(`${DATE_SRC}農林水産省`).exec(t));
  const no = /今シーズン国内(\d+)例目/.exec(t);
  const lead = /本日[、,](.+?)の家きん農場において/.exec(t);
  const place = /所在地:(.*?)(?=飼養状況:|関連農場:|2\.経緯|$)/.exec(t);
  if (date === null || no === null || lead === null || place === null) return null;

  const fromLead = splitPref(lead[1]!);
  const fromPlace = splitPref(place[1]!);
  if (fromLead === null || fromPlace === null || fromLead.prefCode !== fromPlace.prefCode) return null;
  const muniName = muniOf(fromPlace.rest);
  if (muniName === null) return null;
  if (fromLead.rest !== "" && muniOf(fromLead.rest) !== muniName) return null;
  return { prefCode: fromPlace.prefCode, muniName, nationalNo: Number(no[1]), date };
}

/** 「飼養状況:約45.9万羽(採卵鶏)」から羽数と用途。関連農場の行は読まない。読めない項目は null。 */
export function parseMaffFarm(body: string): { headCount: number | null; birdUse: string | null } {
  const t = normalizeForMatch(body);
  const at = t.indexOf("飼養状況:");
  if (at < 0) return { headCount: null, birdUse: null };
  const rest = t.slice(at + "飼養状況:".length);
  const m = /^約?(\d[\d,]*(?:\.\d+)?)(万)?羽/.exec(rest);
  if (m === null) return { headCount: null, birdUse: null };
  const headCount = Math.round(Number(m[1]!.replace(/,/g, "")) * (m[2] === undefined ? 1 : 10000));

  let birdUse: string | null = null;
  const after = rest.slice(m[0].length);
  if (after.startsWith("(")) {
    let depth = 0;
    for (let i = 0; i < after.length; i++) {
      if (after[i] === "(") depth += 1;
      else if (after[i] === ")") depth -= 1;
      if (depth === 0) {
        birdUse = after.slice(1, i) || null;
        break;
      }
    }
  }
  return { headCount: Number.isFinite(headCount) ? headCount : null, birdUse };
}

export interface MaffLift {
  prefCode: PrefCode;
  muniName: string;
  nationalNos: number[];
  /** 移動制限を解除した日（見出しの日付ではない）。 */
  date: IsoDate;
  /** 事例が 1 つの発表のときだけ。 */
  controlDone: IsoDate | null;
  shipmentLifted: IsoDate | null;
}

/**
 * 移動制限の解除の発表。県、市町村、今シーズン国内N例目（複数可）、解除した日（冒頭文の「…をもって」の前の最後の日付）。
 * 事例が 1 つのときだけ、防疫措置の完了日と搬出制限の解除日も取る。発生日より前、解除日より後の日付は原本の書き間違いとみなし null にする（直さない）。
 */
export function parseMaffLift(body: string): MaffLift | null {
  const t = normalizeForMatch(body);
  const lead = /農林水産省(北海道|[^\d,、。()]{2,3}[都府県])は[、,]([^,、。]+?)で確認された高病原性鳥インフルエンザ\(今シーズン国内(.+?)例目\)に関し([^。]*?)をもって/.exec(t);
  if (lead === null) return null;
  const pref = splitPref(`${lead[1]!}${lead[2]!}`);
  if (pref === null) return null;
  const muniName = muniOf(pref.rest);
  const nationalNos = [...lead[3]!.matchAll(/\d+/g)].map((n) => Number(n[0]));
  if (muniName === null || nationalNos.length === 0) return null;

  const dates = [...lead[4]!.matchAll(new RegExp(DATE_SRC, "g"))];
  const date = dateFrom(dates.at(-1) ?? null);
  if (date === null) return null;

  let controlDone: IsoDate | null = null;
  let shipmentLifted: IsoDate | null = null;
  if (nationalNos.length === 1) {
    const outbreak = dateFrom(new RegExp(`${DATE_SRC}に[^。]{0,12}の家きん農場において`).exec(t));
    const lower = outbreak ?? addDays(date, -120);
    const inRange = (d: IsoDate | null): IsoDate | null => (d !== null && d >= lower && d <= date ? d : null);
    shipmentLifted = inRange(dateFrom(new RegExp(`${DATE_SRC}に[^。]*?搬出制限を解除`).exec(t)));
    controlDone = inRange(dateFrom(new RegExp(`防疫措置が完了した${DATE_SRC}の翌日から`).exec(t)));
  }
  return { prefCode: pref.prefCode, muniName, nationalNos, date, controlDone, shipmentLifted };
}
