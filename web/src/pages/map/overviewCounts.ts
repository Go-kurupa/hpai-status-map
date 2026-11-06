// 毎朝の札の数え方（純粋な関数と、県の形を待つ計算）。文は持たない。多い少ないを判断しない。
import { centerDistanceKm, distanceToMuniKm, type GeoStore } from "@hpai/shared/geo";
import { isCountable, isWithinDistanceBand } from "@hpai/shared/level";
import { mesh3Center } from "@hpai/shared/mesh";
import { nearbyPast, type NearbyPastSummary } from "@hpai/shared/past";
import { pastSeasonsOf } from "@hpai/shared/overview";
import type { Case, HistoryCase, MeshCode, MuniCode, Season } from "@hpai/shared/types";

export { countRecentDays, pastRangeToDate, pastSeasonsOf, PAST_SEASONS, rangeText, RECENT_DAYS, wildBirdCounts } from "@hpai/shared/overview";
export type { PastRange, WildBirdCount } from "@hpai/shared/overview";

/** 枠で絞るときの広げ幅（度）。緯度 0.6 度は約 66km、経度 0.8 度は北緯 45.6 度でも約 62km で、距離の帯（60km）より広い */
const BBOX_MARGIN_LAT_DEG = 0.6;
const BBOX_MARGIN_LNG_DEG = 0.8;

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

/**
 * 町だけのとき: 町の中心から距離の帯（約 60km）以内の町で起きた事例の数。呼び出し側が数える事例を選んで渡す。
 * 町が分からない事例と、索引にない町の事例があれば null（0 件と言えない）。県の形を読まない
 */
export function casesNearCenter(town: MuniCode, cases: readonly Case[], geo: GeoStore): number | null {
  if (!Object.hasOwn(geo.index, town)) return null;
  let count = 0;
  for (const c of cases) {
    if (c.muniCode === null || !Object.hasOwn(geo.index, c.muniCode)) return null;
    if (isWithinDistanceBand(centerDistanceKm(town, c.muniCode, geo))) count++;
  }
  return count;
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
