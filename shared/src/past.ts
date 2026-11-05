// 町の過去の発生を 1 文にする（契約 2.1 の「related:true を見るのは describePast だけ」、設計書 §15）。
// 過去の記録は事実の報告で、これからを予測しない。関連農場は件数に入れず、ここで「関連農場」と明示する。
// 関連農場の日付は、本体の日付を借りている行がある（F-08）。日付は表に出さない（出すときは本体の日付として出す）。
import type { GeoStore } from "./geo";
import { pastCasesOf } from "./history";
import { isWithinDistanceBand } from "./level";
import { seasonAgoLabel } from "./season";
import type { HistoryCase, IsoDate, MuniCode, Season } from "./types";

export interface PastHit extends HistoryCase {
  /** 昨季 / 2 年前 … */
  ago: string;
  relation: "same" | "adjacent";
  /**
   * 関連農場（related:true）のとき、本体（同じ season と no の related:false）の発生日。本体が history にないと null。
   * 関連農場の行は、原本に個別の発生日がなく本体の日付を借りたものがある（F-08）。画面は h.date ではなくこちらを
   * 「本体の日付」として出す。related:false のときは null。
   */
  parentDate: IsoDate | null;
}

export interface PastSummary {
  sentence: string;
  /** sentence の元になった記録。本体があれば本体のうち最も新しいもの。なければ関連農場。何もなければ null */
  latest: PastHit | null;
  /** 新しい順。同じ日はこの町、次に本体を先にする */
  hits: PastHit[];
}

export const PAST_NONE = "過去の記録に、この町と隣町の発生はありません（記録）";

function order(a: PastHit, b: PastHit): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.relation !== b.relation) return a.relation === "same" ? -1 : 1;
  if (a.related !== b.related) return a.related ? 1 : -1;
  return b.no - a.no;
}

/**
 * この町と隣町の過去の発生。今季とそれより先のシーズンは数えない（再現の今季が 2025 なら 2025 も数えない）。
 * 知らない市町村コードは隣がない扱い。入力は並べ替えない。
 */
export function describePast(
  muniCode: MuniCode,
  history: readonly HistoryCase[],
  geo: Pick<GeoStore, "adjacency">,
  current: Season,
): PastSummary {
  const neighbors = new Set(geo.adjacency[muniCode] ?? []);
  // 本体は町が離れていて hits に入らないことがあるので、history 全体から探す
  const parentOf = new Map<string, IsoDate>();
  for (const h of history) if (!h.related) parentOf.set(`${h.season}-${h.no}`, h.date);
  const hits: PastHit[] = [];
  for (const h of history) {
    if (h.season >= current) continue; // seasonAgoLabel が先のシーズンで投げるのも、ここで避ける
    const relation = h.muniCode === muniCode ? "same" : neighbors.has(h.muniCode) ? "adjacent" : null;
    if (relation === null) continue;
    const parentDate = h.related ? (parentOf.get(`${h.season}-${h.no}`) ?? null) : null;
    hits.push({ ...h, ago: seasonAgoLabel(h.season, current), relation, parentDate });
  }
  hits.sort(order);

  const latest = hits.find((h) => !h.related) ?? hits[0] ?? null;
  if (latest === null) return { sentence: PAST_NONE, latest: null, hits };
  const where = latest.relation === "same" ? "この町" : "隣町";
  const what = latest.related ? "関連農場がありました" : "発生しました";
  return { sentence: `${latest.ago}に${where}で${what}（記録）`, latest, hits };
}

/** 周辺の 1 町。distanceKm は丸めない（表示で「約」を付けて丸める）。seasons は新しい順 */
export interface NearbyTown {
  muniCode: MuniCode;
  name: string;
  distanceKm: number;
  count: number;
  seasons: Season[];
}

export interface NearbyPastSummary {
  /** 近い順。距離が同じなら町のコードの順 */
  towns: NearbyTown[];
  total: number;
  /** 発生の記録があるシーズンの数 */
  seasonsWithCases: number;
  /** 見たシーズンの数 */
  windowSeasons: number;
}

/**
 * 距離の帯（約 60km）以内の町の過去の発生を、町ごとに集計する。関連農場は除く（pastCasesOf）。多い少ないを判断しない。
 * 距離の測り方は呼び出し側が決める。判定は丸めない距離で行う。距離を計算できない町は distanceKmOf が投げる（0 件にしない）。
 */
export function nearbyPast(
  history: readonly HistoryCase[],
  seasons: readonly Season[],
  nameOf: (muni: MuniCode) => string,
  distanceKmOf: (muni: MuniCode) => number,
): NearbyPastSummary {
  const window = new Set(seasons);
  const distance = new Map<MuniCode, number>();
  const towns = new Map<MuniCode, NearbyTown>();
  const seen = new Set<Season>();
  let total = 0;
  for (const c of pastCasesOf(history)) {
    if (c.muniCode === null || !window.has(c.season)) continue;
    let km = distance.get(c.muniCode);
    if (km === undefined) {
      km = distanceKmOf(c.muniCode);
      distance.set(c.muniCode, km);
    }
    if (!isWithinDistanceBand(km)) continue;
    let town = towns.get(c.muniCode);
    if (!town) {
      town = { muniCode: c.muniCode, name: nameOf(c.muniCode), distanceKm: km, count: 0, seasons: [] };
      towns.set(c.muniCode, town);
    }
    town.count++;
    if (!town.seasons.includes(c.season)) town.seasons.push(c.season);
    seen.add(c.season);
    total++;
  }
  for (const t of towns.values()) t.seasons.sort((a, b) => b - a);
  return {
    towns: [...towns.values()].sort((a, b) => a.distanceKm - b.distanceKm || (a.muniCode < b.muniCode ? -1 : a.muniCode > b.muniCode ? 1 : 0)),
    total,
    seasonsWithCases: seen.size,
    windowSeasons: seasons.length,
  };
}

/** 小さな規模の発生の境（羽数がこれ未満） */
export const SMALL_FLOCK_HEADS = 3000;

export interface SmallFlockCount {
  /** 関連農場を除く全国の発生の件数 */
  total: number;
  /** そのうち羽数が分かる件数 */
  known: number;
  /** 羽数が分かるうち、3,000 羽未満の件数。羽数が分からない行は数えない */
  small: number;
}

/** 全国の、関連農場を除く発生のうち、3,000 羽未満の件数。 */
export function countSmallFlocks(history: readonly HistoryCase[], seasons: readonly Season[]): SmallFlockCount {
  const window = new Set(seasons);
  const out: SmallFlockCount = { total: 0, known: 0, small: 0 };
  for (const c of pastCasesOf(history)) {
    if (!window.has(c.season)) continue;
    out.total++;
    if (c.headCount === null) continue;
    out.known++;
    if (c.headCount < SMALL_FLOCK_HEADS) out.small++;
  }
  return out;
}
