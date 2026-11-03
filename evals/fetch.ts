// 試験の文書の取得と読み込み（I-06 Step 3）。
//
//   npx tsx evals/fetch.ts [--dir data/private/fixtures/eval]
//
// answers の url を politeFetch（名乗り、robots.txt、同じホストへ 1.2 秒以上の間隔、再試行しない）で取り、
// 公開しない data/private/fixtures/eval/<id>.<拡張子> に置く。置いてあるものは取り直さない。
// 国と県と環境省の公式のホストだけ（isProbeHostAllowed）。取れなかったものは最後に一覧で報告する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isProbeHostAllowed } from "../functions/src/probe/run";
import { politeFetch, type FetchOutcome } from "../functions/src/watch/politeFetch";
import { decodeBody, extractHtml, extractPdfText } from "../functions/src/watch/extract";
import { ANSWERS_DIR, FABRICATED_DIR, FIXTURE_DIR, type EvalAnswer } from "./types";

const MAX_BYTES = 30 * 1024 * 1024;

export function loadAnswers(dir: string = ANSWERS_DIR): EvalAnswer[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as EvalAnswer);
}

/** 文書のファイルの場所。作った文書は evals/fabricated/、実在の文書は控えの置き場所。 */
export function answerFilePath(a: EvalAnswer, fixtureDir: string = FIXTURE_DIR): string | null {
  if (!a.file) return null;
  return path.join(a.fabricated ? FABRICATED_DIR : fixtureDir, a.file);
}

export interface EvalDocument {
  /** 文字層、または HTML の本文。照合と発生の語の判定はこれで行う。 */
  text: string;
  /** PDF のときだけ。主と別の読み手の両方に渡す。 */
  pdfBase64: string | null;
  hasTextLayer: boolean;
  pages: number | null;
  bytes: number;
}

/** 文書を読む。ファイルがなければ null。 */
export async function loadEvalDocument(a: EvalAnswer, fixtureDir: string = FIXTURE_DIR): Promise<(EvalDocument & { fullText: string }) | null> {
  const file = answerFilePath(a, fixtureDir);
  if (!file || !fs.existsSync(file)) return null;
  const body = fs.readFileSync(file);
  if (a.fabricated) {
    const text = body.toString("utf8");
    return { text, fullText: text, pdfBase64: null, hasTextLayer: true, pages: null, bytes: body.length };
  }
  if (a.contentType === "pdf") {
    const r = await extractPdfText(body);
    return { text: r.text, fullText: r.text, pdfBase64: body.toString("base64"), hasTextLayer: r.hasTextLayer, pages: r.pages, bytes: body.length };
  }
  const html = decodeBody(body, "text/html");
  const text = extractHtml(html, a.url ?? "https://example.invalid/").text;
  return { text, fullText: text, pdfBase64: null, hasTextLayer: text.length > 0, pages: null, bytes: body.length };
}

export type FetchFn = (url: string, opts: { allowUrl: (u: URL) => boolean; maxBytes?: number }) => Promise<FetchOutcome>;

export interface FetchReport {
  fetched: number;
  cached: number;
  failed: Array<{ id: string; url: string; outcome: string }>;
}

/** 実在の文書を取る。置いてあれば取らない。失敗は再試行せず報告に残す。 */
export async function runFetchEvalFixtures(
  answers: readonly EvalAnswer[],
  dir: string,
  write: (s: string) => void,
  fetchFn: FetchFn = (url, opts) => politeFetch(url, opts),
): Promise<FetchReport> {
  fs.mkdirSync(dir, { recursive: true });
  const report: FetchReport = { fetched: 0, cached: 0, failed: [] };
  for (const a of answers) {
    if (a.fabricated || !a.url || !a.file) continue;
    const target = path.join(dir, a.file);
    if (fs.existsSync(target)) {
      report.cached += 1;
      continue;
    }
    const o = await fetchFn(a.url, { allowUrl: isProbeHostAllowed, maxBytes: MAX_BYTES });
    if (o.kind !== "ok") {
      report.failed.push({ id: a.id, url: a.url, outcome: JSON.stringify(o) });
      write(`取れませんでした（再試行しません）: ${a.id} → ${JSON.stringify(o)}\n`);
      continue;
    }
    fs.writeFileSync(target, o.body);
    report.fetched += 1;
  }
  write(`取得 ${report.fetched}、控えにあった ${report.cached}、失敗 ${report.failed.length}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { dir: { type: "string" } }, strict: true });
  const dir = path.resolve(values.dir ?? FIXTURE_DIR);
  void runFetchEvalFixtures(loadAnswers(), dir, (s) => process.stdout.write(s)).then((r) => process.exit(r.failed.length === 0 ? 0 : 1));
}
