// 画面に出す日付の書き方。年は出さない（M-02、M-13、M-18 の文が使う）。
import type { IsoDate } from "./types";

/** "2025-12-19" → "12月19日"。月と日の頭の 0 は付けない。日付でない文字や存在しない日は RangeError。 */
export function formatJaDate(d: IsoDate): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`日付の形が違います（YYYY-MM-DD）: ${d}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`存在しない日付です: ${d}`);
  }
  return `${month}月${day}日`;
}
