// 過去のシーズンとの比べ。過去の事例（data/history/cases.json）だけから数える純粋な関数（予測はしない）。
// 関連農場（related:true）は数えない。シーズンは 6 月 1 日から翌年 5 月 31 日。
import { yearMonthOf } from "./dates";
import { PREFS } from "./pref";
import { seasonOf } from "./season";
import type { HistoryCase, IsoDate, PrefCode, Season } from "./types";

/** 月ごとの件数に出す月（シーズンの流れの順: 10 月〜翌 5 月） */
export const COMPARE_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5] as const;
/** 件数の多かった県を何県まで出すか */
export const TOP_PREF_LIMIT = 5;

export interface SeasonCompareRow {
  season: Season;
  /** 今日と同じ月日まで（その日を含む）の件数。比べる日はシーズンの中の同じ位置 */
  countToDate: number;
  /** そのシーズンの合計 */
  total: number;
  /** 最初の発生の日。事例がなければ null */
  firstDate: IsoDate | null;
  /** 10〜5 月の件数（COMPARE_MONTHS の順）。6〜9 月の件数は含まない */
  months: Array<{ month: number; count: number }>;
  /** 件数の多かった県の上位（同数は県コードの順） */
  topPrefs: Array<{ prefCode: PrefCode; name: string; count: number }>;
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/** シーズンの中の位置。6 月 1 日が最小、5 月 31 日が最大になる（うるう日の有無に左右されない） */
function seasonPosition(date: IsoDate): number {
  const { month } = yearMonthOf(date);
  const day = Number(date.slice(8, 10));
  return (month >= 6 ? month - 6 : month + 6) * 100 + day;
}

/**
 * 過去のシーズンごとの比べ。today のシーズン（今季）は含めない。古いシーズンから順。
 * today は "YYYY-MM-DD"（日本時間の今日）。
 */
export function compareSeasons(history: readonly HistoryCase[], today: IsoDate): SeasonCompareRow[] {
  const current = seasonOf(today);
  const cutoff = seasonPosition(today);
  const counted = history.filter((h) => !h.related && h.season !== current && h.season < current);
  const seasons = [...new Set(counted.map((h) => h.season))].sort((a, b) => a - b);
  return seasons.map((season) => {
    const rows = counted.filter((h) => h.season === season);
    const byMonth = new Map<number, number>();
    const byPref = new Map<PrefCode, number>();
    for (const h of rows) {
      const m = yearMonthOf(h.date).month;
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
      byPref.set(h.prefCode, (byPref.get(h.prefCode) ?? 0) + 1);
    }
    const dates = rows.map((h) => h.date).sort();
    return {
      season,
      countToDate: rows.filter((h) => seasonPosition(h.date) <= cutoff).length,
      total: rows.length,
      firstDate: dates[0] ?? null,
      months: COMPARE_MONTHS.map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
      topPrefs: [...byPref.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_PREF_LIMIT)
        .map(([prefCode, count]) => ({ prefCode, name: PREF_NAME.get(prefCode) ?? prefCode, count })),
    };
  });
}

/** シーズンの表記。2026 → "2026/27" */
export function seasonSpan(season: Season): string {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}
