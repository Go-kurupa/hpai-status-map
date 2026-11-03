import type { IsoDate, IsoDateTime } from "./types";

// 時刻は UTC+9 固定（日本に夏時間はない）。Intl は使わない。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" を UTC 0 時のミリ秒にする。実在しない日付は RangeError。 */
function dateToUtcMs(date: IsoDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`日付の形式が違います: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    throw new RangeError(`実在しない日付です: ${date}`);
  }
  return ms;
}

function utcMsToDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

function assertValid(d: Date): void {
  if (Number.isNaN(d.getTime())) throw new RangeError("日時が不正です");
}

/** 日本時間の暦日。 */
export function jstDateOf(d: Date): IsoDate {
  assertValid(d);
  return utcMsToDate(d.getTime() + JST_OFFSET_MS);
}

/** "2025-12-20T09:00:00+09:00" の形。ミリ秒は落とす。 */
export function toJstIso(d: Date): IsoDateTime {
  assertValid(d);
  return `${new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError(`日数は整数にしてください: ${days}`);
  return utcMsToDate(dateToUtcMs(date) + days * DAY_MS);
}

/** later - earlier の日数。 */
export function diffDays(later: IsoDate, earlier: IsoDate): number {
  return Math.round((dateToUtcMs(later) - dateToUtcMs(earlier)) / DAY_MS);
}

/** season.ts が使う。"YYYY-MM-DD" から年と月を取る（形式の検証つき）。 */
export function yearMonthOf(date: IsoDate): { year: number; month: number } {
  dateToUtcMs(date);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}
