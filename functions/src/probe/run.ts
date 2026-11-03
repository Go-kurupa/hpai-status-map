// 全入口への到達試験（F-03）。Cloud Functions の IP から届くか、各入口で何が起きるかを 1 行 1 件で返す。
// 本文は返さず、保存しない。見回り先でないホスト（古い TLS の国のホストなど）も、分類のために 1 度だけ試す。
import https from "node:https";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { hasHpaiWord, normalizeForMatch } from "@hpai/shared/text";
import type { PrefCode } from "@hpai/shared/types";
import { checkBearer } from "../ops/auth";
import { decodeBody, extractHtml } from "../watch/extract";
import { deepestCode, isTlsCode, MIN_INTERVAL_MS, politeFetch, throttle, USER_AGENT } from "../watch/politeFetch";

export interface ProbeTarget {
  prefCode: PrefCode | null;
  url: string;
  kind: string;
  /** 開発機での結果（試験の前に調べたもの）。無ければ null。 */
  dev: { ok: boolean; hasWord: boolean | null } | null;
}

export type ProbeVerdict = "ok" | "reached_no_content" | "not_allowed" | "robots_denied" | "http_error" | "tls_error" | "network_error";

export interface ProbeRow {
  target: ProbeTarget;
  verdict: ProbeVerdict;
  status: number | null;
  finalUrl: string | null;
  errorCode: string | null;
  bytes: number;
  ms: number;
  hasWord: boolean;
  /** RSS は項目の数、HTML はリンクの数。 */
  itemCount: number;
  /** 題に「高病原性鳥インフルエンザの疑似患畜の確認」を含む項目（リンク）の数。 */
  outbreakTitleCount: number;
}

export interface ProbeDeps {
  fetcher?: typeof politeFetch;
  handshake?: (url: string) => Promise<{ code: string | null; tls: boolean }>;
  /** 同時に回すホストの数。既定 10。 */
  hostConcurrency?: number;
}

/** 許可するホスト: .go.jp、.lg.jp、pref.<名>.jp（先頭の www と数字は可）。 */
export function isProbeHostAllowed(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return false; // 内部のポートへ向けさせない
  const host = url.hostname.toLowerCase();
  return host.endsWith(".go.jp") || host.endsWith(".lg.jp") || /^(www\d*\.)?pref\.[a-z]+\.jp$/.test(host);
}

// ── 握手 ──

/** https://<host>/ に HEAD を 1 回。既定の TLS 設定のまま。握手に失敗したかを分類するためだけに使う。 */
export function tlsHandshake(url: string): Promise<{ code: string | null; tls: boolean }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.resolve({ code: null, tls: false });
  }
  if (u.protocol !== "https:") return Promise.resolve({ code: null, tls: false });
  return throttle(
    u.host,
    MIN_INTERVAL_MS,
    () =>
      new Promise<{ code: string | null; tls: boolean }>((resolve) => {
        const req = https.request(
          {
            method: "HEAD",
            hostname: u.hostname.replace(/^\[|\]$/g, ""),
            port: u.port || 443,
            path: "/",
            headers: { "user-agent": USER_AGENT },
            agent: false,
            timeout: 15_000,
          },
          (res) => {
            res.resume();
            req.destroy();
            resolve({ code: null, tls: false });
          },
        );
        req.on("timeout", () => {
          req.destroy();
          resolve({ code: "ETIMEDOUT", tls: false });
        });
        req.on("error", (e) => {
          const code = deepestCode(e);
          resolve({ code, tls: isTlsCode(code) });
        });
        req.end();
      }),
  );
}

// ── 本文の見立て ──

/** 200 のとき、語がなくても届いたとみなす種類（課のトップは平時に語がない。語の有無は hasWord に残す）。 */
const UNCONDITIONAL_KINDS = new Set(["press_list", "maff_press", "maff_arc", "dept_page", "season_parent", "reference"]);
const OUTBREAK_TITLE = normalizeForMatch("高病原性鳥インフルエンザの疑似患畜の確認");
const isOutbreakTitle = (title: string) => normalizeForMatch(title).includes(OUTBREAK_TITLE);

const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

function toArray<T>(v: T | T[] | undefined | null): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}
function titleOf(item: unknown): string {
  const t = (item as { title?: unknown } | null)?.title;
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && typeof (t as { "#text"?: unknown })["#text"] === "string") return (t as { "#text": string })["#text"];
  return "";
}

/** RSS 2.0、RSS 1.0（RDF）、Atom の項目の題。読めなければ空。 */
function feedTitles(text: string): string[] {
  try {
    const doc = xml.parse(text) as Record<string, any>;
    const items = [...toArray(doc.rss?.channel?.item), ...toArray(doc.RDF?.item), ...toArray(doc.feed?.entry)];
    return items.map(titleOf);
  } catch {
    return [];
  }
}

interface Analysis {
  verdict: "ok" | "reached_no_content";
  hasWord: boolean;
  itemCount: number;
  outbreakTitleCount: number;
}

function analyze(t: ProbeTarget, body: Buffer, contentType: string, finalUrl: string): Analysis {
  const pdf = /\.pdf$/i.test(safePathname(t.url)) || /pdf/i.test(contentType);
  if (pdf) {
    return { verdict: body.subarray(0, 4).toString("latin1") === "%PDF" ? "ok" : "reached_no_content", hasWord: false, itemCount: 0, outbreakTitleCount: 0 };
  }
  if (/^(image|audio|video)\/|octet-stream/i.test(contentType)) {
    return { verdict: UNCONDITIONAL_KINDS.has(t.kind) ? "ok" : "reached_no_content", hasWord: false, itemCount: 0, outbreakTitleCount: 0 };
  }
  const decoded = decodeBody(body, contentType);
  if (t.kind.startsWith("rss")) {
    const titles = feedTitles(decoded);
    return {
      verdict: titles.length >= 1 ? "ok" : "reached_no_content",
      hasWord: hasHpaiWord(decoded),
      itemCount: titles.length,
      outbreakTitleCount: titles.filter(isOutbreakTitle).length,
    };
  }
  const page = extractHtml(decoded, finalUrl);
  const hasWord = hasHpaiWord(`${page.title}\n${page.text}`);
  return {
    verdict: UNCONDITIONAL_KINDS.has(t.kind) || hasWord ? "ok" : "reached_no_content",
    hasWord,
    itemCount: page.links.length,
    outbreakTitleCount: page.links.filter((l) => isOutbreakTitle(l.text)).length,
  };
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

// ── 1 件を試す ──

const emptyRow = (target: ProbeTarget, verdict: ProbeVerdict, extra: Partial<ProbeRow> = {}): ProbeRow => ({
  target,
  verdict,
  status: null,
  finalUrl: null,
  errorCode: null,
  bytes: 0,
  ms: 0,
  hasWord: false,
  itemCount: 0,
  outbreakTitleCount: 0,
  ...extra,
});

async function probeOne(t: ProbeTarget, fetcher: typeof politeFetch, handshake: NonNullable<ProbeDeps["handshake"]>): Promise<ProbeRow> {
  let parsed: URL | null = null;
  try {
    parsed = new URL(t.url);
  } catch {
    // 下で not_allowed にする
  }
  if (!parsed || !isProbeHostAllowed(parsed)) return emptyRow(t, "not_allowed");

  const started = Date.now();
  try {
    const outcome = await fetcher(t.url, { allowUrl: isProbeHostAllowed });
    switch (outcome.kind) {
      case "ok": {
        const a = analyze(t, outcome.body, outcome.contentType, outcome.finalUrl);
        return {
          target: t,
          verdict: a.verdict,
          status: outcome.status,
          finalUrl: outcome.finalUrl,
          errorCode: null,
          bytes: outcome.body.length,
          ms: Date.now() - started,
          hasWord: a.hasWord,
          itemCount: a.itemCount,
          outbreakTitleCount: a.outbreakTitleCount,
        };
      }
      case "not_modified":
        return emptyRow(t, "http_error", { status: 304, ms: Date.now() - started });
      case "robots_denied":
        return emptyRow(t, "robots_denied", { ms: Date.now() - started });
      case "not_allowed":
        return emptyRow(t, "not_allowed", { ms: Date.now() - started });
      case "http_error":
        return emptyRow(t, "http_error", { status: outcome.status, errorCode: outcome.code ?? null, ms: Date.now() - started });
      case "network_error": {
        if (outcome.tls) return emptyRow(t, "tls_error", { errorCode: outcome.code, ms: Date.now() - started });
        // fetch は原因を隠す。握手を 1 度だけ試して TLS の失敗かを分ける。
        let hs: { code: string | null; tls: boolean } = { code: null, tls: false };
        try {
          hs = await handshake(t.url);
        } catch {
          // 分類できなかっただけ。network_error のまま
        }
        const ms = Date.now() - started;
        return hs.tls ? emptyRow(t, "tls_error", { errorCode: hs.code, ms }) : emptyRow(t, "network_error", { errorCode: outcome.code ?? hs.code, ms });
      }
    }
  } catch (e) {
    return emptyRow(t, "network_error", { errorCode: deepestCode(e), ms: Date.now() - started });
  }
}

/** ホストごとに順に、別のホストは同時に（既定 10 ホストまで）。1 件の失敗で止めない。 */
export async function probeTargets(targets: readonly ProbeTarget[], onRow: (r: ProbeRow) => void, deps: ProbeDeps = {}): Promise<void> {
  const fetcher = deps.fetcher ?? politeFetch;
  const handshake = deps.handshake ?? tlsHandshake;
  const groups = new Map<string, ProbeTarget[]>();
  for (const t of targets) {
    const key = safeHost(t.url);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const queue = [...groups.values()];
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const t of group) onRow(await probeOne(t, fetcher, handshake));
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.hostConcurrency ?? 10, queue.length) }, worker));
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return `invalid:${url}`;
  }
}

// ── HTTP の入口（probeEntrances の中身） ──

const TargetSchema = z
  .object({
    prefCode: z.string().regex(/^[0-9]{2}$/).nullable(),
    url: z.url().max(2000),
    kind: z.string().min(1).max(40),
    dev: z.object({ ok: z.boolean(), hasWord: z.boolean().nullable() }).strict().nullable(),
  })
  .strict();
const RequestSchema = z.object({ targets: z.array(TargetSchema).max(500) }).strict();

export interface ProbeReq {
  method: string;
  get(name: string): string | undefined;
  body: unknown;
}
export interface ProbeRes {
  status(code: number): ProbeRes;
  setHeader(name: string, value: string): unknown;
  flushHeaders?(): void;
  write(chunk: string): unknown;
  json(body: unknown): unknown;
  end(): unknown;
}

export async function serveProbe(req: ProbeReq, res: ProbeRes, expectedToken: string, deps: ProbeDeps = {}): Promise<void> {
  if (!checkBearer(req.get("authorization"), expectedToken)) {
    res.status(401).json({ ok: false, error: "認証できません" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST だけです" });
    return;
  }
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "本文は { targets: [...] } の形にしてください" });
    return;
  }
  // Node の fetch は応答の頭を 300 秒で打ち切る。先に頭を送り、1 行ずつ返す。
  res.status(200);
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();
  await probeTargets(parsed.data.targets, (row) => void res.write(`${JSON.stringify(row)}\n`), deps);
  res.end();
}
