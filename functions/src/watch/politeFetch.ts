// 取得はすべてこれを通す（取り決め 3.7）。名乗りを付け、robots.txt に従い、同じホストへの間隔をあける。
// 回避はしない: UA の偽装、リダイレクト先の無断追従、TLS の設定を下げることはしない。
import robotsParser from "robots-parser";
import { toJstIso } from "@hpai/shared/dates";
import type { IsoDateTime } from "@hpai/shared/types";

export type FetchOutcome =
  | {
      kind: "ok";
      status: number;
      finalUrl: string;
      contentType: string;
      body: Buffer;
      etag: string | null;
      lastModified: string | null;
      fetchedAt: IsoDateTime;
    }
  | { kind: "not_modified" }
  | { kind: "robots_denied" }
  | { kind: "not_allowed"; url: string }
  | { kind: "http_error"; status: number; code?: string } // code は robots.txt の失敗（robots_unavailable）のときだけ。本体の失敗と区別する
  | { kind: "network_error"; message: string; code: string | null; tls: boolean };

export interface PoliteFetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  /** 本体を読む上限（バイト）。超えたら中止して network_error（code response_too_large）。既定 8 MiB。robots.txt は 512 KiB。 */
  maxBytes?: number;
  /** 最初の URL と各リダイレクトの先を、取得する前（robots.txt の取得より先）に判定する。false なら外へ 1 度も要求しない。 */
  allowUrl?: (url: URL) => boolean;
}

/** 公開リポジトリの URL（運営者名ではない）。取り決め 3.7。 */
export const USER_AGENT = "hpai-status-map/0.1 (+https://github.com/Go-kurupa/built-with-claude-japan-2026)";
/** robots.txt のグループ名。 */
const ROBOTS_TOKEN = "hpai-status-map";

export const MIN_INTERVAL_MS = 1200;
const MAX_CRAWL_DELAY_MS = 30_000;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 512 * 1024;

// ── ホストごとの待ち行列 ──

interface HostQueue {
  tail: Promise<unknown>;
  lastEndAt: number;
}
const hostQueues = new Map<string, HostQueue>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 同じホスト（ポートを含む）への要求を 1 件ずつ順に流し、前の要求が終わってから delayMs 以上あける。
 * 握手の確認（probe）も同じ行列に並ぶ。
 */
export function throttle<T>(host: string, delayMs: number, task: () => Promise<T>): Promise<T> {
  let queue = hostQueues.get(host);
  if (!queue) {
    queue = { tail: Promise.resolve(), lastEndAt: 0 };
    hostQueues.set(host, queue);
  }
  const q = queue;
  const run = async () => {
    const wait = q.lastEndAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      q.lastEndAt = Date.now();
    }
  };
  const result = q.tail.then(run, run);
  q.tail = result.catch(() => undefined);
  return result;
}

// ── エラーの分類 ──

/** TLS の握手や証明書の失敗の code。 */
const TLS_CODE = /^(EPROTO|ERR_SSL_.*|ERR_TLS_.*|CERT_.*|.*_CERT.*|UNABLE_TO_.*)$/;

export function isTlsCode(code: string | null | undefined): boolean {
  return typeof code === "string" && TLS_CODE.test(code);
}

/** cause をたどった最も深い文字列の code。fetch は原因を cause に隠す。 */
export function deepestCode(error: unknown): string | null {
  let found: string | null = null;
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    const node = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof node.code === "string" && node.code !== "") found = node.code;
    current = node.cause ?? (Array.isArray(node.errors) ? node.errors[0] : undefined);
  }
  return found;
}

function networkError(error: unknown, timedOut: boolean): FetchOutcome {
  if (timedOut) return { kind: "network_error", message: "timeout", code: "TIMEOUT", tls: false };
  const code = deepestCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "network_error", message, code, tls: isTlsCode(code) };
}

// ── robots.txt ──

type RobotsState =
  | { kind: "rules"; robot: ReturnType<typeof robotsParser>; crawlDelayMs: number }
  | { kind: "allow_all"; crawlDelayMs: 0 };
const robotsCache = new Map<string, { at: number; state: RobotsState }>();

type RawResult = { kind: "response"; res: Response; body: Buffer } | { kind: "error"; outcome: FetchOutcome };

const tooLarge = (): FetchOutcome => ({ kind: "network_error", message: "response too large", code: "response_too_large", tls: false });

/** 本体を上限まで読む。content-length が上限を超えるなら読まずに止める。 */
async function readLimited(res: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

async function rawGet(url: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number): Promise<RawResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await globalThis.fetch(url, { method: "GET", redirect: "manual", headers, signal });
    const body = await readLimited(res, maxBytes);
    if (body === null) return { kind: "error", outcome: tooLarge() };
    return { kind: "response", res, body };
  } catch (e) {
    return { kind: "error", outcome: networkError(e, signal.aborted) };
  }
}

const BASE_HEADERS = { "user-agent": USER_AGENT, "accept-language": "ja,en;q=0.5" };

const robotsInflight = new Map<string, Promise<RobotsState | FetchOutcome>>();

/** robots.txt を調べる。同じオリジンの同時の呼び出しは 1 回の取得にまとめる。 */
function loadRobots(origin: string, allowUrl: (url: URL) => boolean, timeoutMs: number): Promise<RobotsState | FetchOutcome> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) return Promise.resolve(cached.state);
  const pending = robotsInflight.get(origin);
  if (pending) return pending;
  const started = fetchRobots(origin, allowUrl, timeoutMs).finally(() => robotsInflight.delete(origin));
  robotsInflight.set(origin, started);
  return started;
}

/** 許可なら RobotsState、そうでなければ返す結果。 */
async function fetchRobots(origin: string, allowUrl: (url: URL) => boolean, timeoutMs: number): Promise<RobotsState | FetchOutcome> {

  let url = new URL("/robots.txt", origin);
  for (let hop = 0; ; hop++) {
    if (!allowUrl(url)) return { kind: "not_allowed", url: url.href };
    const raw = await throttle(url.host, MIN_INTERVAL_MS, () => rawGet(url, { ...BASE_HEADERS, accept: "text/plain,*/*;q=0.1" }, timeoutMs, ROBOTS_MAX_BYTES));
    if (raw.kind === "error") return raw.outcome;
    const { res, body } = raw;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) return { kind: "network_error", message: "too many redirects", code: "too_many_redirects", tls: false };
      try {
        url = new URL(res.headers.get("location")!, url);
      } catch {
        return { kind: "http_error", status: res.status, code: "robots_unavailable" };
      }
      continue;
    }
    let state: RobotsState;
    if (res.status >= 200 && res.status < 300) {
      const robot = robotsParser(new URL("/robots.txt", origin).href, body.toString("utf8"));
      const delay = robot.getCrawlDelay(ROBOTS_TOKEN);
      const crawlDelayMs = typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, MAX_CRAWL_DELAY_MS) : 0;
      state = { kind: "rules", robot, crawlDelayMs };
    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      state = { kind: "allow_all", crawlDelayMs: 0 }; // robots.txt が無い（RFC 9309）
    } else {
      return { kind: "http_error", status: res.status, code: "robots_unavailable" }; // 5xx、429、未解決の 3xx: 規則が分からないので本体を取らない。覚えない
    }
    robotsCache.set(origin, { at: Date.now(), state });
    return state;
  }
}

// ── 本体 ──

export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<FetchOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowUrl = opts.allowUrl ?? (() => true);

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { kind: "network_error", message: "invalid url", code: null, tls: false };
  }

  for (let redirects = 0; ; redirects++) {
    if ((current.protocol !== "http:" && current.protocol !== "https:") || !allowUrl(current)) {
      return { kind: "not_allowed", url: current.href };
    }

    const robots = await loadRobots(current.origin, allowUrl, timeoutMs);
    if (!("crawlDelayMs" in robots)) return robots;
    if (robots.kind === "rules" && robots.robot.isAllowed(current.href, ROBOTS_TOKEN) === false) return { kind: "robots_denied" };

    const headers: Record<string, string> = { ...BASE_HEADERS, accept: "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.5" };
    if (redirects === 0) {
      if (opts.etag) headers["if-none-match"] = opts.etag;
      if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;
    }
    const target = current;
    const raw = await throttle(target.host, Math.max(MIN_INTERVAL_MS, robots.crawlDelayMs), () => rawGet(target, headers, timeoutMs, opts.maxBytes ?? DEFAULT_MAX_BYTES));
    if (raw.kind === "error") return raw.outcome;
    const { res, body } = raw;

    if (res.status === 304) return { kind: "not_modified" };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { kind: "http_error", status: res.status };
      if (redirects >= MAX_REDIRECTS) return { kind: "network_error", message: "too many redirects", code: "too_many_redirects", tls: false };
      try {
        current = new URL(location, current);
      } catch {
        return { kind: "http_error", status: res.status };
      }
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      return {
        kind: "ok",
        status: res.status,
        finalUrl: current.href,
        contentType: res.headers.get("content-type") ?? "",
        body,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        fetchedAt: toJstIso(new Date()),
      };
    }
    return { kind: "http_error", status: res.status };
  }
}
