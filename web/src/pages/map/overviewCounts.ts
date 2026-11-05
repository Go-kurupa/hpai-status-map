// 毎朝の札の数え方（純粋な関数と、県の形を待つ計算）。文は持たない。多い少ないを判断しない。
import { addDays } from "@hpai/shared/dates";
import { distanceToMuniKm, type GeoStore } from "@hpai/shared/geo";
import { isCountable, isWithinDistanceBand } from "@hpai/shared/level";
import { mesh3Center } from "@hpai/shared/mesh";
import { compareSeasons } from "@hpai/shared/seasonCompare";
import { seasonOf } from "@hpai/shared/season";
import type { Case, HistoryCase, IsoDate, MeshCode, MuniCode, Season } from "@hpai/shared/types";
import { caseDate } from "./seasonView";

export const RECENT_DAYS = 14;
/** 今季と比べる過去のシーズンの数（シーズンの棒と同じ） */
export const PAST_SEASONS = 6;

/** 枠で絞るときの広げ幅（度）。緯度 0.6 度は約 66km、経度 0.8 度は北緯 45.6 度でも約 62km で、距離の帯（60km）より広い */
const BBOX_MARGIN_LAT_DEG = 0.6;
const BBOX_MARGIN_LNG_DEG = 0.8;

/** 今日を含む直近 14 日の今季の件数。日付のない事例は数える（少ない側に倒さない。countThisSeasonToDate と同じ）。未来の日付は入れない */
export function countRecentDays(cases: readonly Case[], current: Season, today: IsoDate): number {
  const from = addDays(today, -(RECENT_DAYS - 1));
  return cases.filter((c) => {
    if (c.season !== current || !isCountable(c)) return false;
    const d = caseDate(c) ?? today;
    return d >= from && d <= today;
  }).length;
}

/** 比べる過去のシーズン（新しい順）。最大 6 つで、記録の最も古いシーズンより前は入れない */
export function pastSeasonsOf(history: readonly HistoryCase[], current: Season): Season[] {
  if (history.length === 0) return [];
  const first = Math.min(...history.map((h) => h.season));
  const oldest = Math.max(current - PAST_SEASONS, first);
  const out: Season[] = [];
  for (let s = current - 1; s >= oldest; s--) out.push(s);
  return out;
}

export interface PastRange {
  seasons: number;
  min: number;
  max: number;
}

/** 過去のシーズンの、今日と同じ日までの件数の幅。比べるシーズンがなければ null。件数のないシーズンは 0 件として入れる */
export function pastRangeToDate(history: readonly HistoryCase[], today: IsoDate): PastRange | null {
  const seasons = pastSeasonsOf(history, seasonOf(today));
  if (seasons.length === 0) return null;
  const toDate = new Map(compareSeasons(history, today).map((r) => [r.season, r.countToDate]));
  const counts = seasons.map((s) => toDate.get(s) ?? 0);
  return { seasons: seasons.length, min: Math.min(...counts), max: Math.max(...counts) };
}

export function rangeText(r: PastRange): string {
  return r.min === r.max ? `${r.min} 件` : `${r.min}〜${r.max} 件`;
}

/**
 * マス目の中心から距離の帯（約 60km）以内の市町村で起きた事例の数。呼び出し側が数える事例を選んで渡す。
 * 町が分からない事例は距離を計算できないので入れない。遠い町は索引の枠で除き、近い町の県の形だけを読む。
 * 形を読めないときと、知らない町があるときは投げる（0 件にしない）。
 */
export async function casesWithinBand(meshCode: MeshCode, cases: readonly Case[], geo: GeoStore): Promise<number> {
  const { lat, lng } = mesh3Center(meshCode);
  const near = (muni: MuniCode): boolean => {
    const entry = geo.index[muni];
    if (!entry) return true; // 枠が分からない町は距離の計算で投げる
    const [w, s, e, n] = entry.bbox;
    return lat >= s - BBOX_MARGIN_LAT_DEG && lat <= n + BBOX_MARGIN_LAT_DEG && lng >= w - BBOX_MARGIN_LNG_DEG && lng <= e + BBOX_MARGIN_LNG_DEG;
  };
  const candidates = cases.flatMap((c) => (c.muniCode !== null && near(c.muniCode) ? [c.muniCode] : []));
  await geo.ensurePrefs([...new Set(candidates.map((m) => geo.index[m]?.prefCode ?? m.slice(0, 2)))]);
  const within = new Map<MuniCode, boolean>();
  let count = 0;
  for (const muni of candidates) {
    let hit = within.get(muni);
    if (hit === undefined) {
      hit = isWithinDistanceBand(distanceToMuniKm(meshCode, muni, geo));
      within.set(muni, hit);
    }
    if (hit) count++;
  }
  return count;
}
