// AIに対策を相談: 発生の件数の問い（2026-11-07 作者の決定「A: AI と数えた表」）。
// Claude は問いを「何で分けて数えるか（groupBy）・どのシーズンか・どの県か」に読み替えるだけ。件数はこのファイルのプログラムが
// 過去の事例（data/history/cases.json、農林水産省の国内発生事例一覧の過去 6 シーズン）から数える。表の文もプログラムが組む（Claude は書かない）。
// 数え方は作品のほかの画面（データで探す）と同じ: 関連農場（related:true）は数えない。シーズンは 6 月 1 日から翌年 5 月 31 日。
import { PREFS } from "../pref";
import type { HistoryCase, PrefCode } from "../types";

export type StatsGroupBy = "pref" | "season" | "month" | "use";
export const STATS_GROUP_BYS: readonly StatsGroupBy[] = ["pref", "season", "month", "use"];

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
}

/** 一覧にあるシーズン（過去 6 シーズン）。今季は入らない */
export const STATS_FIRST_SEASON = 2020;
export const STATS_LAST_SEASON = 2025;
/** 県で分けたときに表に出す行の数。残りは「ほか N 県」 */
export const STATS_MAX_PREF_ROWS = 10;

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

/**
 * 件数を数えて表にする。県を指定して「県で分ける」と聞かれたら、その県をシーズンで分ける（1 行の表にしない）。
 * 範囲の外のシーズンは数えず、outOfRange: true（今季の発生は地図で見てもらう）。
 */
export function computeStats(history: readonly HistoryCase[], q: StatsQuery): ConsultStats {
  const query: StatsQuery = q.prefCode !== null && q.groupBy === "pref" ? { ...q, groupBy: "season" } : q;
  const place = query.prefCode !== null ? (PREF_NAME.get(query.prefCode) ?? query.prefCode) : "全国";
  const period =
    query.season !== null ? `${seasonRangeText(query.season)}のシーズン` : `過去 6 シーズン（${STATS_FIRST_SEASON} 年 6 月〜${STATS_LAST_SEASON + 1} 年 5 月）`;
  const byWhat = { pref: "都道府県ごと", season: "シーズンごと", month: "月ごと", use: "飼っている鳥ごと" }[query.groupBy];
  const labelHeader = { pref: "都道府県", season: "シーズン", month: "月", use: "飼っている鳥" }[query.groupBy];
  // 表だけを見ても期間が分かるよう、シーズンを絞ったときは題にも入れる
  const title = query.season !== null ? `${place}の発生（${seasonRangeText(query.season)}・${byWhat}）` : `${place}の発生（${byWhat}）`;

  if (query.season !== null && (query.season < STATS_FIRST_SEASON || query.season > STATS_LAST_SEASON)) {
    return {
      query,
      title,
      summary: `この一覧で数えられるのは、${STATS_FIRST_SEASON} 年 6 月から ${STATS_LAST_SEASON + 1} 年 5 月までの 6 シーズンです。今季の発生は、地図で見てください。`,
      labelHeader,
      rows: [],
      rest: null,
      total: 0,
      outOfRange: true,
    };
  }

  // 一覧に後からシーズンが足されても、合計と行と「過去 6 シーズン」の文が食い違わないよう、範囲のシーズンだけを数える
  const cases = history.filter(
    (h) =>
      !h.related &&
      h.season >= STATS_FIRST_SEASON &&
      h.season <= STATS_LAST_SEASON &&
      (query.season === null || h.season === query.season) &&
      (query.prefCode === null || h.prefCode === query.prefCode),
  );
  let rows: StatsRow[];
  let rest: ConsultStats["rest"] = null;
  switch (query.groupBy) {
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
