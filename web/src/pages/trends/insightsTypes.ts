// 発生傾向（/trends）の深掘りの集計の形（設計書 2026-11-06-trends-redesign §5）。scripts/lib/trends-insights.ts（作る側）と画面が同じ表を使う。
// React や import.meta.env に触れない（scripts からも読む）。
//
// 今の summary.json とは別のファイル（/trends/insights.json）。このファイルが無いときは、画面は今の表示に戻る。
// 市町村、県、例目、事例ごとの PDF、根拠の文は持たない。持つ文は国の報告書の結論の文だけ。
import type { IsoDateTime } from "@hpai/shared/types";
import { TREND_KEYS, type TrendKey } from "./types";

export interface InsightCounts {
  key: TrendKey;
  /** あったと書かれていた */
  issue: number;
  /** なかったと書かれていた */
  noIssue: number;
  /** 触れていなかった */
  notMentioned: number;
}

export interface InsightSeason {
  season: number;
  surveyed: number;
  items: InsightCounts[];
}

/** 根拠の 1 文に出てきた語の数（「あった」の事例だけ。1 文が複数の語に入る） */
export interface InsightPhrases {
  key: TrendKey;
  /** 「あった」の事例の数（語の数の母数） */
  base: number;
  words: { label: string; count: number }[];
  /** どの語にも当たらなかった数 */
  unmatched: number;
}

/** 伏せた欄（4 件以下、または引き算で戻せるため） */
export interface Suppressed {
  suppressed: true;
}
export type GroupCount = number | Suppressed;

export interface InsightGroupRow {
  label: string;
  /** その群の読めた概要の数 */
  total: number;
  /** 項目ごとの「あった」の数 */
  issue: Record<TrendKey, GroupCount>;
}

export interface InsightGroups {
  dimension: "housing" | "use";
  rows: InsightGroupRow[];
}

export interface ReportQuote {
  /** 報告書が対象とするシーズン（秋に始まる年） */
  season: number;
  about: TrendKey | "general";
  /** 報告書の原文（脚注の番号だけ除く） */
  text: string;
  reportTitle: string;
  reportUrl: string;
}

/** 段階 2 の追加の抽出（設計書 §4.4）。6 シーズン合計だけ。根拠の文を確かめられなかった分は数えない */
export const NOTICING_FIELD_KEYS = ["first_sign", "other_disease_suspected", "waterside_1km", "waterfowl_seen", "staff_hygiene"] as const;
export interface NoticingField {
  key: (typeof NOTICING_FIELD_KEYS)[number];
  label: string;
  /** 値ごとの件数（「記載なし」を含む）。並びは画面に出す順 */
  values: { key: string; label: string; count: number }[];
  /** 値は付いたが、根拠の文を原文で確かめられず数えなかった件数 */
  unverified: number;
}
export interface InsightNoticing {
  /** 読めた概要の数 */
  read: number;
  fields: NoticingField[];
}

export interface TrendInsights {
  generatedAt: IsoDateTime;
  /** 6 シーズン合計 */
  total: InsightSeason;
  seasons: InsightSeason[];
  phrases: InsightPhrases[];
  /** ねずみの根拠の文の出どころ */
  rodentSource: { survey: number; interview: number; unclear: number };
  groups: InsightGroups[];
  reportQuotes: ReportQuote[];
  /** 段階 2 の抽出がまだなら無い */
  noticing?: InsightNoticing;
}

export const isSuppressed = (v: GroupCount): v is Suppressed => typeof v === "object";

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasOnly = (o: object, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const isKey = (v: unknown): v is TrendKey => TREND_KEYS.includes(v as TrendKey);

function parseCounts(v: unknown, surveyed: number): InsightCounts | null {
  if (!isObj(v) || !hasOnly(v, ["key", "issue", "noIssue", "notMentioned"])) return null;
  if (!isKey(v.key) || !isCount(v.issue) || !isCount(v.noIssue) || !isCount(v.notMentioned)) return null;
  if (v.issue + v.noIssue + v.notMentioned !== surveyed) return null;
  return { key: v.key, issue: v.issue, noIssue: v.noIssue, notMentioned: v.notMentioned };
}

function parseSeason(v: unknown): InsightSeason | null {
  if (!isObj(v) || !hasOnly(v, ["season", "surveyed", "items"])) return null;
  if (!Number.isInteger(v.season) || !isCount(v.surveyed) || !Array.isArray(v.items)) return null;
  const surveyed = v.surveyed;
  const items = v.items.map((i) => parseCounts(i, surveyed));
  if (items.some((i) => i === null) || items.length !== TREND_KEYS.length) return null;
  return { season: v.season as number, surveyed, items: items as InsightCounts[] };
}

function parsePhrases(v: unknown): InsightPhrases | null {
  if (!isObj(v) || !hasOnly(v, ["key", "base", "words", "unmatched"])) return null;
  if (!isKey(v.key) || !isCount(v.base) || !isCount(v.unmatched) || !Array.isArray(v.words)) return null;
  const words = v.words.map((w) => (isObj(w) && hasOnly(w, ["label", "count"]) && typeof w.label === "string" && isCount(w.count) && w.count <= (v.base as number) ? { label: w.label, count: w.count } : null));
  if (words.some((w) => w === null)) return null;
  return { key: v.key, base: v.base, words: words as InsightPhrases["words"], unmatched: v.unmatched };
}

function parseGroupCount(v: unknown, total: number): GroupCount | null {
  if (isCount(v)) return v <= total ? v : null;
  if (isObj(v) && hasOnly(v, ["suppressed"]) && v.suppressed === true) return { suppressed: true };
  return null;
}

function parseGroups(v: unknown): InsightGroups | null {
  if (!isObj(v) || !hasOnly(v, ["dimension", "rows"]) || (v.dimension !== "housing" && v.dimension !== "use") || !Array.isArray(v.rows)) return null;
  const rows: InsightGroupRow[] = [];
  for (const r of v.rows) {
    if (!isObj(r) || !hasOnly(r, ["label", "total", "issue"]) || typeof r.label !== "string" || !isCount(r.total) || !isObj(r.issue) || !hasOnly(r.issue, TREND_KEYS)) return null;
    const issue = {} as Record<TrendKey, GroupCount>;
    for (const k of TREND_KEYS) {
      const c = parseGroupCount(r.issue[k], r.total);
      if (c === null) return null;
      issue[k] = c;
    }
    rows.push({ label: r.label, total: r.total, issue });
  }
  return { dimension: v.dimension, rows };
}

function parseQuote(v: unknown): ReportQuote | null {
  if (!isObj(v) || !hasOnly(v, ["season", "about", "text", "reportTitle", "reportUrl"])) return null;
  if (!Number.isInteger(v.season) || !(v.about === "general" || isKey(v.about))) return null;
  if (typeof v.text !== "string" || typeof v.reportTitle !== "string" || typeof v.reportUrl !== "string" || !v.reportUrl.startsWith("https://www.maff.go.jp/")) return null;
  return { season: v.season as number, about: v.about as ReportQuote["about"], text: v.text, reportTitle: v.reportTitle, reportUrl: v.reportUrl };
}

function parseNoticing(v: unknown): InsightNoticing | null {
  if (!isObj(v) || !hasOnly(v, ["read", "fields"]) || !isCount(v.read) || !Array.isArray(v.fields)) return null;
  const read = v.read;
  const fields: NoticingField[] = [];
  for (const f of v.fields) {
    if (!isObj(f) || !hasOnly(f, ["key", "label", "values", "unverified"]) || !NOTICING_FIELD_KEYS.includes(f.key as NoticingField["key"])) return null;
    if (typeof f.label !== "string" || !isCount(f.unverified) || !Array.isArray(f.values)) return null;
    const values = f.values.map((x) => (isObj(x) && hasOnly(x, ["key", "label", "count"]) && typeof x.key === "string" && typeof x.label === "string" && isCount(x.count) ? { key: x.key, label: x.label, count: x.count } : null));
    if (values.some((x) => x === null)) return null;
    const vs = values as NoticingField["values"];
    if (vs.reduce((n, x) => n + x.count, 0) + f.unverified !== read) return null;
    fields.push({ key: f.key as NoticingField["key"], label: f.label, values: vs, unverified: f.unverified });
  }
  return { read, fields };
}

/** 形が違えば null（知らないキーがあるものも拒む） */
export function parseTrendInsights(v: unknown): TrendInsights | null {
  const base = ["generatedAt", "total", "seasons", "phrases", "rodentSource", "groups", "reportQuotes"];
  if (!isObj(v) || !hasOnly(v, "noticing" in v ? [...base, "noticing"] : base)) return null;
  const noticing = "noticing" in v ? parseNoticing(v.noticing) : undefined;
  if (noticing === null) return null;
  if (typeof v.generatedAt !== "string") return null;
  const total = parseSeason(v.total);
  if (!total || !Array.isArray(v.seasons) || !Array.isArray(v.phrases) || !Array.isArray(v.groups) || !Array.isArray(v.reportQuotes)) return null;
  const seasons = v.seasons.map(parseSeason);
  const phrases = v.phrases.map(parsePhrases);
  const groups = v.groups.map(parseGroups);
  const quotes = v.reportQuotes.map(parseQuote);
  if ([...seasons, ...phrases, ...groups, ...quotes].some((x) => x === null)) return null;
  if ((seasons as InsightSeason[]).reduce((n, s) => n + s.surveyed, 0) !== total.surveyed) return null;
  const rs = v.rodentSource;
  if (!isObj(rs) || !hasOnly(rs, ["survey", "interview", "unclear"]) || !isCount(rs.survey) || !isCount(rs.interview) || !isCount(rs.unclear)) return null;
  return {
    generatedAt: v.generatedAt,
    total,
    seasons: seasons as InsightSeason[],
    phrases: phrases as InsightPhrases[],
    rodentSource: { survey: rs.survey, interview: rs.interview, unclear: rs.unclear },
    groups: groups as InsightGroups[],
    reportQuotes: quotes as ReportQuote[],
    ...(noticing ? { noticing } : {}),
  };
}
