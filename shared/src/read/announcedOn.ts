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
