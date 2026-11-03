// 読み取りの試験の実行の入口（I-06、設計書 §13、§16）。**有料の Claude API を呼ぶ**のは --yes を付けた実行だけ。
//
//   npx tsx evals/run.ts --dry-run                  件数、見積もり額、大きさだけ。API を呼ばない（--sync の額も出す）
//   npx tsx evals/run.ts --sync --yes               通常の API。同時 4 件まで。11/5 の合否はこれで行う
//   npx tsx evals/run.ts --yes                      Batch（半額。完了は最長 24 時間）。バッチ ID を保存してから 60 秒ごとに待つ
//   npx tsx evals/run.ts --resume <batchId> --yes   保存したバッチの結果を取り直す（新しい依頼は作らない）
//   npx tsx evals/run.ts --backfill --season 2024 --dry-run   過去分の「疑似患畜の確認」の題をシーズンごとに数える（API は呼ばない）
//   npx tsx evals/run.ts --backfill --season 2024 --yes       過去分を Batch で読む（Q19。出力は data/private/backfill/<年>.json）
//
// 鍵は SDK が環境から読む。ここでは読まず、表示もしない。実際の応答（本文と引用を含む）は data/private/eval-runs/ にだけ置く。
// 公開してよい結果は evals/results/ の summary.json と runs/<runId>.json（事実のみ）。
// 不合格、または read_refusals が 1 件でもあれば終了コード 1。合格しても autoPublishEnabled は変えない（利用者の確認の後）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { estimateUsd } from "@hpai/shared/budget";
import { isMaffOutbreakTitle } from "@hpai/shared/read/maff";
import { ReadResultSchema, SecondReadResultSchema } from "@hpai/shared/read/schema";
import type { ReadResult, SecondReadResult } from "@hpai/shared/read/types";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import { DEFAULT_RUNTIME_SETTINGS, type PrefCode, type RuntimeSettings } from "@hpai/shared/types";
import { READ_MAX_TOKENS, buildPrimaryParams, buildSecondParams, decodeMessage, readPrimary, readSecond, type ReadAttempt, type ReadInput } from "../functions/src/read/claude";
import { isProbeHostAllowed } from "../functions/src/probe/run";
import { politeFetch } from "../functions/src/watch/politeFetch";
import { decodeBody, extractHtml } from "../functions/src/watch/extract";
import { loadScriptGeoStore } from "../scripts/lib/geoStore";
import { measureDetection } from "./detection";
import { loadAnswers, loadEvalDocument } from "./fetch";
import { evalPasses, loadTamperBase, rerunNeeded, runCounts, runTamper, scoreDocument, summarize, tamperForSummary, toRunRecord, type DocScore } from "./score";
import { FIXTURE_DIR, PRIVATE_BACKFILL_DIR, PRIVATE_RUNS_DIR, RESULTS_DIR, ROOT } from "./types";

// ── Batch の依頼 ──

export interface EvalInput extends ReadInput {
  id: string;
}
/** Batch の 1 依頼。bytes は送る大きさの数え（送るときは外す）。 */
export interface EvalRequest {
  custom_id: string;
  params: Anthropic.MessageCreateParamsNonStreaming;
  bytes: number;
}

/** 主の custom_id は ${id}__p、別の読み手は ${id}__s。英数字と - と _ で 64 字以内。 */
export function evalCustomIds(id: string): { primary: string; second: string } {
  return { primary: `${id}__p`, second: `${id}__s` };
}

const sizeOf = (custom_id: string, params: unknown): number => Buffer.byteLength(JSON.stringify({ custom_id, params }), "utf8");

export function buildEvalRequests(inputs: readonly EvalInput[], s: RuntimeSettings): EvalRequest[] {
  const out: EvalRequest[] = [];
  for (const { id, ...doc } of inputs) {
    const ids = evalCustomIds(id);
    const p = buildPrimaryParams(doc, s);
    const q = buildSecondParams(doc, s);
    out.push({ custom_id: ids.primary, params: p, bytes: sizeOf(ids.primary, p) });
    out.push({ custom_id: ids.second, params: q, bytes: sizeOf(ids.second, q) });
  }
  return out;
}

/** 1 バッチ 200MB ごとに分ける（上限は 256MB）。順は保つ。 */
export const BATCH_CHUNK_BYTES = 200 * 1024 * 1024;
export const BATCH_MAX_BYTES = 256 * 1024 * 1024;
export function chunkRequests<T extends { bytes: number }>(reqs: readonly T[], maxBytes: number = BATCH_CHUNK_BYTES): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const r of reqs) {
    if (cur.length > 0 && size + r.bytes > maxBytes) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += r.bytes;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

// ── 見積もり ──

export interface Estimate {
  documents: number;
  requests: number;
  bytes: number;
  batches: number;
  inputTokens: number;
  /** 見込みの出力（主 2,500、別の読み手 600 トークン）で数えた額。 */
  usd: number;
  /** 出力が max_tokens（16,000）まで行った場合の上限。 */
  upperBoundUsd: number;
}
const EXPECTED_OUTPUT = { primary: 2500, second: 600 };
const PDF_TOKENS_PER_PAGE = 2500;
const PDF_BYTES_PER_PAGE = 50_000; // 1 ページあたりの大きさを小さめに見て、ページ数を多めに数える（上振れ側）

/** 入力のトークンの概算: 日本語は 1 字 1 トークンで数える（上振れ側）。PDF は大きさからページ数を概算し 1 ページ 2,500。 */
function inputTokensOf(params: Anthropic.MessageCreateParamsNonStreaming): number {
  let tokens = 0;
  const system = params.system;
  if (Array.isArray(system)) for (const b of system) if (b.type === "text") tokens += [...b.text].length;
  else if (typeof system === "string") tokens += [...system].length;
  for (const m of params.messages) {
    if (typeof m.content === "string") tokens += [...m.content].length;
    else
      for (const b of m.content) {
        if (b.type === "text") tokens += [...b.text].length;
        else if (b.type === "document" && b.source.type === "base64") tokens += Math.ceil((b.source.data.length * 0.75) / PDF_BYTES_PER_PAGE) * PDF_TOKENS_PER_PAGE;
      }
  }
  return tokens;
}

/** Batch の額。--sync は Batch の 2 倍（Batch は半額）。キャッシュは数えない（上振れ側）。 */
export function estimateRun(reqs: readonly EvalRequest[], mode: "batch" | "sync"): Estimate {
  let inputTokens = 0;
  let usd = 0;
  let upper = 0;
  for (const r of reqs) {
    const input = inputTokensOf(r.params);
    inputTokens += input;
    const out = r.custom_id.endsWith("__p") ? EXPECTED_OUTPUT.primary : EXPECTED_OUTPUT.second;
    usd += estimateUsd(r.params.model, { input_tokens: input, output_tokens: out }, { batch: true });
    upper += estimateUsd(r.params.model, { input_tokens: input, output_tokens: READ_MAX_TOKENS }, { batch: true });
  }
  const factor = mode === "sync" ? 2 : 1;
  return {
    documents: Math.floor(reqs.length / 2),
    requests: reqs.length,
    bytes: reqs.reduce((a, r) => a + r.bytes, 0),
    batches: chunkRequests(reqs).length,
    inputTokens,
    usd: usd * factor,
    upperBoundUsd: upper * factor,
  };
}

// ── 過去分（--backfill、索引 Q19） ──

/** シーズンごとの「疑似患畜の確認」の題の数。cases.json の related:false の数と同じ（計 247）。 */
export const SEASON_TITLE_COUNTS: Readonly<Record<number, number>> = Object.freeze({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51, 2025: 24 });

/** 全シーズンの数がこの値のときだけ一致。 */
export function matchesSeasonTitleCounts(counts: Readonly<Record<number, number>>): boolean {
  const keys = Object.keys(SEASON_TITLE_COUNTS).map(Number);
  return keys.every((k) => counts[k] === SEASON_TITLE_COUNTS[k]) && Object.keys(counts).length === keys.length;
}

/** シーズン S の月別一覧（農林水産省 /j/press/arc/YYMM.html。YY は西暦の下 2 桁。2510 は 2025 年 10 月）: S 年 6 月から S+1 年 5 月。 */
export function seasonMonths(season: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((5 + i) % 12) + 1;
    const year = season + (month >= 6 ? 0 : 1);
    out.push(`${String(year % 100).padStart(2, "0")}${String(month).padStart(2, "0")}`);
  }
  return out;
}

/** 過去分の依頼。custom_id は bf<年>-<連番>__p / __s（英数字と - と _ で 64 字以内）。 */
export function buildBackfillRequests(season: number, docs: ReadonlyArray<ReadInput & { id: string }>, s: RuntimeSettings): EvalRequest[] {
  return buildEvalRequests(
    docs.map((d) => ({ ...d, id: d.id.startsWith(`bf${season}-`) ? d.id : `bf${season}-${d.id}` })),
    s,
  );
}

// ── 実行 ──

const SPLIT = (customId: string): { id: string; role: "p" | "s" } => {
  const i = customId.lastIndexOf("__");
  return { id: customId.slice(0, i), role: customId.slice(i + 2) as "p" | "s" };
};

type Attempts = Map<string, { primary: ReadAttempt<ReadResult>; second: ReadAttempt<SecondReadResult> }>;

/** 同時 n 件までで流す。 */
async function pool<T>(items: readonly T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await f(items[next++]!);
    }),
  );
}

function newClient(): Anthropic {
  // 鍵は SDK が環境から読む（ここでは読まず、表示もしない）。再試行しない（二重の課金を避ける）。
  return new Anthropic({ maxRetries: 0 });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 保存する応答は本文と引用を含むので、data/private/eval-runs/ にだけ置く。 */
function savePrivate(runDir: string, name: string, value: unknown): void {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, name), JSON.stringify(value));
}

/** 依頼の単位で同時 4 件まで（文書ごとに主と別の読み手を同時に呼ぶと 8 件になる）。 */
async function runSync(client: Anthropic, inputs: readonly EvalInput[], s: RuntimeSettings, runDir: string): Promise<Attempts> {
  const tasks = inputs.flatMap(({ id, ...doc }) => [
    { id, role: "p" as const, doc },
    { id, role: "s" as const, doc },
  ]);
  const got = new Map<string, ReadAttempt<ReadResult> | ReadAttempt<SecondReadResult>>();
  await pool(tasks, 4, async ({ id, role, doc }) => {
    const ids = evalCustomIds(id);
    const attempt = role === "p" ? await readPrimary(client, doc, s) : await readSecond(client, doc, s);
    got.set(role === "p" ? ids.primary : ids.second, attempt);
    savePrivate(runDir, `${role === "p" ? ids.primary : ids.second}.json`, attempt);
  });
  return toAttempts(inputs, got);
}

interface BatchRecord {
  runId: string;
  createdAt: string;
  settings: RuntimeSettings;
  batches: Array<{ batchId: string; customIds: string[] }>;
}

async function waitForBatch(client: Anthropic, batchId: string, write: (s: string) => void): Promise<void> {
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    write(`バッチ ${batchId}: ${b.processing_status}（処理中 ${b.request_counts.processing}、成功 ${b.request_counts.succeeded}、失敗 ${b.request_counts.errored}、期限切れ ${b.request_counts.expired}）\n`);
    if (b.processing_status === "ended") return;
    await sleep(60_000);
  }
}

/** errored、expired、canceled は read = null（api_error）。 */
async function collectBatch(client: Anthropic, batchId: string, runDir: string, into: Map<string, ReadAttempt<ReadResult> | ReadAttempt<SecondReadResult>>): Promise<void> {
  for await (const entry of await client.messages.batches.results(batchId)) {
    const { role } = SPLIT(entry.custom_id);
    const r = entry.result;
    let attempt: ReadAttempt<ReadResult> | ReadAttempt<SecondReadResult>;
    if (r.type === "succeeded") attempt = role === "p" ? decodeMessage(r.message, ReadResultSchema) : decodeMessage(r.message, SecondReadResultSchema);
    else attempt = { ok: false, reason: "api_error", detail: r.type };
    savePrivate(runDir, `${entry.custom_id}.json`, attempt);
    into.set(entry.custom_id, attempt);
  }
}

const failed = (detail: string): ReadAttempt<never> => ({ ok: false, reason: "api_error", detail });

function toAttempts(inputs: readonly EvalInput[], got: Map<string, ReadAttempt<ReadResult> | ReadAttempt<SecondReadResult>>): Attempts {
  const out: Attempts = new Map();
  for (const { id } of inputs) {
    const ids = evalCustomIds(id);
    out.set(id, {
      primary: (got.get(ids.primary) as ReadAttempt<ReadResult> | undefined) ?? failed("missing"),
      second: (got.get(ids.second) as ReadAttempt<SecondReadResult> | undefined) ?? failed("missing"),
    });
  }
  return out;
}

async function runBatch(client: Anthropic, inputs: readonly EvalInput[], reqs: readonly EvalRequest[], rec: BatchRecord, runDir: string, write: (s: string) => void) {
  const recFile = path.join(PRIVATE_RUNS_DIR, `${rec.runId}.batches.json`);
  if (rec.batches.length === 0) {
    for (const chunk of chunkRequests(reqs)) {
      const batch = await client.messages.batches.create({ requests: chunk.map((r) => ({ custom_id: r.custom_id, params: r.params })) });
      rec.batches.push({ batchId: batch.id, customIds: chunk.map((r) => r.custom_id) });
      fs.mkdirSync(PRIVATE_RUNS_DIR, { recursive: true });
      fs.writeFileSync(recFile, JSON.stringify(rec, null, 2)); // 待つ前にバッチ ID を保存する（途中で止まっても --resume で取り直せる）
      write(`バッチを作りました: ${batch.id}（${chunk.length} 件）。保存先 ${path.relative(ROOT, recFile)}\n`);
    }
  }
  const got = new Map<string, ReadAttempt<ReadResult> | ReadAttempt<SecondReadResult>>();
  for (const b of rec.batches) {
    await waitForBatch(client, b.batchId, write);
    await collectBatch(client, b.batchId, runDir, got);
  }
  return toAttempts(inputs, got);
}

/** 取得元の県。sources.json の入口のホストから。そのホストの県がただ 1 つのときだけ（正解の県は使わない）。 */
function sourcePrefByHost(): Map<string, PrefCode | null> {
  const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources.json"), "utf8")) as Array<{ prefCode: PrefCode | null; url: string }>;
  const sets = new Map<string, Set<string | null>>();
  for (const s of seeds) {
    const host = new URL(s.url).hostname;
    sets.set(host, (sets.get(host) ?? new Set()).add(s.prefCode));
  }
  const out = new Map<string, PrefCode | null>();
  for (const [host, set] of sets) out.set(host, set.size === 1 ? ([...set][0] ?? null) : null);
  return out;
}

function costOf(attempts: Attempts, s: RuntimeSettings, batch: boolean): number {
  let usd = 0;
  for (const { primary, second } of attempts.values()) {
    if (primary.usage) usd += estimateUsd(s.primaryModel, primary.usage, { batch });
    if (second.usage) usd += estimateUsd(s.secondModel, second.usage, { batch });
  }
  return usd;
}

// ── 過去分の題の数え方と実行 ──

const allowMaff = (u: URL): boolean => u.protocol === "https:" && u.hostname === "www.maff.go.jp";

async function listSeasonTitles(season: number, write: (s: string) => void): Promise<Array<{ url: string; title: string }>> {
  const items = new Map<string, string>();
  for (const ym of seasonMonths(season)) {
    const url = `https://www.maff.go.jp/j/press/arc/${ym}.html`;
    const o = await politeFetch(url, { allowUrl: allowMaff });
    if (o.kind !== "ok") {
      write(`  ${ym}: 取れませんでした（再試行しません）${JSON.stringify(o)}\n`);
      continue;
    }
    for (const l of extractHtml(decodeBody(o.body, o.contentType), url).links) {
      if (isMaffOutbreakTitle(l.text) !== "confirmed") continue;
      const u = new URL(l.href);
      if (u.hostname === "www.maff.go.jp" && u.pathname.startsWith("/j/press/")) items.set(u.href, l.text);
    }
  }
  return [...items].map(([url, title]) => ({ url, title }));
}

async function backfill(season: number, flags: { dryRun: boolean; yes: boolean; settings: RuntimeSettings }, write: (s: string) => void): Promise<number> {
  const titles = await listSeasonTitles(season, write);
  const want = SEASON_TITLE_COUNTS[season];
  write(`シーズン ${season} の「疑似患畜の確認」の題: ${titles.length} 件（cases.json の数 ${want ?? "不明"}）\n`);
  if (want === undefined || titles.length !== want) {
    write("題の数が合いません。止めて報告します（何も読みません）。\n");
    return 1;
  }
  if (flags.dryRun) return 0;
  if (!flags.yes) {
    write("有料の実行です。件数と見積もり額を確認の後、--yes を付けてください。\n");
    return 2;
  }
  const inputs: Array<ReadInput & { id: string }> = [];
  for (const [i, t] of titles.entries()) {
    const o = await politeFetch(t.url, { allowUrl: allowMaff });
    if (o.kind !== "ok") continue;
    inputs.push({ id: `bf${season}-${i + 1}`, title: t.title, url: t.url, text: extractHtml(decodeBody(o.body, o.contentType), t.url).text, pdfBase64: null });
  }
  const reqs = buildBackfillRequests(season, inputs, flags.settings);
  const runId = `backfill-${season}-${Date.now()}`;
  const runDir = path.join(PRIVATE_RUNS_DIR, runId);
  const client = newClient();
  const attempts = await runBatch(client, inputs, reqs, { runId, createdAt: toJstIso(new Date()), settings: flags.settings, batches: [] }, runDir, write);
  fs.mkdirSync(PRIVATE_BACKFILL_DIR, { recursive: true });
  const out = [...attempts].map(([id, a]) => ({ id, url: inputs.find((x) => x.id === id)?.url, primary: a.primary, second: a.second }));
  fs.writeFileSync(path.join(PRIVATE_BACKFILL_DIR, `${season}.json`), JSON.stringify(out)); // 公開しない（data/private/）
  write(`過去分 ${season}: ${out.length} 件を ${path.relative(ROOT, path.join(PRIVATE_BACKFILL_DIR, `${season}.json`))} に保存しました。費用 ${costOf(attempts, flags.settings, true).toFixed(2)} ドル\n`);
  return 0;
}

// ── main ──

const fmtUsd = (n: number): string => `${n.toFixed(2)} ドル（約 ${Math.round(n * DEFAULT_RUNTIME_SETTINGS.jpyPerUsd)} 円）`;
const fmtMb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`;

export async function main(argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "primary-model": { type: "string" },
      effort: { type: "string" },
      "second-model": { type: "string" },
      sync: { type: "boolean", default: false },
      resume: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      backfill: { type: "boolean", default: false },
      season: { type: "string" },
      yes: { type: "boolean", default: false },
      "no-summary": { type: "boolean", default: false },
    },
    strict: true,
  });
  const effort = values.effort as RuntimeSettings["primaryEffort"] | undefined;
  if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error(`effort の値が不正です: ${effort}`);
  const settings: RuntimeSettings = {
    ...DEFAULT_RUNTIME_SETTINGS,
    primaryModel: values["primary-model"] ?? DEFAULT_RUNTIME_SETTINGS.primaryModel,
    primaryEffort: effort ?? DEFAULT_RUNTIME_SETTINGS.primaryEffort,
    secondModel: values["second-model"] ?? DEFAULT_RUNTIME_SETTINGS.secondModel,
  };

  if (values.backfill) {
    const season = Number(values.season);
    if (!Number.isInteger(season)) throw new Error("--backfill には --season <年> が要ります");
    return backfill(season, { dryRun: values["dry-run"]!, yes: values.yes!, settings }, write);
  }

  // 文書を読み込む
  const answers = loadAnswers();
  const byHost = sourcePrefByHost();
  const inputs: EvalInput[] = [];
  const meta = new Map<string, { hasTextLayer: boolean; text: string; sourcePref: PrefCode | null }>();
  const missing: string[] = [];
  for (const a of answers) {
    const d = await loadEvalDocument(a);
    if (!d) {
      missing.push(a.id);
      continue;
    }
    inputs.push({ id: a.id, title: a.title, url: a.url ?? `https://example.test/fabricated/${a.id}`, text: d.text, pdfBase64: d.pdfBase64 });
    meta.set(a.id, { hasTextLayer: d.hasTextLayer, text: d.text, sourcePref: a.url ? (byHost.get(new URL(a.url).hostname) ?? null) : null });
  }
  if (missing.length > 0) {
    write(`原文の控えがありません: ${missing.join(", ")}\n先に npx tsx evals/fetch.ts を実行してください（${path.relative(ROOT, FIXTURE_DIR)}）。\n`);
    return 1;
  }

  const mode: "sync" | "batch" = values.sync ? "sync" : "batch";
  const reqs = buildEvalRequests(inputs, settings);
  const est = estimateRun(reqs, mode);
  write(
    [
      `モデル: 主 ${settings.primaryModel}（effort ${settings.primaryEffort}）、別の読み手 ${settings.secondModel}`,
      `文書 ${est.documents} 件、依頼 ${est.requests} 件、合計の大きさ ${fmtMb(est.bytes)}、バッチ ${est.batches} 本`,
      `見積もり（${mode === "sync" ? "--sync。Batch の 2 倍" : "Batch"}）: 約 ${fmtUsd(est.usd)}。出力が上限（${READ_MAX_TOKENS}）まで行った場合の上限は ${fmtUsd(est.upperBoundUsd)}`,
      `（入力 約 ${est.inputTokens} トークンの概算。日本語は 1 字 1 トークンで数えた上振れ側の値）`,
      "",
    ].join("\n"),
  );
  if (values["dry-run"]) return 0;
  if (!values.yes) {
    write("有料の実行です。件数、見積もり額、大きさを確認の後、--yes を付けて実行してください。\n");
    return 2;
  }

  // 実行
  const runId = `${jstDateOf(new Date()).replace(/-/g, "")}-${Date.now()}-${mode}`;
  const runDir = path.join(PRIVATE_RUNS_DIR, runId);
  const client = newClient();
  let attempts: Attempts;
  let resumedSettings = settings;
  if (values.resume) {
    const recFile = fs
      .readdirSync(PRIVATE_RUNS_DIR)
      .filter((f) => f.endsWith(".batches.json"))
      .map((f) => path.join(PRIVATE_RUNS_DIR, f))
      .find((f) => (JSON.parse(fs.readFileSync(f, "utf8")) as BatchRecord).batches.some((b) => b.batchId === values.resume));
    if (!recFile) throw new Error("そのバッチ ID の記録が data/private/eval-runs/ にありません");
    const rec = JSON.parse(fs.readFileSync(recFile, "utf8")) as BatchRecord;
    resumedSettings = rec.settings;
    attempts = await runBatch(client, inputs, buildEvalRequests(inputs, rec.settings), rec, path.join(PRIVATE_RUNS_DIR, rec.runId), write);
  } else if (mode === "sync") {
    attempts = await runSync(client, inputs, settings, runDir);
  } else {
    attempts = await runBatch(client, inputs, reqs, { runId, createdAt: toJstIso(new Date()), settings, batches: [] }, runDir, write);
  }

  // 採点
  const geo = await loadScriptGeoStore();
  const scores: DocScore[] = [];
  for (const a of answers) {
    const at = attempts.get(a.id)!;
    const m = meta.get(a.id)!;
    scores.push(scoreDocument({ answer: a, text: m.text, hasTextLayer: m.hasTextLayer, primary: at.primary, second: at.second, geo, sourcePrefCode: m.sourcePref }));
  }
  const tamper = runTamper(await loadTamperBase(geo), geo);
  const detection = await measureDetection(path.join(ROOT, "data", "private", "fixtures", "maff"), path.join(ROOT, "data", "history", "cases.json"));
  const cost = costOf(attempts, resumedSettings, mode === "batch" || !!values.resume);
  const summary = summarize(scores, tamperForSummary(tamper), detection, cost, toJstIso(new Date()));
  const passes = evalPasses(summary, scores);

  fs.mkdirSync(path.join(RESULTS_DIR, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "runs", `${runId}.json`),
    JSON.stringify({ runId, mode, models: { primary: resumedSettings.primaryModel, effort: resumedSettings.primaryEffort, second: resumedSettings.secondModel }, passes, costUsd: cost, summary, tamperFailures: tamper.failures, ...toRunRecord(scores) }, null, 2) + "\n",
  );
  if (!values["no-summary"]) fs.writeFileSync(path.join(RESULTS_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  const get = (n: string) => summary.metrics.find((x) => x.name === n)!;
  const failures = scores.flatMap((x) => [
    ...(x.primaryFailure ? [`  ${x.id} 主: ${x.primaryFailure}（${x.primaryDetail}）`] : []),
    ...(x.secondFailure ? [`  ${x.id} 別の読み手: ${x.secondFailure}（${x.secondDetail}）`] : []),
  ]);
  write(
    [
      `合否: ${passes ? "合格" : "不合格"}（autoPublishEnabled は変えていません。変えるのは利用者の確認の後）`,
      ...(tamper.control !== "publish" ? [`入れ替えの対照（正しい読み）が ${tamper.control} になり、載りませんでした。入れ替えが落ちた数は 0 として数えます`] : []),
      ...(rerunNeeded(scores) > 0 ? [`やり直しが要る: API の失敗が ${rerunNeeded(scores)} 文書あります（合否とは別。再実行で解消しうる）`] : []),
      `  合否に入れない件数: 種類の取り違え ${runCounts(scores).kindClassErrors}、区域でない半径 ${runCounts(scores).radiusWrong}`,
      ...summary.metrics.map((x) => `  ${x.name}: ${x.value}${x.denominator !== null ? ` / ${x.denominator}` : ""}`),
      ...(failures.length > 0 ? ["読めなかった依頼（理由の detail は状態の番号か種類だけ。429 や 529 は再試行していない）:", ...failures] : []),
      `  費用: ${cost.toFixed(2)} ドル（1 文書あたり ${summary.costPerDocumentUsd?.toFixed(3)} ドル）`,
      "",
    ].join("\n"),
  );
  return !passes || get("read_refusals").value > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      // 鍵や応答の本文を出さない。例外の名前と状態の番号だけ。
      process.stderr.write(`失敗: ${e instanceof Error ? e.name : "unknown"}: ${(e as { status?: number }).status ?? ""}\n`);
      process.exit(1);
    },
  );
}
