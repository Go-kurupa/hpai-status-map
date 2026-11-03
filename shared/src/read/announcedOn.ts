// 文書の発表日の取り出し（I-18 の修正）。verifyRead の announcedOn に渡し、引用が「本日」だけの発表を確かめる。
// 誤った発表日は誤った日付を通してしまうので、確かな書き方だけを取り、取れなければ null（確認中に倒れる）。
//   - ラベルつきの日付: 掲載日、発表日、公表日、公開日、報道発表日。更新日は取らない（発表日とは限らない）。
//   - 国の報道発表: 見出しの日付（「農林水産省」の直前）。
// 食い違う日付が複数あれば null。
import { addDays } from "../dates";
import { normalizeForMatch } from "../text";
import type { IsoDate } from "../types";

const DATE = "(?:令和(\\d+)年(\\d+)月(\\d+)日|(\\d{4})年(\\d+)月(\\d+)日|(\\d{4})[/.\\-](\\d{1,2})[/.\\-](\\d{1,2}))";
const LABELED = new RegExp(`(?:掲載日|発表日|公表日|公開日|報道発表日)[:\\s]*${DATE}`, "gu");
const MAFF_HEADING = new RegExp(`${DATE}農林水産省`, "u");

function toIso(m: RegExpMatchArray | RegExpExecArray, offset: number): IsoDate | null {
  const g = m.slice(offset, offset + 9);
  let y: number;
  let mo: string;
  let d: string;
  if (g[0] !== undefined) [y, mo, d] = [2018 + Number(g[0]), g[1]!, g[2]!];
  else if (g[3] !== undefined) [y, mo, d] = [Number(g[3]), g[4]!, g[5]!];
  else if (g[6] !== undefined) [y, mo, d] = [Number(g[6]), g[7]!, g[8]!];
  else return null;
  const iso = `${String(y).padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  try {
    return addDays(iso, 0) === iso ? iso : null;
  } catch {
    return null;
  }
}

/** 本文から発表日を取る。取れない、食い違う、実在しないときは null。 */
export function extractAnnouncedOn(text: string, opts: { maff?: boolean } = {}): IsoDate | null {
  const t = normalizeForMatch(text);
  if (opts.maff === true) {
    const m = MAFF_HEADING.exec(t);
    if (m !== null) return toIso(m, 1);
  }
  const found = new Set<string | null>();
  for (const m of t.matchAll(LABELED)) found.add(toIso(m, 1));
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}

// ── フィードの日付の厳密な読み ──
// Date.parse は書き方によって実行環境のローカル時刻で読み、日本時間に直すと 1 日ずれる。ここでは決まった書き方だけを読み、
// ゾーンのない日時は日本時間として読む（+9 時間しない）。読めない、実在しないときは null。

const JST_OFFSET_MIN = 9 * 60;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** RFC 822 の名前つきのゾーン（分）。 */
const NAMED_ZONES: Record<string, number> = { UT: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };

/** 年月日時分と、ゾーンのずれ（分。null は日本時間）から、日本時間の日付。実在しなければ null。 */
function jstDate(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMin: number | null): IsoDate | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const check = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  try {
    if (addDays(check, 0) !== check) return null;
  } catch {
    return null;
  }
  const utc = Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59)) - (offsetMin ?? JST_OFFSET_MIN) * 60_000;
  return new Date(utc + JST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

const RFC822 = /^(?:(?:mon|tue|wed|thu|fri|sat|sun),\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{4}|\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([a-z]+|[+-]\d{4}))?$/iu;

/** RSS の pubDate（RFC 822）を日本時間の日付にする。 */
export function parseRfc822Date(s: string): IsoDate | null {
  const m = RFC822.exec(s.trim());
  if (m === null) return null;
  const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  if (mo === 0) return null;
  const yy = Number(m[3]);
  const y = m[3]!.length === 2 ? (yy < 50 ? 2000 + yy : 1900 + yy) : yy;
  let offset: number | null = null;
  const zone = m[7];
  if (zone !== undefined) {
    if (/^[+-]\d{4}$/.test(zone)) {
      const sign = zone.startsWith("-") ? -1 : 1;
      offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
    } else if (NAMED_ZONES[zone.toUpperCase()] !== undefined) {
      offset = NAMED_ZONES[zone.toUpperCase()]!;
    } else {
      return null;
    }
  }
  return jstDate(y, mo, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), offset);
}

const ISO8601 = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|z|[+-]\d{2}:?\d{2})?)?$/u;

/** Atom の published（ISO 8601）を日本時間の日付にする。日付だけの書き方は、そのまま日本時間の日付。 */
export function parseIso8601Date(s: string): IsoDate | null {
  const m = ISO8601.exec(s.trim());
  if (m === null) return null;
  let offset: number | null = null;
  const zone = m[7];
  if (zone !== undefined) {
    if (zone.toUpperCase() === "Z") offset = 0;
    else {
      const z = zone.replace(":", "");
      offset = (z.startsWith("-") ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
    }
  }
  return jstDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), offset);
}
