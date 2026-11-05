// 毎朝の札の数え方（純粋な関数と、県の形を待つ計算）。文は持たない。多い少ないを判断しない。
import { addDays } from "@hpai/shared/dates";
import { centerDistanceKm, distanceToMuniKm, type GeoStore } from "@hpai/shared/geo";
import { isCountable, isWithinDistanceBand } from "@hpai/shared/level";
import { mesh3Center } from "@hpai/shared/mesh";
import { nearbyPast, type NearbyPastSummary } from "@hpai/shared/past";
import { compareSeasons } from "@hpai/shared/seasonCompare";
import { seasonOf } from "@hpai/shared/season";
import type { Case, HistoryCase, IsoDate, MeshCode, MuniCode, Season, WildBird } from "@hpai/shared/types";
import { wildBirdRows } from "./listRows";
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

/** 枠で見て帯に入りうる町か。枠が分からない町は true（距離の計算で投げる） */
function nearByBbox(meshCode: MeshCode, geo: GeoStore): (muni: MuniCode) => boolean {
  const { lat, lng } = mesh3Center(meshCode);
  return (muni) => {
    const entry = geo.index[muni];
    if (!entry) return true;
    const [w, s, e, n] = entry.bbox;
    return lat >= s - BBOX_MARGIN_LAT_DEG && lat <= n + BBOX_MARGIN_LAT_DEG && lng >= w - BBOX_MARGIN_LNG_DEG && lng <= e + BBOX_MARGIN_LNG_DEG;
  };
}

/**
 * マス目の中心から距離の帯（約 60km）以内の市町村で起きた事例の数。呼び出し側が数える事例を選んで渡す。
 * 町が分からない事例は距離を計算できないので入れない。遠い町は索引の枠で除き、近い町の県の形だけを読む。
 * 形を読めないときと、知らない町があるときは投げる（0 件にしない）。
 */
export async function casesWithinBand(meshCode: MeshCode, cases: readonly Case[], geo: GeoStore): Promise<number> {
  const near = nearByBbox(meshCode, geo);
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

const nameFrom = (geo: GeoStore) => (muni: MuniCode) => geo.index[muni]?.name ?? muni;

/** 町だけのとき: 町の中心どうしの距離で周辺の過去を集計する。県の形を読まない。知らない町は投げる */
export function nearbyPastByCenter(town: MuniCode, history: readonly HistoryCase[], geo: GeoStore, current: Season): NearbyPastSummary {
  if (!Object.hasOwn(geo.index, town)) throw new Error(`市町村の索引にありません: ${town}`);
  return nearbyPast(history, pastSeasonsOf(history, current), nameFrom(geo), (muni) => centerDistanceKm(town, muni, geo));
}

/** 地点があるとき: マス目から町の面までの距離で周辺の過去を集計する（約 60km の札と同じ測り方）。形を読めなければ投げる */
export async function nearbyPastFromMesh(meshCode: MeshCode, history: readonly HistoryCase[], geo: GeoStore, current: Season): Promise<NearbyPastSummary> {
  const seasons = pastSeasonsOf(history, current);
  const window = new Set(seasons);
  const near = nearByBbox(meshCode, geo);
  const candidates = new Set(history.flatMap((h) => (!h.related && window.has(h.season) && near(h.muniCode) ? [h.muniCode] : [])));
  await geo.ensurePrefs([...new Set([...candidates].map((m) => geo.index[m]?.prefCode ?? m.slice(0, 2)))]);
  return nearbyPast(history, seasons, nameFrom(geo), (muni) => (candidates.has(muni) ? distanceToMuniKm(meshCode, muni, geo) : Number.POSITIVE_INFINITY));
}

export interface FrequentTownCount {
  muniCode: MuniCode;
  count: number;
}

/** 登録した町ごとの今季の件数（登録の順）。発生のない町も 0 として返す。多い少ないを判断しない */
export function frequentTownCounts(cases: readonly Case[], towns: readonly MuniCode[], current: Season): FrequentTownCount[] {
  return towns.map((muniCode) => ({ muniCode, count: cases.filter((c) => c.season === current && isCountable(c) && c.muniCode === muniCode).length }));
}

export interface WildBirdCount {
  total: number;
  confirmed: number;
  screening: number;
}

/** 野鳥の陽性の件数。否定を除き、検査中と確定を分ける（一覧の wildBirdRows と同じ扱い） */
export function wildBirdCounts(birds: readonly WildBird[]): WildBirdCount {
  const rows = wildBirdRows(birds);
  const confirmed = rows.filter((b) => b.label === "高病原性の確定").length;
  return { total: rows.length, confirmed, screening: rows.length - confirmed };
}
