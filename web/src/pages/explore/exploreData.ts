// 「条件で見る」の数え方（設計書 2026-11-06-data-explore E2〜E6）。用途・羽数・地方で事例を絞る。
// 件数は今の画面と同じ数え方: 過去は関連農場を除き、今季は数える事例（否定・確認中を除く）だけ。
import { isCountable } from "@hpai/shared/level";
import { caseDate } from "@hpai/shared/overview";
import { PREFS } from "@hpai/shared/pref";
import type { Case, HistoryCase, MuniCode, PrefCode, Season } from "@hpai/shared/types";
import { regionOf, type RegionId } from "../../geo/regions";

export type UseBucket = "採卵鶏" | "肉用鶏" | "あひる" | "その他";
export type HeadBand = "1,000 羽未満" | "1,000〜1 万" | "1 万〜10 万" | "10 万以上";

export const USE_BUCKETS: readonly UseBucket[] = ["採卵鶏", "肉用鶏", "あひる", "その他"];
export const HEAD_BANDS: readonly HeadBand[] = ["1,000 羽未満", "1,000〜1 万", "1 万〜10 万", "10 万以上"];

/** 元の表記を 4 つにまとめる（E5）。「採卵」「肉用」「あひる」を含むかで分け、ほかはその他。記載なしは null */
export function useBucket(birdUse: string | null): UseBucket | null {
  if (birdUse === null) return null;
  if (birdUse.includes("採卵")) return "採卵鶏";
  if (birdUse.includes("肉用")) return "肉用鶏";
  if (birdUse.includes("あひる")) return "あひる";
  return "その他";
}

export function headBand(headCount: number | null): HeadBand | null {
  if (headCount === null) return null;
  if (headCount < 1000) return "1,000 羽未満";
  if (headCount < 10000) return "1,000〜1 万";
  if (headCount < 100000) return "1 万〜10 万";
  return "10 万以上";
}

export interface ExploreRow {
  key: string;
  season: Season;
  current: boolean;
  date: string | null;
  prefCode: PrefCode;
  muniCode: MuniCode | null;
  /** 「岡山県 津山市」。町が分からない今季の発表は県名だけ */
  place: string;
  birdUse: string | null;
  headCount: number | null;
  url: string | null;
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

export function exploreRows(p: { history: readonly HistoryCase[]; currentCases: readonly Case[] | null; current: Season }): ExploreRow[] {
  const pref = (c: PrefCode) => PREF_NAME.get(c) ?? c;
  const past = p.history
    .filter((h) => !h.related)
    .map<ExploreRow>((h) => ({
      key: `${h.season}-${h.no}`,
      season: h.season,
      current: false,
      date: h.date,
      prefCode: h.prefCode,
      muniCode: h.muniCode,
      place: `${pref(h.prefCode)} ${h.muniNameThen}`,
      birdUse: h.birdUse,
      headCount: h.headCount,
      url: h.sourceUrl,
    }));
  const now = (p.currentCases ?? [])
    .filter((c) => c.season === p.current && isCountable(c))
    .map<ExploreRow>((c) => ({
      key: c.id,
      season: c.season,
      current: true,
      date: caseDate(c),
      prefCode: c.prefCode,
      muniCode: c.muniCode,
      place: c.muniName ? `${pref(c.prefCode)} ${c.muniName}` : pref(c.prefCode),
      birdUse: c.birdUse,
      headCount: c.headCount,
      url: c.sourceUrls[0] ?? null,
    }));
  return [...past, ...now];
}

/**
 * 各段は複数選べる（作者 11/6 夜）。空の配列は「すべて」「全国」。複数のときは、どれかに当てはまれば入る。
 * month は月の行で選ぶ 4 つ目の条件（E4b。1〜12、null はすべて）
 */
export interface ExploreFilter {
  use: readonly UseBucket[];
  band: readonly HeadBand[];
  region: readonly RegionId[];
  month: number | null;
}

/** 日付の月（1〜12）。日付の記載がなければ null */
export function monthOf(date: string | null): number | null {
  return date === null ? null : Number(date.slice(5, 7));
}

/**
 * 条件に当てはまる事例。用途・羽数・月で絞ったとき、今季の事例でその項目が記載なしのものは数に入れず、数だけ返す（E6。黙って落とさない）。
 * 過去の国の事例一覧は全件に用途・羽数・日付がある前提だが、なければ同じく数に入れない（数えるのは今季だけ）
 */
export function filterRows(
  rows: readonly ExploreRow[],
  f: ExploreFilter,
): { hits: ExploreRow[]; missingUse: number; missingBand: number; missingDate: number } {
  let missingUse = 0;
  let missingBand = 0;
  let missingDate = 0;
  const hits = rows.filter((r) => {
    if (f.region.length > 0 && !f.region.includes(regionOf(r.prefCode))) return false;
    const u = useBucket(r.birdUse);
    const b = headBand(r.headCount);
    const m = monthOf(r.date);
    if (f.use.length > 0 && u === null) {
      if (r.current) missingUse++;
      return false;
    }
    if (f.band.length > 0 && b === null) {
      if (r.current) missingBand++;
      return false;
    }
    if (f.month !== null && m === null) {
      if (r.current) missingDate++;
      return false;
    }
    return (f.use.length === 0 || f.use.includes(u!)) && (f.band.length === 0 || f.band.includes(b!)) && (f.month === null || f.month === m);
  });
  return { hits, missingUse, missingBand, missingDate };
}

/**
 * ボタンに添える件数（E4b）。その段の条件を外し、ほかの段と月の条件で絞って、ボタンごとに数える。
 * 選んでもその段のほかのボタンが 0 にならない。「すべて」（「全国」）の数はキー "all"
 */
export function chipCounts(rows: readonly ExploreRow[], f: ExploreFilter, dim: "use" | "band" | "region"): Map<string, number> {
  const base = filterRows(rows, { ...f, [dim]: [] }).hits;
  const out = new Map<string, number>([["all", base.length]]);
  for (const r of base) {
    const k = dim === "use" ? useBucket(r.birdUse) : dim === "band" ? headBand(r.headCount) : regionOf(r.prefCode);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** シーズンの並びの月（6 月から 5 月） */
export const SEASON_MONTHS: readonly number[] = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];

/** 月ごとの件数（E4b）。6 月〜5 月の 12 か月を必ず返す。日付の記載がない事例は undated に数える */
export function countByMonth(hits: readonly ExploreRow[]): { months: Array<{ month: number; count: number }>; undated: number } {
  const by = new Map<number, number>();
  let undated = 0;
  for (const r of hits) {
    const m = monthOf(r.date);
    if (m === null) undated++;
    else by.set(m, (by.get(m) ?? 0) + 1);
  }
  return { months: SEASON_MONTHS.map((month) => ({ month, count: by.get(month) ?? 0 })), undated };
}

/** シーズン × 月の件数（E4b）。キーは `${season}-${month}`。日付の記載がない事例は入れない */
export function countBySeasonMonth(hits: readonly ExploreRow[], seasons: readonly Season[]): Map<string, number> {
  const want = new Set<number>(seasons);
  const out = new Map<string, number>();
  for (const r of hits) {
    const m = monthOf(r.date);
    if (m === null || !want.has(r.season)) continue;
    const k = `${r.season}-${m}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export function countBySeason(hits: readonly ExploreRow[], seasons: readonly Season[]): Array<{ season: Season; count: number }> {
  return seasons.map((season) => ({ season, count: hits.filter((r) => r.season === season).length }));
}
