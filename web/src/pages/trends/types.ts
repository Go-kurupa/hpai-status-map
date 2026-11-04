// 全国の傾向（X-27、設計書 §2、§4 の C、§7）の公開する集計の形。scripts/lib/trends.ts（集計を作る側）と画面が同じ表を使う。
// React や import.meta.env に触れない（scripts からも読む）。
//
// 市町村、県、事例の番号、事例ごとの PDF の URL、原文の引用は持たない（事例や市町村と結びつけない【決定】）。
import type { IsoDateTime, Season } from "@hpai/shared/types";

export const TREND_KEYS = ["external_clothing", "rodent_signs", "wall_net_damage"] as const;
export type TrendKey = (typeof TREND_KEYS)[number];

/** 言い方は国の疫学調査報告書のまま（設計書 §7「国の報告書で多かった不備」） */
export const TREND_LABELS: Readonly<Record<TrendKey, string>> = Object.freeze({
  external_clothing: "外部事業者の専用の衣服や靴",
  rodent_signs: "ねずみの痕跡",
  wall_net_damage: "壁やネットの破損",
});

export interface TrendItem {
  key: TrendKey;
  label: string;
  /** 概要に、不備や痕跡があったと書かれていた事例の数 */
  issueCount: number;
  /** 概要がこの項目に触れていなかった事例の数 */
  notMentionedCount: number;
}

export interface TrendSeason {
  season: Season;
  /** 読めた現地調査の概要の数（読めなかったものは数えない） */
  surveyed: number;
  items: TrendItem[];
}

export interface TrendSummary {
  generatedAt: IsoDateTime;
  seasons: TrendSeason[];
  /** 各シーズンの国の発生状況のページ（事例ごとの PDF は出さない） */
  sourceUrls: string[];
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const hasOnly = (o: object, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);

function parseItem(v: unknown): TrendItem | null {
  if (!v || typeof v !== "object" || !hasOnly(v, ["key", "label", "issueCount", "notMentionedCount"])) return null;
  const o = v as Record<string, unknown>;
  if (!TREND_KEYS.includes(o.key as TrendKey) || o.label !== TREND_LABELS[o.key as TrendKey]) return null;
  if (!isCount(o.issueCount) || !isCount(o.notMentionedCount)) return null;
  return { key: o.key as TrendKey, label: o.label as string, issueCount: o.issueCount, notMentionedCount: o.notMentionedCount };
}

function parseSeason(v: unknown): TrendSeason | null {
  if (!v || typeof v !== "object" || !hasOnly(v, ["season", "surveyed", "items"])) return null;
  const o = v as Record<string, unknown>;
  if (!Number.isInteger(o.season) || !isCount(o.surveyed) || !Array.isArray(o.items)) return null;
  const items = o.items.map(parseItem);
  if (items.some((i) => i === null)) return null;
  const surveyed = o.surveyed;
  if ((items as TrendItem[]).some((i) => i.issueCount + i.notMentionedCount > surveyed)) return null;
  return { season: o.season as number, surveyed, items: items as TrendItem[] };
}

/** 形が違えば null（知らないキーがあるものも拒む: 市町村や事例の手がかりを画面に出さない） */
export function parseTrendSummary(v: unknown): TrendSummary | null {
  if (!v || typeof v !== "object" || !hasOnly(v, ["generatedAt", "seasons", "sourceUrls"])) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.generatedAt !== "string" || !Array.isArray(o.seasons) || !Array.isArray(o.sourceUrls)) return null;
  if (!o.sourceUrls.every((u) => typeof u === "string")) return null;
  const seasons = o.seasons.map(parseSeason);
  if (seasons.some((s) => s === null)) return null;
  return { generatedAt: o.generatedAt, seasons: seasons as TrendSeason[], sourceUrls: o.sourceUrls as string[] };
}
