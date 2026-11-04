// 渡り鳥の飛来（季節の参考）の公開する集計の形。scripts/lib/migration.ts（集計を作る側）と画面が同じ表を使う。
// React や import.meta.env に触れない（scripts からも読む）。
//
// 農場の危険度や警報ではない。環境省「渡り鳥の飛来状況」の水鳥の数を、同じ地点の過去の同じ時期と並べただけで、
// 「多い」「少ない」の判定、感染の情報、予測は持たない。知らないキーがあるものは画面に出さない。
import type { IsoDate, IsoDateTime } from "@hpai/shared/types";

/** 過去のシーズンの 1 回分（その地点の、今季の最新の調査日に最も近い調査日の水鳥の合計） */
export interface MigrationPastCount {
  /** 秋に始まる年（2025 は 2025 年秋期〜2026 年春期） */
  season: number;
  /** その回の調査日 */
  date: IsoDate;
  total: number;
}

export interface MigrationBaseline {
  /** 比べられた過去のシーズンの数 */
  n: number;
  median: number;
  min: number;
  max: number;
  seasons: MigrationPastCount[];
}

export interface MigrationSite {
  id: number;
  name: string;
  /** 今季の最新の調査日（数が記録された回のうち最も新しい日） */
  latestDate: IsoDate;
  /** その回の水鳥（ガン・ハクチョウ・カモ類）の合計。羽 */
  latestTotal: number;
  /** この地点のファイルを取得した日 */
  fetchedAt: IsoDate;
  /** 今季のファイルで「報告未着」とある回の数（その地点の最新の調査日が他より古い理由になる） */
  unreported: number;
  /** 過去の同じ時期と比べられなければ null（比べられた過去のシーズンが少なすぎる） */
  baseline: MigrationBaseline | null;
}

export interface MigrationArrivalPast {
  season: number;
  /** しきい値以上を初めて記録した調査日。そのシーズンに超えなければ null */
  date: IsoDate | null;
  /** そのシーズンの最初の調査の回で既に超えていた（実際はもっと早い可能性がある） */
  atFirstSurvey: boolean;
}

export interface MigrationArrival {
  siteId: number;
  siteName: string;
  /** 種名（環境省のファイルの表記から亜種と優先度の印を除いたもの） */
  species: string;
  /** 1 回の調査でこの羽数以上 */
  threshold: number;
  /** 今季しきい値以上を初めて記録した調査日。まだなら null */
  currentDate: IsoDate | null;
  /** 今季の最新の調査日（まだ超えていないときの「ここまで」） */
  latestSurveyDate: IsoDate;
  past: MigrationArrivalPast[];
}

export interface MigrationSummary {
  generatedAt: IsoDateTime;
  /** 今季（2026 は 2026 年秋期） */
  currentSeason: number;
  /** 比べた過去のシーズン */
  baselineSeasons: number[];
  /** 環境省の「渡り鳥の飛来状況」の入口のページ */
  sourceUrl: string;
  sites: MigrationSite[];
  arrivals: MigrationArrival[];
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasOnly = (o: object, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);

function parsePast(v: unknown): MigrationPastCount | null {
  if (!isObj(v) || !hasOnly(v, ["season", "date", "total"])) return null;
  if (!isCount(v.season) || !isDate(v.date) || !isCount(v.total)) return null;
  return { season: v.season, date: v.date, total: v.total };
}

function parseBaseline(v: unknown): MigrationBaseline | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !hasOnly(v, ["n", "median", "min", "max", "seasons"]) || !Array.isArray(v.seasons)) return undefined;
  if (!isCount(v.n) || !isCount(v.median) || !isCount(v.min) || !isCount(v.max)) return undefined;
  const seasons = v.seasons.map(parsePast);
  if (seasons.some((s) => s === null) || seasons.length !== v.n || v.n === 0) return undefined;
  if (v.min > v.median || v.median > v.max) return undefined;
  return { n: v.n, median: v.median, min: v.min, max: v.max, seasons: seasons as MigrationPastCount[] };
}

function parseSite(v: unknown): MigrationSite | null {
  if (!isObj(v) || !hasOnly(v, ["id", "name", "latestDate", "latestTotal", "fetchedAt", "unreported", "baseline"])) return null;
  if (!isCount(v.id) || typeof v.name !== "string" || v.name === "" || !isDate(v.latestDate) || !isCount(v.latestTotal) || !isDate(v.fetchedAt) || !isCount(v.unreported)) return null;
  const baseline = parseBaseline(v.baseline);
  if (baseline === undefined) return null;
  return { id: v.id, name: v.name, latestDate: v.latestDate, latestTotal: v.latestTotal, fetchedAt: v.fetchedAt, unreported: v.unreported, baseline };
}

function parseArrivalPast(v: unknown): MigrationArrivalPast | null {
  if (!isObj(v) || !hasOnly(v, ["season", "date", "atFirstSurvey"])) return null;
  if (!isCount(v.season) || (v.date !== null && !isDate(v.date)) || typeof v.atFirstSurvey !== "boolean") return null;
  return { season: v.season, date: v.date as string | null, atFirstSurvey: v.atFirstSurvey };
}

function parseArrival(v: unknown): MigrationArrival | null {
  if (!isObj(v) || !hasOnly(v, ["siteId", "siteName", "species", "threshold", "currentDate", "latestSurveyDate", "past"])) return null;
  if (!isCount(v.siteId) || typeof v.siteName !== "string" || typeof v.species !== "string" || !isCount(v.threshold) || v.threshold === 0) return null;
  if ((v.currentDate !== null && !isDate(v.currentDate)) || !isDate(v.latestSurveyDate) || !Array.isArray(v.past)) return null;
  const past = v.past.map(parseArrivalPast);
  if (past.some((p) => p === null)) return null;
  return {
    siteId: v.siteId,
    siteName: v.siteName,
    species: v.species,
    threshold: v.threshold,
    currentDate: v.currentDate as string | null,
    latestSurveyDate: v.latestSurveyDate,
    past: past as MigrationArrivalPast[],
  };
}

/** 形が違えば null（知らないキーがあるものも拒む: 農場や感染の手がかりを画面に出さない） */
export function parseMigrationSummary(v: unknown): MigrationSummary | null {
  if (!isObj(v) || !hasOnly(v, ["generatedAt", "currentSeason", "baselineSeasons", "sourceUrl", "sites", "arrivals"])) return null;
  if (typeof v.generatedAt !== "string" || !isCount(v.currentSeason) || typeof v.sourceUrl !== "string") return null;
  if (!Array.isArray(v.baselineSeasons) || !v.baselineSeasons.every(isCount)) return null;
  if (!Array.isArray(v.sites) || !Array.isArray(v.arrivals)) return null;
  const sites = v.sites.map(parseSite);
  const arrivals = v.arrivals.map(parseArrival);
  if (sites.some((s) => s === null) || arrivals.some((a) => a === null)) return null;
  return {
    generatedAt: v.generatedAt,
    currentSeason: v.currentSeason,
    baselineSeasons: v.baselineSeasons as number[],
    sourceUrl: v.sourceUrl,
    sites: sites as MigrationSite[],
    arrivals: arrivals as MigrationArrival[],
  };
}
