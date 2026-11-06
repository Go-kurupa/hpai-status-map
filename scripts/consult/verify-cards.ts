// 対策カードの引用の全件照合（対策の見直し相談）。
//
//   npx tsx scripts/consult/verify-cards.ts <cards.json か下書き> [--out data/consult/verify.json]
//
// 資料の原本を politeFetch で取り直し、各カードの引用が本文にあるかを quote の正規化つきで見る。
// 公開の verify.json に残すのは、資料ごとの取得の結果（実際の URL、sha256、失敗の理由）と、カードごとの照合の結果だけ。本文は保存しない。
// 照合に落ちたカードは直さない。id を出力するだけ。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";
import { toJstIso } from "@hpai/shared/dates";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCard, ConsultCardsFile, ConsultSource } from "@hpai/shared/consult/types";
import { quoteInNormalized } from "@hpai/shared/read/quote";
import { normalizeForMatch } from "@hpai/shared/text";
import { politeFetch, type FetchOutcome, type PoliteFetchOptions } from "../../functions/src/watch/politeFetch";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MAX_BYTES = 30 * 1024 * 1024;
/** 同じホストへの間隔の下限。politeFetch の既定（1.2 秒）に加えてスクリプトで待つ。 */
export const HOST_INTERVAL_MS = 4000;
/** ページに引用がないときに辿る添付の上限。 */
const MAX_ATTACHMENTS = 3;
const EXEC_MAX_BUFFER = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);

// ── 型 ──

export type TextKind = "pdf" | "docx" | "html" | "xml";
/** 照合に使った本文の取り出し方。 */
export type VerifyMethod = "pdf-unpdf" | "pdf-pdftotext" | "docx" | "html" | "xml";

export interface VerifyPart {
  url: string;
  sha256: string;
  kind: TextKind;
  bytes: number;
}

export interface VerifySourceEntry {
  id: string;
  /** 照合に使った本文の URL（転送の後）。取れなかった資料は取りに行った URL。 */
  effectiveUrl: string;
  /** 本文の SHA-256。取れなかった資料は null。 */
  sha256: string | null;
  /** この資料を取りに行った日時。 */
  checkedAt?: string;
  /** ok か、失敗の理由（robots_denied、not_allowed、http_error、network_error、unexpected_status、kind_mismatch、unsupported_type、extract_error、empty_text、internal_error）。 */
  status: string;
  detail?: string;
  /** 取得した全部（ページと、辿った添付）。 */
  parts?: VerifyPart[];
}

export interface VerifyCardEntry {
  id: string;
  verified: boolean;
  /** normalizeForMatch した引用の SHA-256。あとで引用を書き換えたことを、照合の結果と突き合わせて見つけるため。 */
  quoteSha256: string;
  method?: VerifyMethod;
}

export interface VerifyFile {
  checkedAt: string;
  sources: VerifySourceEntry[];
  cards: VerifyCardEntry[];
}

export interface VerifyDeps {
  fetch: (url: string, opts: PoliteFetchOptions) => Promise<FetchOutcome>;
  /** 同じホストへの前の要求から間隔があくまで待つ（取得の前に呼ぶ）。 */
  waitForHost: (host: string) => Promise<void>;
  /** PDF の本文（unpdf）。 */
  pdfText: (body: Buffer) => Promise<string>;
  /** PDF の本文（pdftotext、-layout なし）。 */
  pdftotext: (body: Buffer) => Promise<string>;
  /** Word（.docx）の word/document.xml のタグを取った本文。 */
  docxText: (body: Buffer) => Promise<string>;
  now: () => Date;
}

// ── 下書きの整形 ──

const DRAFT_ONLY_KEYS = ["continuesWith", "referenceOnly", "overlapsWith"] as const;

/**
 * 下書き（補助の項目つき）を cards.json の形にする: 補助の項目を外し、approved がなければ false を足す。
 * cards.json の形（補助の項目なし、approved あり）では何も変えない。入力は書き換えない。
 */
export function normalizeDraft(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { cards?: unknown }).cards)) return raw;
  const file = raw as { cards: unknown[] };
  return {
    ...file,
    cards: file.cards.map((c) => {
      if (typeof c !== "object" || c === null || Array.isArray(c)) return c;
      const next: Record<string, unknown> = { ...(c as Record<string, unknown>) };
      for (const key of DRAFT_ONLY_KEYS) delete next[key];
      if (next.approved === undefined) next.approved = false;
      return next;
    }),
  };
}

// ── 照合 ──

/** 引用が資料の本文にあるか。本文は資料ごとに 1 回だけ正規化する。本文のない資料のカードは false。 */
export function verifyQuotes(cards: readonly ConsultCard[], texts: ReadonlyMap<string, string>): Array<{ id: string; verified: boolean }> {
  const normalized = new Map<string, string>();
  return cards.map((card) => {
    const text = texts.get(card.sourceId);
    if (text === undefined) return { id: card.id, verified: false };
    let doc = normalized.get(card.sourceId);
    if (doc === undefined) {
      doc = normalizeForMatch(text);
      normalized.set(card.sourceId, doc);
    }
    return { id: card.id, verified: quoteInNormalized(card.quote, doc) };
  });
}

/** 引用の SHA-256（normalizeForMatch の後）。 */
export function quoteSha256(quote: string): string {
  return createHash("sha256").update(normalizeForMatch(quote)).digest("hex");
}

// ── 本文の取り出し ──

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  times: "×",
  plusmn: "±",
  deg: "°",
  shy: "",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** タグは空白に置く。照合は空白を無視して比べるので、語の途中のタグ（<b>）でも合う。 */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/gu, " "));
}

export function htmlToText(html: string): string {
  return stripTags(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/giu, " "),
  );
}

// Europe PMC の抄録は、HTML のタグが文字参照のまま入っている（&lt;h4&gt;）。戻した後に残るこれだけを取る（「p < 0.05」は消さない）。
const ESCAPED_HTML_TAG = /<\/?(?:h[1-6]|b|i|u|em|strong|sub|sup|p|br|ul|ol|li|span|a)\b[^<>]*>/giu;

/** XML（Europe PMC の全文と抄録、Word の document.xml）。 */
export function xmlToText(xml: string): string {
  return stripTags(xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1").replace(/<\/w:p>/gu, "\n")).replace(ESCAPED_HTML_TAG, " ");
}

/** PMC の論文なら、本文の照合に使う Europe PMC の全文 XML の URL。 */
export function europePmcUrl(sourceUrl: string): string | null {
  const m = /^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)\/?$/u.exec(sourceUrl);
  return m ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${m[1]}/fullTextXML` : null;
}

/**
 * PubMed の論文なら、抄録の照合に使う Europe PMC の検索結果（core）の URL。
 * pubmed.ncbi.nlm.nih.gov は機械の取得に Cookie の確認ページ（HTTP 203）を返し、本文がない。
 */
export function europePmcAbstractUrl(sourceUrl: string): string | null {
  const m = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/u.exec(sourceUrl);
  return m ? `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${m[1]}%20AND%20SRC:MED&resultType=core&format=xml` : null;
}

/** HTML のページから、添付の docx と pdf のリンク（絶対 URL、重複なし）を順に拾う。 */
export function findAttachmentLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/giu)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(m[1]!), baseUrl);
    } catch {
      continue;
    }
    if (!/\.(docx|pdf)$/iu.test(url.pathname) || (url.protocol !== "https:" && url.protocol !== "http:")) continue;
    url.hash = "";
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

function detectKind(outcome: Extract<FetchOutcome, { kind: "ok" }>): TextKind | null {
  const ct = outcome.contentType.toLowerCase();
  const head = outcome.body.subarray(0, 8).toString("latin1");
  if (ct.includes("pdf") || head.startsWith("%PDF")) return "pdf";
  if (ct.includes("wordprocessingml") || (head.startsWith("PK") && /\.docx(?:$|\?)/iu.test(outcome.finalUrl))) return "docx";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (head.trimStart().startsWith("<")) return /<html|<!doctype html/iu.test(outcome.body.subarray(0, 2048).toString("utf8")) ? "html" : "xml";
  return null;
}

const sha256 = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

// ── 1 資料の処理 ──

const GOV_UK_PAGE_HOST = "www.gov.uk";
const GOV_UK_ASSET_HOST = "assets.publishing.service.gov.uk";
/** 本文として使う最低の文字数。Cookie の確認ページや空のページを本文にしないため。 */
export const MIN_TEXT_CHARS = 300;

function allowedHosts(fetchUrl: string): Set<string> {
  const host = new URL(fetchUrl).hostname;
  const hosts = new Set([host]);
  if (host === GOV_UK_PAGE_HOST) hosts.add(GOV_UK_ASSET_HOST); // gov.uk の添付はこちらに置かれ、転送もここへ
  return hosts;
}

/** 取れた応答が本文として使えるか。200 以外（203 の Cookie 確認ページなど）と、URL の拡張子に合わない中身は使わない。 */
function usable(outcome: Extract<FetchOutcome, { kind: "ok" }>, kind: TextKind | null): { status: string; detail: string } | null {
  if (outcome.status !== 200) return { status: "unexpected_status", detail: `http_${outcome.status}` };
  if (kind === null) return { status: "unsupported_type", detail: "unknown_content" };
  const ext = /\.(pdf|docx)$/iu.exec(new URL(outcome.finalUrl).pathname)?.[1]?.toLowerCase();
  if (ext && ext !== kind) return { status: "kind_mismatch", detail: `expected_${ext}_got_${kind}` };
  return null;
}

/** 取り出しの失敗の理由。Error.message は入れない（定型の語と終了コードだけ）。 */
export class ExtractError extends Error {
  constructor(readonly tag: string) {
    super(tag);
  }
}
const tagOf = (e: unknown): string => (e instanceof ExtractError ? e.tag : "extract_failed");

function failure(outcome: Exclude<FetchOutcome, { kind: "ok" }>): { status: string; detail?: string } {
  switch (outcome.kind) {
    case "http_error":
      return { status: "http_error", detail: outcome.code ? `${outcome.status} ${outcome.code}` : String(outcome.status) };
    case "network_error":
      return { status: "network_error", detail: outcome.code ?? "no_code" }; // message は入れない
    case "not_allowed":
      return { status: "not_allowed", detail: outcome.url };
    case "robots_denied":
      return { status: "robots_denied" };
    case "not_modified":
      return { status: "http_error", detail: "304" };
  }
}

/** 1 資料の中でのカードごとの結果。quoteSha256 は最後に足す。 */
interface CardResult {
  verified: boolean;
  method?: VerifyMethod;
}

interface ExtractedPart {
  part: VerifyPart;
  /** 1 回目の本文（PDF は unpdf）。取り出せなければ null。 */
  text: string | null;
  method: VerifyMethod;
  /** PDF のとき、pdftotext でやり直す元。 */
  pdfBody?: Buffer;
  html?: string;
}

const METHOD_OF: Record<Exclude<TextKind, "pdf">, VerifyMethod> = { docx: "docx", html: "html", xml: "xml" };

async function extractPart(outcome: Extract<FetchOutcome, { kind: "ok" }>, kind: TextKind, deps: VerifyDeps): Promise<ExtractedPart> {
  const part: VerifyPart = { url: outcome.finalUrl, sha256: sha256(outcome.body), kind, bytes: outcome.body.length };
  if (kind === "pdf") {
    let text: string | null = null;
    try {
      text = await deps.pdfText(outcome.body);
    } catch {
      text = null; // 文字層を読めない PDF は pdftotext にまかせる
    }
    return { part, text, method: "pdf-unpdf", pdfBody: outcome.body };
  }
  const method = METHOD_OF[kind];
  if (kind === "docx") return { part, text: await deps.docxText(outcome.body), method };
  const raw = outcome.body.toString("utf8");
  return { part, text: kind === "html" ? htmlToText(raw) : xmlToText(raw), method, html: kind === "html" ? raw : undefined };
}

async function getPart(url: string, hosts: Set<string>, deps: VerifyDeps): Promise<{ outcome: FetchOutcome; host: string }> {
  await deps.waitForHost(new URL(url).host);
  const outcome = await deps.fetch(url, { allowUrl: (u) => u.protocol === "https:" && hosts.has(u.hostname), maxBytes: MAX_BYTES });
  return { outcome, host: new URL(url).host };
}

async function processSource(
  source: ConsultSource,
  cards: ConsultCard[],
  deps: VerifyDeps,
): Promise<{ entry: VerifySourceEntry; results: Map<string, CardResult> }> {
  const results = new Map<string, CardResult>(cards.map((c) => [c.id, { verified: false }]));
  const fetchUrl = europePmcUrl(source.url) ?? europePmcAbstractUrl(source.url) ?? source.url;
  const hosts = allowedHosts(fetchUrl);
  const fail = (status: string, detail?: string): { entry: VerifySourceEntry; results: Map<string, CardResult> } => ({
    entry: { id: source.id, effectiveUrl: fetchUrl, sha256: null, status, ...(detail === undefined ? {} : { detail }) },
    results,
  });

  const { outcome } = await getPart(fetchUrl, hosts, deps);
  if (outcome.kind !== "ok") {
    const f = failure(outcome);
    return fail(f.status, f.detail);
  }
  const kind = detectKind(outcome);
  const bad = usable(outcome, kind);
  if (bad) return fail(bad.status, bad.detail);

  let main: ExtractedPart;
  try {
    main = await extractPart(outcome, kind!, deps);
  } catch (e) {
    return fail("extract_error", tagOf(e));
  }
  const parts: VerifyPart[] = [main.part];
  let effective: VerifyPart = main.part;

  /** 落ちているカードを、この本文で見直す。通ったカードは results に書く。 */
  const recheck = (text: string, method: VerifyMethod): boolean => {
    const pending = cards.filter((c) => !results.get(c.id)!.verified);
    let any = false;
    for (const r of verifyQuotes(pending, new Map([[source.id, text]]))) {
      if (r.verified) {
        results.set(r.id, { verified: true, method });
        any = true;
      }
    }
    return any;
  };
  const pendingCount = (): number => cards.filter((c) => !results.get(c.id)!.verified).length;

  // 本文が短い（取り出せていない）PDF は、先に pdftotext の本文を見る
  let text = main.text;
  let method = main.method;
  let pdftotextText: string | null = null;
  if (main.pdfBody && (text === null || text.length < MIN_TEXT_CHARS)) {
    try {
      pdftotextText = await deps.pdftotext(main.pdfBody);
      if (pdftotextText.length > (text?.length ?? 0)) {
        text = pdftotextText;
        method = "pdf-pdftotext";
      }
    } catch (e) {
      if (text === null) return fail("extract_error", tagOf(e));
    }
  }
  if (text === null) return fail("extract_error", "no_text");
  if (text.length < MIN_TEXT_CHARS) return fail("empty_text", `chars_${text.length}`);

  recheck(text, method);

  // PDF: unpdf で落ちたカードだけ、pdftotext で取り直した本文で見直す
  if (main.pdfBody && method === "pdf-unpdf" && pendingCount() > 0) {
    try {
      recheck(pdftotextText ?? (await deps.pdftotext(main.pdfBody)), "pdf-pdftotext");
    } catch {
      // pdftotext で読めなくても unpdf の結果は残す
    }
  }

  // gov.uk: ページに引用がなければ、ページの添付（docx、pdf）の本文で見直す
  if (main.html !== undefined && pendingCount() > 0 && new URL(fetchUrl).hostname === GOV_UK_PAGE_HOST) {
    let firstWithHit: VerifyPart | null = null;
    for (const link of findAttachmentLinks(main.html, outcome.finalUrl).slice(0, MAX_ATTACHMENTS)) {
      if (pendingCount() === 0) break;
      const { outcome: att } = await getPart(link, hosts, deps);
      if (att.kind !== "ok") continue;
      const attKind = detectKind(att);
      if (usable(att, attKind) || (attKind !== "docx" && attKind !== "pdf")) continue;
      let ex: ExtractedPart;
      try {
        ex = await extractPart(att, attKind, deps);
      } catch {
        continue;
      }
      parts.push(ex.part);
      let hit = ex.text !== null && recheck(ex.text, ex.method);
      if (ex.pdfBody && pendingCount() > 0) {
        try {
          hit = recheck(await deps.pdftotext(ex.pdfBody), "pdf-pdftotext") || hit;
        } catch {
          // 取り出せない添付は数えない
        }
      }
      if (hit && firstWithHit === null) firstWithHit = ex.part;
    }
    if (firstWithHit) effective = firstWithHit;
  }

  const entry: VerifySourceEntry = { id: source.id, effectiveUrl: effective.url, sha256: effective.sha256, status: "ok", parts };
  return { entry, results };
}

// ── 全件 ──

/** 資料ごとに 1 回だけ取りに行き、全カードを照合する。結果の順は、資料はファイルの順、カードもファイルの順。 */
export async function verifyAll(file: ConsultCardsFile, deps: VerifyDeps): Promise<VerifyFile> {
  const cardsBySource = new Map<string, ConsultCard[]>();
  for (const c of file.cards) cardsBySource.set(c.sourceId, [...(cardsBySource.get(c.sourceId) ?? []), c]);

  const sources: VerifySourceEntry[] = [];
  const byCard = new Map<string, CardResult>();
  for (const source of file.sources) {
    const cards = cardsBySource.get(source.id);
    if (!cards) continue; // 使うカードのない資料は取りに行かない
    let done: Awaited<ReturnType<typeof processSource>>;
    try {
      done = await processSource(source, cards, deps);
    } catch (e) {
      // 想定外の失敗でも他の資料の結果は残す（取り直しで同じ資料に何度も要求しないため）
      done = {
        entry: { id: source.id, effectiveUrl: source.url, sha256: null, status: "internal_error", detail: e instanceof ExtractError ? e.tag : "internal_error" },
        results: new Map(),
      };
    }
    sources.push({ ...done.entry, checkedAt: toJstIso(deps.now()) });
    for (const [id, r] of done.results) byCard.set(id, r);
  }
  return {
    checkedAt: toJstIso(deps.now()),
    sources,
    cards: file.cards.map((c) => {
      const verified = byCard.get(c.id);
      const quoteHash = quoteSha256(c.quote);
      return verified?.verified ? { id: c.id, verified: true, quoteSha256: quoteHash, method: verified.method } : { id: c.id, verified: false, quoteSha256: quoteHash };
    }),
  };
}

/** 一部の資料だけ取り直した結果（next）を、前の結果（prev）に重ねる。順はファイル（file）の順。 */
export function mergeVerify(prev: VerifyFile, next: VerifyFile, file: ConsultCardsFile): VerifyFile {
  const prevSources = new Map(prev.sources.map((s) => [s.id, { checkedAt: prev.checkedAt, ...s }]));
  const nextSources = new Map(next.sources.map((s) => [s.id, s]));
  const prevCards = new Map(prev.cards.map((c) => [c.id, c]));
  const nextCards = new Map(next.cards.map((c) => [c.id, c]));
  return {
    checkedAt: next.checkedAt,
    sources: file.sources.flatMap((s) => {
      const e = nextSources.get(s.id) ?? prevSources.get(s.id);
      return e ? [e] : [];
    }),
    cards: file.cards.map((c) => nextCards.get(c.id) ?? prevCards.get(c.id) ?? { id: c.id, verified: false, quoteSha256: quoteSha256(c.quote) }),
  };
}

// ── 実際の取得、変換 ──

async function withTempFile<T>(body: Buffer, name: string, run: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "consult-verify-"));
  try {
    const file = path.join(dir, name);
    await fs.promises.writeFile(file, body);
    return await run(file);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** 外のコマンドを流して標準出力を返す。失敗は定型の語（pdftotext_failed_exit_1 など）にする。 */
async function runTool(command: "pdftotext" | "unzip", args: string[]): Promise<string> {
  try {
    return (await execFileAsync(command, args, { encoding: "utf8", maxBuffer: EXEC_MAX_BUFFER })).stdout;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    throw new ExtractError(`${command === "unzip" ? "unzip" : "pdftotext"}_failed_${typeof code === "number" || typeof code === "string" ? `exit_${code}` : "no_code"}`);
  }
}

export function defaultDeps(): VerifyDeps {
  const lastAt = new Map<string, number>();
  return {
    fetch: async (url, opts) => {
      const outcome = await politeFetch(url, opts);
      lastAt.set(new URL(url).host, Date.now());
      if (outcome.kind === "ok") lastAt.set(new URL(outcome.finalUrl).host, Date.now());
      return outcome;
    },
    waitForHost: async (host) => {
      const wait = (lastAt.get(host) ?? 0) + HOST_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    },
    pdfText: async (body) => {
      const pdf = await getDocumentProxy(new Uint8Array(body));
      return (await extractText(pdf, { mergePages: true })).text;
    },
    pdftotext: (body) =>
      withTempFile(body, "in.pdf", async (file) => runTool("pdftotext", [file, "-"])),
    docxText: (body) => withTempFile(body, "in.docx", async (file) => xmlToText(await runTool("unzip", ["-p", file, "word/document.xml"]))),
    now: () => new Date(),
  };
}

// ── 入口 ──

export async function runVerifyCards(argv: string[], write: (s: string) => void, deps: VerifyDeps = defaultDeps()): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: { out: { type: "string" }; only: { type: "string" } }; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: { out: { type: "string" }, only: { type: "string" } }, allowPositionals: true, strict: true });
  } catch (e) {
    write(`${(e as Error).message}\n`);
    return 2;
  }
  const input = parsed.positionals[0];
  if (!input || parsed.positionals.length !== 1) {
    write("使い方: npx tsx scripts/consult/verify-cards.ts <cards.json か下書き> [--out data/consult/verify.json] [--only 資料のid,...]\n");
    return 2;
  }
  const outPath = path.resolve(parsed.values.out ?? path.join(ROOT, "data", "consult", "verify.json"));
  const file = parseCardsFile(normalizeDraft(JSON.parse(fs.readFileSync(path.resolve(input), "utf8"))));

  // --only: 指定した資料だけ取り直し、前の verify.json に重ねる（取得済みの資料に要求を重ねないため）
  let target = file;
  if (parsed.values.only !== undefined) {
    const ids = new Set(parsed.values.only.split(",").map((x) => x.trim()).filter(Boolean));
    const unknown = [...ids].filter((id) => !file.sources.some((s) => s.id === id));
    if (ids.size === 0 || unknown.length > 0 || !fs.existsSync(outPath)) {
      write(`--only は、入力にある資料の id と、前の ${outPath} が必要です${unknown.length > 0 ? `（不明: ${unknown.join(", ")}）` : ""}\n`);
      return 2;
    }
    target = { sources: file.sources.filter((s) => ids.has(s.id)), cards: file.cards.filter((c) => ids.has(c.sourceId)) };
  }

  let result = await verifyAll(target, deps);
  if (target !== file) result = mergeVerify(JSON.parse(fs.readFileSync(outPath, "utf8")) as VerifyFile, result, file);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  for (const s of result.sources) {
    const n = file.cards.filter((c) => c.sourceId === s.id).length;
    const ok = result.cards.filter((c) => c.verified && file.cards.find((x) => x.id === c.id)?.sourceId === s.id).length;
    write(`${s.status === "ok" ? "取得 ok" : `取得 ${s.status}${s.detail ? `（${s.detail}）` : ""}`}  ${s.id}  照合 ${ok}/${n}  ${s.effectiveUrl}\n`);
  }
  const failed = result.cards.filter((c) => !c.verified);
  write(`照合: ${result.cards.length} 枚のうち ${result.cards.length - failed.length} 枚が一致、${failed.length} 枚が不一致\n`);
  for (const c of failed) write(`  不一致: ${c.id}\n`);
  write(`書き出し: ${outPath}\n`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runVerifyCards(process.argv.slice(2), (s) => process.stdout.write(s)).then((code) => process.exit(code));
}
