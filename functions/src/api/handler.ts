// 公開 API の中身（X-12）。読み取り専用で、公開してよい事実だけを返す。Express は使わず、path で分ける。
// build* は公開 MCP（../mcp/server.ts）も呼ぶ。外へ出す形は shared/src/api.ts の許す項目だけ。
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "firebase-functions";
import {
  API_MIN_SEASON,
  baseNotices,
  DROPPED_NOTICE,
  isCaseVisible,
  toPublicCase,
  toPublicWildBird,
  watchNotice,
  watchRows,
  prefNameOf,
  type ApiArea,
  type ApiCase,
  type ApiCases,
  type ApiWatch,
  type ApiWatchRow,
  type ApiWildBirds,
  type PublicContext,
} from "@hpai/shared/api";
import { currentSeason } from "@hpai/shared/season";
import { toJstIso } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { pastCasesOf } from "@hpai/shared/history";
import { isZoneActive, summarizeWatch, computeAreaStatus } from "@hpai/shared/level";
import type { Case, HistoryCase, MuniCode, PrefCode, Season, WatchStatus, WatchSummary, WildBird } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { clientIp, type createRateLimiter } from "./rateLimit";
import { parseMuniCode, parsePref, parseSeason } from "./schema";

export interface ApiDeps {
  casesBySeason(season: Season, pref: PrefCode | null): Promise<Case[]>;
  wildBirdsBySeason(season: Season): Promise<WildBird[]>;
  watchStatuses(): Promise<WatchStatus[]>;
  history: readonly HistoryCase[];
  geo: GeoStore;
}

export interface ApiResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export { parseMuniCode, parsePref, parseSeason };

// ── 組み立て ──

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

async function loadWatch(d: ApiDeps, now: Date): Promise<{ rows: ApiWatchRow[]; summary: WatchSummary }> {
  const rows = watchRows(await d.watchStatuses(), now);
  return { rows, summary: summarizeWatch(rows, now) };
}

/** 文書から来た市町村名は、地図の索引の名前に置き換える（文書の文字列を答えに載せない）。 */
const contextOf = (d: ApiDeps): PublicContext => ({
  muniName: (code) => (Object.hasOwn(d.geo.index, code) ? (d.geo.index[code]?.name ?? null) : null),
});

const nonNull = <T>(x: T | null): x is T => x !== null;

/** 形が不正で省いた記録があれば、件数だけをログに出し（中身は出さない）、答えに一文を足す。 */
function withDropped(notices: string[], dropped: number, endpoint: string): string[] {
  if (dropped <= 0) return notices;
  logger.warn("api dropped malformed records", { endpoint, count: dropped });
  return [...notices, DROPPED_NOTICE];
}

/** その季の事例。過去の資料にあるシーズンは data/history（related:false だけ）、なければ Firestore。 */
async function casesOf(d: ApiDeps, season: Season, pref: PrefCode | null): Promise<Case[]> {
  const rows = d.history.some((h) => h.season === season) ? pastCasesOf(d.history.filter((h) => h.season === season)) : await d.casesBySeason(season, pref);
  return rows.filter((c) => c.confirmState !== "replay" && (pref === null || c.prefCode === pref));
}

/** 新しい順（確認中も更新の順）。同じなら id の降順。 */
const newestFirst = (a: Case, b: Case): number =>
  a.updatedAt !== b.updatedAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

export async function buildCases(d: ApiDeps, q: { season: Season; pref: PrefCode | null }, now: Date): Promise<ApiCases> {
  const isCurrent = q.season === currentSeason(now);
  const [all, watch] = await Promise.all([casesOf(d, q.season, q.pref), isCurrent ? loadWatch(d, now) : Promise.resolve(null)]);
  const ctx = contextOf(d);
  const shown = all.filter((c) => c.season === q.season && isCaseVisible(c, now)).sort(newestFirst);
  const data: ApiCase[] = shown.map((c) => toPublicCase(c, ctx)).filter(nonNull);
  const notices = withDropped([...baseNotices(), ...(isCurrent ? [] : [FIXED_TEXT.pastDisclaimer]), ...(watch ? [watchNotice(watch.summary)] : [])], shown.length - data.length, "cases");
  return {
    asOf: toJstIso(now),
    notices,
    sources: uniq(data.flatMap((c) => c.sourceUrls)),
    ...(watch ? { watch: watch.summary } : {}),
    data,
  };
}

/** その市町村の状態。地点がないので距離を見ない。知らない市町村コード（政令市の区など）は null。 */
export async function buildArea(d: ApiDeps, muniCode: MuniCode, now: Date): Promise<ApiArea | null> {
  if (parseMuniCode(muniCode) === null || !Object.hasOwn(d.geo.index, muniCode)) return null;
  const season = currentSeason(now);
  const [allCases, allBirds, watch] = await Promise.all([casesOf(d, season, null), d.wildBirdsBySeason(season), loadWatch(d, now)]);
  const ctx = contextOf(d);
  // 公開できない記録（replay、不正な値）は、段階の計算にも入れない。
  const cases = allCases.filter((c) => toPublicCase(c, ctx) !== null);
  const wildBirds = allBirds.filter((b) => toPublicWildBird(b, ctx) !== null);
  const status = computeAreaStatus({ muniCode, cases, wildBirds, geo: d.geo, asOf: toJstIso(now), season });
  const sameMuniCases = status.sameMuniCases.map((c) => toPublicCase(c, ctx)).filter(nonNull);
  const adjacentCases = status.adjacentCases.map((c) => toPublicCase(c, ctx)).filter(nonNull);
  const birds = status.wildBirds.map((b) => toPublicWildBird(b, ctx)).filter(nonNull);
  const sourceUrls = uniq([...sameMuniCases, ...adjacentCases].flatMap((c) => c.sourceUrls).concat(birds.map((b) => b.sourceUrl)));

  const notices = [...baseNotices(), FIXED_TEXT.areaNoDistance];
  // 移動制限の解除の後の同じ市町村（段階 2、同じ町の事例あり）。発生したその町に「隣町」と出さない。
  if (status.level === 2 && status.sameMuniCases.length > 0 && !status.sameMuniCases.some(isZoneActive)) notices.push(FIXED_TEXT.sameMuniLifted);
  notices.push(watchNotice(watch.summary));
  // この町の県の見回りが確認できていないとき、段階 4 を「何もない」と読ませない。
  if (watch.summary.failedPrefCodes.includes(status.prefCode)) {
    notices.push(`${prefNameOf(status.prefCode)}の見回りは直近で確認できていません。この町の状況は、県の連絡で確かめてください。`);
  }

  return {
    asOf: status.asOf,
    notices: withDropped(notices, allCases.length - cases.length + (allBirds.length - wildBirds.length), "areas"),
    sources: sourceUrls,
    watch: watch.summary,
    data: { ...status, sameMuniCases, adjacentCases, wildBirds: birds, sourceUrls },
  };
}

export async function buildWatch(d: ApiDeps, now: Date): Promise<ApiWatch> {
  const { rows, summary } = await loadWatch(d, now);
  return {
    asOf: summary.asOf,
    notices: [...baseNotices(), watchNotice(summary)],
    sources: [],
    data: { ...summary, prefectures: rows },
  };
}

export async function buildWildBirds(d: ApiDeps, season: Season, now: Date): Promise<ApiWildBirds> {
  const isCurrent = season === currentSeason(now);
  const [birds, watch] = await Promise.all([d.wildBirdsBySeason(season), isCurrent ? loadWatch(d, now) : Promise.resolve(null)]);
  const ctx = contextOf(d);
  const candidates = birds.filter((b) => b.season === season && b.test !== "negative");
  const data = candidates
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((b) => toPublicWildBird(b, ctx))
    .filter(nonNull);
  return {
    asOf: toJstIso(now),
    notices: withDropped([...baseNotices(), ...(isCurrent ? [] : [FIXED_TEXT.pastDisclaimer]), ...(watch ? [watchNotice(watch.summary)] : [])], candidates.length - data.length, "wild-birds"),
    sources: uniq(data.map((b) => b.sourceUrl)),
    ...(watch ? { watch: watch.summary } : {}),
    data,
  };
}

// ── 経路 ──

const BASE_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" } as const;
const OK_HEADERS = { ...BASE_HEADERS, "Cache-Control": "public, max-age=60" };
/** 失敗は共有の置き場（CDN）に残さない。ある IP の 429 を別の人に返さないため。 */
const ERR_HEADERS = { ...BASE_HEADERS, "Cache-Control": "no-store" };

export function fail(status: number, code: string, message: string, extra: Record<string, string> = {}): ApiResult {
  return { status, headers: { ...ERR_HEADERS, ...extra }, body: { error: { code, message } } };
}

const done = (body: unknown): ApiResult => ({ status: 200, headers: { ...OK_HEADERS }, body });

const BAD_SEASON = (now: Date) => fail(400, "bad_season", `season は ${API_MIN_SEASON} から ${currentSeason(now)} までの 4 桁の数字です`);
const BAD_PREF = () => fail(400, "bad_pref", "pref は 01 から 47 までの 2 桁の都道府県コードです");

export async function handleApi(
  r: { method: string; path: string; query: Record<string, string | undefined> },
  d: ApiDeps,
  now: Date,
): Promise<ApiResult> {
  if (r.method !== "GET") return fail(405, "method_not_allowed", "GET だけです", { Allow: "GET" });

  const path = r.path.replace(/^\/api\/v1(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  try {
    if (path === "/cases") {
      const season = parseSeason(r.query.season, now);
      if (season === null) return BAD_SEASON(now);
      const pref = parsePref(r.query.pref);
      if (pref === null) return BAD_PREF();
      return done(await buildCases(d, { season, pref: pref ?? null }, now));
    }
    if (path === "/wild-birds") {
      const season = parseSeason(r.query.season, now);
      if (season === null) return BAD_SEASON(now);
      return done(await buildWildBirds(d, season, now));
    }
    if (path === "/watch-status") return done(await buildWatch(d, now));

    const area = /^\/areas\/([^/]+)$/.exec(path);
    if (area) {
      const code = area[1]!;
      const muni = parseMuniCode(code);
      if (muni === null) return fail(400, "bad_muni_code", "市町村コードは 5 桁の数字です");
      const built = await buildArea(d, muni, now);
      return built ? done(built) : fail(404, "unknown_area", "知らない市町村コードです（政令市は市のコードで呼んでください）");
    }
    return fail(404, "not_found", "知らない path です");
  } catch (e) {
    // 中身（Firestore の応答、文書の内容）はログにも応答にも出さない。空の一覧を 200 で返さない。
    logger.error("api failed", { name: e instanceof Error ? e.name : "unknown" });
    return fail(500, "internal", "内部エラーです。時間をおいてやり直してください");
  }
}

// ── HTTP の口（Cloud Functions の onRequest から呼ぶ） ──

export interface ApiRequestLike extends IncomingMessage {
  path?: string;
  query?: Record<string, unknown>;
}

/** 配列や入れ子（?season=1&season=2、?a[b]=1）は文字列でなくなるので、検証で 400 になる。 */
function queryOf(q: Record<string, unknown> | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(q ?? {})) out[k] = typeof v === "string" ? v : v === undefined ? undefined : "\u0000";
  return out;
}

function queryOfUrl(url: URL): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    out[k] = all.length === 1 ? all[0] : "\u0000";
  }
  return out;
}

export function sendResult(res: ServerResponse, result: ApiResult): void {
  res.statusCode = result.status;
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(result.body));
}

export interface ServeApiContext {
  /** 遅れて作る（過去の資料と地図を読むため）。失敗したら 500。cacheOnly は全体の上限のとき（キャッシュから返す）。 */
  getDeps: (o?: { cacheOnly?: boolean }) => Promise<ApiDeps>;
  limiter: ReturnType<typeof createRateLimiter>;
  now?: () => Date;
}

/** 数える相手の IP。X-Forwarded-For の右端（Google の前段が付けた側）、なければ接続元。 */
export function clientIpOf(req: IncomingMessage): string {
  const forwarded = clientIp(req.headers["x-forwarded-for"]);
  return forwarded !== "unknown" ? forwarded : (req.socket?.remoteAddress ?? "unknown");
}

export async function serveApi(req: ApiRequestLike, res: ServerResponse, ctx: ServeApiContext): Promise<void> {
  const now = (ctx.now ?? (() => new Date()))();
  const decision = ctx.limiter(clientIpOf(req), now.getTime());
  if (decision === "ip") {
    sendResult(res, fail(429, "rate_limited", "回数が多すぎます。1 分ほど待ってください", { "Retry-After": "60" }));
    return;
  }
  // `//[` のように解釈できない URL は、例外ではなく 400。
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    sendResult(res, fail(400, "bad_url", "URL を解釈できません"));
    return;
  }
  let deps: ApiDeps;
  try {
    deps = await ctx.getDeps({ cacheOnly: decision === "shed" });
  } catch {
    logger.error("api deps failed");
    sendResult(res, fail(500, "internal", "内部エラーです。時間をおいてやり直してください"));
    return;
  }
  const query = req.query !== undefined ? queryOf(req.query) : queryOfUrl(url);
  sendResult(res, await handleApi({ method: req.method ?? "GET", path: req.path ?? url.pathname, query }, deps, now));
}
