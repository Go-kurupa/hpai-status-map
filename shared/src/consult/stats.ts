// AIに対策を相談: 発生の件数の問い（2026-11-07 作者の決定「A: AI と数えた表」）。
// Claude は問いを「何で分けて数えるか（groupBy）・どのシーズンか・どの県か」に読み替えるだけ。件数はこのファイルのプログラムが
// 過去の事例（data/history/cases.json、農林水産省の国内発生事例一覧の過去 6 シーズン）から数える。表の文もプログラムが組む（Claude は書かない）。
// 数え方は作品のほかの画面（データで探す）と同じ: 関連農場（related:true）は数えない。シーズンは 6 月 1 日から翌年 5 月 31 日。
// "near"（2026-11-08 豪さんの決定）は、件数の表ではなく、農場の町の中心から約 60 km 以内の町で起きた事例の一覧。
// 距離は町の中心どうし（地理の索引の center）。農場のマス目は使わない（関数は受け取っていない）。条件（町）がなければ一覧を作らず決まった文。
import { haversineKm } from "../geo";
import { DISTANCE_BAND_KM, isWithinDistanceBand } from "../level";
import { PREFS } from "../pref";
import type { HistoryCase, MuniCode, PrefCode } from "../types";

export type StatsGroupBy = "pref" | "season" | "month" | "use" | "near";
export const STATS_GROUP_BYS: readonly StatsGroupBy[] = ["pref", "season", "month", "use", "near"];

/** Claude が選ぶ数え方。season はシーズンの始まりの年（2024 = 2024 年 6 月〜2025 年 5 月）。null は絞らない */
export interface StatsQuery {
  groupBy: StatsGroupBy;
  season: number | null;
  prefCode: PrefCode | null;
}

export interface StatsRow {
  label: string;
  count: number;
}

/** 近くの町の事例の一覧の 1 行。文はすべてプログラムが組む */
export interface NearCaseRow {
  /** 「2025年12月19日」 */
  date: string;
  /** 県と、発生の当時の市町村の名前（「兵庫県姫路市」） */
  place: string;
  /** 国の一覧の用途の表記そのまま。記載がなければ「記載なし」 */
  use: string;
  /** 「1,200 羽」。記載がなければ「記載なし」 */
  headCount: string;
  /** 町の中心どうしの距離（「約 25 km」。農場と同じ町なら「同じ町」） */
  distance: string;
  /** 国の資料の URL */
  sourceUrl: string;
}

/** "near" の一覧。noFarm は条件（町）がなくて数えなかったとき（summary が決まった文、rows は空） */
export interface NearList {
  /** 新しい順の先頭 STATS_MAX_NEAR_ROWS 件まで */
  rows: NearCaseRow[];
  /** 表に出さなかった件数（STATS_MAX_NEAR_ROWS を超えた分）。なければ 0 */
  more: number;
  noFarm: boolean;
}

/** 画面に出す件数の表。文はすべてプログラムが組む */
export interface ConsultStats {
  query: StatsQuery;
  /** 表の題（例「岡山県の発生（シーズンごと）」） */
  title: string;
  /** 1〜2 文のまとめ（例「岡山県の過去 6 シーズンの発生は 6 件です。」） */
  summary: string;
  /** 表の左の列の名前（県・シーズン・月・飼っている鳥） */
  labelHeader: string;
  rows: StatsRow[];
  /** 表に出さなかった行の数と件数（県が多いとき）。なければ null */
  rest: { rows: number; count: number } | null;
  total: number;
  /** 範囲の外のシーズンを聞かれたなど、数えられなかったとき true（rows は空） */
  outOfRange: boolean;
  /**
   * 近くの町の事例の一覧（groupBy が "near" のときだけ。そのとき labelHeader は空、rows は空、rest は null）。
   * この項目ができる前の記録と、"near" 以外の数え方にはない
   */
  near?: NearList;
}

/** 近くの町の一覧の起点（農場の町）。関数が条件の市町村コードと、索引から引いた町の名前と、索引を渡す */
export interface NearOrigin {
  muniCode: MuniCode;
  /** 「岡山県西粟倉村」 */
  town: string;
  index: MuniCenterIndex;
}

/** 地理の索引（data/geo/muni-index.json）の 1 行のうち、町の中心に使う分。[経度, 緯度] */
export type MuniCenterIndex = Readonly<Record<MuniCode, { center: readonly [number, number] }>>;

/** 条件（町）がないときに "near" を聞かれたら返す決まった文 */
export const NEAR_NO_FARM_TEXT = "近くの町の発生は、『登録した農場の情報で相談する』を選ぶと答えられます。地図の『過去の発生』でも見られます。";

/** 一覧にあるシーズン（過去 6 シーズン）。今季は入らない */
export const STATS_FIRST_SEASON = 2020;
export const STATS_LAST_SEASON = 2025;
/** 県で分けたときに表に出す行の数。残りは「ほか N 県」 */
export const STATS_MAX_PREF_ROWS = 10;
/** 近くの町の一覧に出す行の数。残りは「ほか N 件」（地図の「過去の発生」へ案内する） */
export const STATS_MAX_NEAR_ROWS = 20;

export const STATS_SOURCE = {
  label: "農林水産省 高病原性鳥インフルエンザの国内発生事例一覧（過去 6 シーズン、関連農場を除く）",
  url: "https://www.maff.go.jp/j/syouan/douei/tori/",
} as const;

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const PREF_CODES = new Set(PREFS.map((p) => p.code));
/** シーズンの並びの月（データで探すと同じ。6 月から 5 月） */
const SEASON_MONTHS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5] as const;
const USE_BUCKETS = ["採卵鶏", "肉用鶏", "あひる", "その他"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Claude の返事の stats を確かめる。形が違う・知らない県のコード・整数でないシーズンは null（件数の表を出さない）。 */
export function parseStatsQuery(raw: unknown): StatsQuery | null {
  if (!isRecord(raw)) return null;
  const { groupBy, season, prefCode } = raw;
  if (typeof groupBy !== "string" || !STATS_GROUP_BYS.includes(groupBy as StatsGroupBy)) return null;
  if (season !== null && season !== undefined && !(typeof season === "number" && Number.isInteger(season))) return null;
  if (prefCode !== null && prefCode !== undefined && !(typeof prefCode === "string" && PREF_CODES.has(prefCode))) return null;
  // 近くの町は県で絞らない（農場の町の周りは県をまたぐ）。Claude が県を入れても null に直す
  if (groupBy === "near") return { groupBy, season: (season as number | null | undefined) ?? null, prefCode: null };
  return { groupBy: groupBy as StatsGroupBy, season: (season as number | null | undefined) ?? null, prefCode: (prefCode as string | null | undefined) ?? null };
}

/** 「2024 年 6 月〜2025 年 5 月」（データで探すと同じ書き方） */
export function seasonRangeText(s: number): string {
  return `${s} 年 6 月〜${s + 1} 年 5 月`;
}

/** 飼っている鳥の元の表記を 4 つにまとめる（データで探すと同じ）。記載なしは null */
export function useBucketOf(birdUse: string | null): (typeof USE_BUCKETS)[number] | null {
  if (birdUse === null) return null;
  if (birdUse.includes("採卵")) return "採卵鶏";
  if (birdUse.includes("肉用")) return "肉用鶏";
  if (birdUse.includes("あひる")) return "あひる";
  return "その他";
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

const fmt = (n: number) => n.toLocaleString("en-US");
/** 数字で始まる語の前に半角の空白を入れる（作品の書き方「過去 6 シーズン」に合わせる） */
const sp = (s: string) => (/^\d/u.test(s) ? ` ${s}` : s);

/** 範囲の外のシーズンの文（件数の表と近くの町の一覧で同じ） */
const OUT_OF_RANGE_TEXT = `この一覧で数えられるのは、${STATS_FIRST_SEASON} 年 6 月から ${STATS_LAST_SEASON + 1} 年 5 月までの 6 シーズンです。今季の発生は、地図で見てください。`;

/** 範囲のシーズンの、関連農場を除いた事例（件数の表と近くの町の一覧で同じ数え方） */
function countableCases(history: readonly HistoryCase[], season: number | null): HistoryCase[] {
  // 一覧に後からシーズンが足されても、合計と行と「過去 6 シーズン」の文が食い違わないよう、範囲のシーズンだけを数える
  return history.filter(
    (h) => !h.related && h.season >= STATS_FIRST_SEASON && h.season <= STATS_LAST_SEASON && (season === null || h.season === season),
  );
}

/** "2025-12-19" → 「2025年12月19日」 */
export function nearDateText(date: string): string {
  const [y, m, d] = date.split("-");
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

/** 町の中心どうしの距離の文。整数に丸める。同じ町は「同じ町」、1 km 未満は「約 1 km 未満」 */
export function nearDistanceText(km: number, sameTown: boolean): string {
  if (sameTown) return "同じ町";
  return km < 1 ? "約 1 km 未満" : `約 ${Math.round(km)} km`;
}

/**
 * 農場の町の中心から約 60 km 以内の町で起きた事例の一覧（新しい順）。判定は丸める前の距離で行う。
 * origin がない（条件がない・町がない）ときは一覧を作らず決まった文。範囲の外のシーズンは件数の表と同じく地図へ案内する。
 * 索引にない町の事例は距離を測れないので一覧に入れない（同梱の索引と国の一覧は突き合わせ済みで、今は欠けがない）。
 */
function computeNear(history: readonly HistoryCase[], query: StatsQuery, origin: NearOrigin | null): ConsultStats {
  const base = { query, labelHeader: "", rows: [], rest: null };
  if (origin === null) {
    return { ...base, title: "近くの町の発生", summary: NEAR_NO_FARM_TEXT, total: 0, outOfRange: false, near: { rows: [], more: 0, noFarm: true } };
  }
  const where = `${origin.town}から約 ${DISTANCE_BAND_KM} km 以内の町の発生`;
  const title = query.season !== null ? `${where}（${seasonRangeText(query.season)}）` : `${where}（過去 6 シーズン）`;
  if (query.season !== null && (query.season < STATS_FIRST_SEASON || query.season > STATS_LAST_SEASON)) {
    return { ...base, title, summary: OUT_OF_RANGE_TEXT, total: 0, outOfRange: true, near: { rows: [], more: 0, noFarm: false } };
  }
  const from = Object.hasOwn(origin.index, origin.muniCode) ? origin.index[origin.muniCode]!.center : null;
  const hits: { h: HistoryCase; km: number }[] = [];
  if (from !== null) {
    for (const h of countableCases(history, query.season)) {
      const to = Object.hasOwn(origin.index, h.muniCode) ? origin.index[h.muniCode]!.center : null;
      if (to === null) continue;
      const km = haversineKm(from, to);
      if (isWithinDistanceBand(km)) hits.push({ h, km });
    }
  }
  // 新しい順。同じ日は国の一覧の番号の大きい順
  hits.sort((a, b) => b.h.date.localeCompare(a.h.date) || b.h.season - a.h.season || b.h.no - a.h.no);
  const rows: NearCaseRow[] = hits.map(({ h, km }) => ({
    date: nearDateText(h.date),
    place: `${PREF_NAME.get(h.prefCode) ?? ""}${h.muniNameThen}`,
    use: h.birdUse ?? "記載なし",
    headCount: h.headCount === null ? "記載なし" : `${fmt(h.headCount)} 羽`,
    distance: nearDistanceText(km, h.muniCode === origin.muniCode),
    sourceUrl: h.sourceUrl,
  }));
  const period =
    query.season !== null
      ? `${query.season} 年のシーズン（${query.season}年6月〜${query.season + 1}年5月）`
      : `過去 6 シーズン（${STATS_FIRST_SEASON}年6月〜${STATS_LAST_SEASON + 1}年5月）`;
  const lead = `${origin.town}の中心から約 ${DISTANCE_BAND_KM} km 以内の町で、${period}に起きた発生は`;
  // 表の上の文の件数は全体の件数。表は先頭 STATS_MAX_NEAR_ROWS 件まで
  const summary = rows.length > 0 ? `${lead} ${fmt(rows.length)} 件です。距離は町の中心どうしの目安です。` : `${lead}ありませんでした。`;
  const shown = rows.slice(0, STATS_MAX_NEAR_ROWS);
  return { ...base, title, summary, total: rows.length, outOfRange: false, near: { rows: shown, more: rows.length - shown.length, noFarm: false } };
}

/**
 * 件数を数えて表にする。県を指定して「県で分ける」と聞かれたら、その県をシーズンで分ける（1 行の表にしない）。
 * 範囲の外のシーズンは数えず、outOfRange: true（今季の発生は地図で見てもらう）。
 * "near" は件数の表ではなく、origin（農場の町）の近くの町の事例の一覧（computeNear）。
 */
export function computeStats(history: readonly HistoryCase[], q: StatsQuery, origin: NearOrigin | null = null): ConsultStats {
  if (q.groupBy === "near") return computeNear(history, q, origin);
  const query: StatsQuery = q.prefCode !== null && q.groupBy === "pref" ? { ...q, groupBy: "season" } : q;
  const place = query.prefCode !== null ? (PREF_NAME.get(query.prefCode) ?? query.prefCode) : "全国";
  const period =
    query.season !== null ? `${seasonRangeText(query.season)}のシーズン` : `過去 6 シーズン（${STATS_FIRST_SEASON} 年 6 月〜${STATS_LAST_SEASON + 1} 年 5 月）`;
  const groupBy = query.groupBy as Exclude<StatsGroupBy, "near">;
  const byWhat = { pref: "都道府県ごと", season: "シーズンごと", month: "月ごと", use: "飼っている鳥ごと" }[groupBy];
  const labelHeader = { pref: "都道府県", season: "シーズン", month: "月", use: "飼っている鳥" }[groupBy];
  // 表だけを見ても期間が分かるよう、シーズンを絞ったときは題にも入れる
  const title = query.season !== null ? `${place}の発生（${seasonRangeText(query.season)}・${byWhat}）` : `${place}の発生（${byWhat}）`;

  if (query.season !== null && (query.season < STATS_FIRST_SEASON || query.season > STATS_LAST_SEASON)) {
    return {
      query,
      title,
      summary: OUT_OF_RANGE_TEXT,
      labelHeader,
      rows: [],
      rest: null,
      total: 0,
      outOfRange: true,
    };
  }

  const cases = countableCases(history, query.season).filter((h) => query.prefCode === null || h.prefCode === query.prefCode);
  let rows: StatsRow[];
  let rest: ConsultStats["rest"] = null;
  switch (groupBy) {
    case "pref": {
      const counts = new Map<string, number>();
      for (const h of cases) counts.set(h.prefCode, (counts.get(h.prefCode) ?? 0) + 1);
      const all = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, count]) => ({ label: PREF_NAME.get(code) ?? code, count }));
      rows = all.slice(0, STATS_MAX_PREF_ROWS);
      // 境目で同じ件数の県が割れるときは、その件数の県をまとめて「ほか」に入れる（コード順だけで出る県と隠れる県を分けない）。
      // それで 1 行も残らないなら全部出す
      const boundary = all[STATS_MAX_PREF_ROWS];
      if (boundary && rows.at(-1)?.count === boundary.count) {
        const kept = rows.filter((r) => r.count > boundary.count);
        rows = kept.length > 0 ? kept : all;
      }
      const hidden = all.slice(rows.length);
      if (hidden.length > 0) rest = { rows: hidden.length, count: hidden.reduce((s, r) => s + r.count, 0) };
      break;
    }
    case "season": {
      const seasons = query.season !== null ? [query.season] : Array.from({ length: STATS_LAST_SEASON - STATS_FIRST_SEASON + 1 }, (_, i) => STATS_FIRST_SEASON + i);
      rows = seasons.map((s) => ({ label: seasonRangeText(s), count: cases.filter((h) => h.season === s).length }));
      break;
    }
    case "month": {
      // 日付の記載がない事例は入れない。12 か月を 0 件も含めて出す（データで探すと同じ）
      const counts = new Map<number, number>();
      for (const h of cases) if (h.date) counts.set(monthOf(h.date), (counts.get(monthOf(h.date)) ?? 0) + 1);
      rows = SEASON_MONTHS.map((m) => ({ label: `${m} 月`, count: counts.get(m) ?? 0 }));
      break;
    }
    case "use": {
      rows = USE_BUCKETS.map((b) => ({ label: b, count: cases.filter((h) => useBucketOf(h.birdUse) === b).length }));
      const unknown = cases.filter((h) => useBucketOf(h.birdUse) === null).length;
      if (unknown > 0) rows.push({ label: "記載なし", count: unknown });
      break;
    }
  }
  const total = cases.length;
  let summary = `${place}の${sp(period)}の発生は ${fmt(total)} 件です。`;
  // 「いちばん多い」は、2 件以上で、ほかの行にも分かれていて、同じ件数の行がなく、「記載なし」でないときだけ（1 件や全件を強調しない）
  const top = [...rows].sort((a, b) => b.count - a.count)[0];
  if (top && top.count >= 2 && top.count < total && top.label !== "記載なし" && rows.filter((r) => r.count === top.count).length === 1) {
    summary += `いちばん多いのは${sp(top.label)}の ${fmt(top.count)} 件です。`;
  }
  return { query, title, summary, labelHeader, rows, rest, total, outOfRange: false };
}
