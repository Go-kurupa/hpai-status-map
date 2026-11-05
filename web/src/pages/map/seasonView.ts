// 地図の 1 シーズン分の見え方を、事例から計算する（純粋な関数だけ。maplibre も React も読まない）。
// 今季は currentCases（Firestore）、過去は history（data/history/cases.json）から数える。履歴の今季と同じ年は混ぜない。
import { isCountable } from "@hpai/shared/level";
import { pastCasesOf } from "@hpai/shared/history";
import { caseDate, isSuspectedOnly } from "@hpai/shared/overview";
import { PREFS } from "@hpai/shared/pref";
import { seasonAgoLabel } from "@hpai/shared/season";
import type { Case, HistoryCase, IsoDate, MuniCode, PrefCode, Season } from "@hpai/shared/types";

/** この倍率より小さいと県のバッジ、以上だと市町村の塗り（設計書 §15） */
export const MUNI_ZOOM = 7;
/** [[西, 南], [東, 北]]。日本全体 */
export const JAPAN_BOUNDS: [[number, number], [number, number]] = [
  [122.9, 24.0],
  [146.0, 45.6],
];

export interface MonthBar {
  /** 1〜12 */
  month: number;
  count: number;
  /** 羽数が分かっている事例の合計 */
  headCount: number;
  /** 羽数の記載がない事例の数（headCount に入れていない） */
  unknownHeadCases: number;
}

export interface SeasonView {
  season: Season;
  /** 今季 / 昨季 / 2 年前 … */
  label: string;
  isCurrent: boolean;
  /** false は「まだ読めていない」。0 件とは違う */
  loaded: boolean;
  cases: readonly Case[];
  suspectedMuniCodes: MuniCode[];
  confirmedMuniCodes: MuniCode[];
  countByPref: Record<PrefCode, number>;
  /** 確認中の発表がある県（件数と塗りには入れない） */
  reviewingPrefCodes: PrefCode[];
  total: number;
  months: MonthBar[];
  /** 数えた事例のうち、日付がなく月の棒に入れられなかった数 */
  undatedCases: number;
}

export interface SeasonInput {
  season: Season;
  current: Season;
  /** null は今季の事例がまだ読めていない */
  currentCases: readonly Case[] | null;
  /** null は過去の記録がまだ読めていない。関連農場（related:true）が混ざっていても数えない */
  history: readonly HistoryCase[] | null;
}

/** シーズンの月の並び（6 月始まり） */
const SEASON_MONTHS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5] as const;
/** 事例がなくても出す月（シーズン 10 月〜翌 5 月） */
const ALWAYS_MONTHS = new Set([10, 11, 12, 1, 2, 3, 4, 5]);

export { caseDate };

function buildMonths(counted: readonly Case[]): { months: MonthBar[]; undated: number } {
  const byMonth = new Map<number, MonthBar>();
  let undated = 0;
  for (const c of counted) {
    const d = caseDate(c);
    const month = d ? Number(d.slice(5, 7)) : NaN;
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      undated++;
      continue;
    }
    const bar = byMonth.get(month) ?? { month, count: 0, headCount: 0, unknownHeadCases: 0 };
    bar.count++;
    if (c.headCount === null) bar.unknownHeadCases++;
    else bar.headCount += c.headCount;
    byMonth.set(month, bar);
  }
  const months = SEASON_MONTHS.filter((m) => ALWAYS_MONTHS.has(m) || byMonth.has(m)).map(
    (m) => byMonth.get(m) ?? { month: m, count: 0, headCount: 0, unknownHeadCases: 0 },
  );
  return { months, undated };
}

function sortedUnique(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort();
}

export function buildSeasonView(i: SeasonInput): SeasonView {
  const isCurrent = i.season === i.current;
  const label = seasonAgoLabel(i.season, i.current);

  let source: readonly Case[] = [];
  let loaded: boolean;
  if (isCurrent) {
    loaded = i.currentCases !== null;
    source = i.currentCases ?? [];
  } else {
    loaded = i.history !== null;
    // pastCasesOf が related:true を除く（関連農場は件数にも塗りにも入れない）
    source = i.history ? pastCasesOf(i.history).filter((c) => c.season === i.season) : [];
  }
  const sameSeason = source.filter((c) => c.season === i.season);
  const counted = sameSeason.filter(isCountable);

  const confirmed = new Set<MuniCode>();
  const suspected = new Set<MuniCode>();
  const countByPref: Record<PrefCode, number> = {};
  for (const c of counted) {
    countByPref[c.prefCode] = (countByPref[c.prefCode] ?? 0) + 1;
    if (c.muniCode === null) continue;
    (isSuspectedOnly(c) ? suspected : confirmed).add(c.muniCode);
  }
  for (const code of confirmed) suspected.delete(code); // 同じ町に確定があれば確定で塗る

  const reviewing = sameSeason.filter((c) => c.confirmState === "reviewing" && c.negation !== "negated").map((c) => c.prefCode);
  const { months, undated } = loaded ? buildMonths(counted) : { months: [], undated: 0 };

  return {
    season: i.season,
    label,
    isCurrent,
    loaded,
    cases: counted,
    suspectedMuniCodes: sortedUnique(suspected),
    confirmedMuniCodes: sortedUnique(confirmed),
    countByPref,
    reviewingPrefCodes: sortedUnique(reviewing),
    total: counted.length,
    months,
    undatedCases: undated,
  };
}

/** 棒グラフ。今季から最大 6 年前まで。履歴の最も古いシーズンより前は作らない。count null は「まだ読めていない」 */
export function listSeasonBars(i: Omit<SeasonInput, "season">): Array<{ season: Season; label: string; count: number | null }> {
  const first = i.history && i.history.length > 0 ? Math.min(...i.history.map((h) => h.season)) : i.current - 6;
  const oldest = Math.max(i.current - 6, first);
  const bars: Array<{ season: Season; label: string; count: number | null }> = [];
  for (let s = i.current; s >= oldest; s--) {
    const v = buildSeasonView({ ...i, season: s });
    bars.push({ season: s, label: v.label, count: v.loaded ? v.total : null });
  }
  return bars;
}

/** 全国の倍率（MUNI_ZOOM 未満）の県のバッジ。1 件以上の県と、確認中の県だけ */
export function badgeStates(view: SeasonView, zoom: number): Array<{ prefCode: PrefCode; text: string }> {
  if (!view.loaded || zoom >= MUNI_ZOOM) return [];
  const reviewing = new Set(view.reviewingPrefCodes);
  const out: Array<{ prefCode: PrefCode; text: string }> = [];
  for (const { code } of PREFS) {
    const n = view.countByPref[code] ?? 0;
    const rev = reviewing.has(code);
    if (n === 0 && !rev) continue;
    out.push({ prefCode: code, text: n > 0 && rev ? `${n} 件・確認中` : rev ? "確認中" : String(n) });
  }
  return out;
}

