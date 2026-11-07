import { jstDateOf, yearMonthOf } from "./dates";
import type { IsoDate, Season } from "./types";

/** シーズンは 6 月 1 日から翌年 5 月 31 日まで。2025 = 2025-06-01〜2026-05-31。 */
export function seasonOf(date: IsoDate): Season {
  const { year, month } = yearMonthOf(date);
  return month >= 6 ? year : year - 1;
}

/** 今のシーズン。日本時間の暦日で数える。 */
export function currentSeason(now: Date): Season {
  return seasonOf(jstDateOf(now));
}

/** 今季 / 1 年前 / 2 年前 …（2026-11-07 作者の決定: 「昨季」は「1 年前」とそろえる）。未来のシーズンは RangeError。 */
export function seasonAgoLabel(season: Season, current: Season): string {
  const ago = current - season;
  if (!Number.isInteger(ago) || ago < 0) throw new RangeError(`シーズンが今季より先です: ${season} (今季 ${current})`);
  if (ago === 0) return "今季";
  return `${ago} 年前`;
}
