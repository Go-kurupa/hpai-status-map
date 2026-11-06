// 全国の傾向の段階 2（計画 T5）。現地調査の概要から「どう気づいたか」などの 4 項目を Claude（Batch）で読み取り、根拠の文を照らして数える。
//
//   npx tsx scripts/build-trends-noticing.ts [--dry-run]          … 件数と見積もりだけを出す（Claude は呼ばない）
//   npx tsx scripts/build-trends-noticing.ts --yes                … **有料の Claude API（Batch）を呼ぶ**。作者の了承の後にだけ
//   npx tsx scripts/build-trends-noticing.ts --resume <batchId>   … 保存したバッチの結果を取り直す（新しい依頼は作らない）
//   npx tsx scripts/build-trends-noticing.ts --aggregate          … 根拠の文を PDF の本文と照らし、data/private/noticing-summary.json に書く
//
// PDF は scripts/build-trends.ts --fetch で集めた data/private/survey/ を使う。結果も集計も data/private/（公開しない）。
// 実行の本体は scripts/lib/trends-noticing.ts。鍵は SDK が環境から読む。ここでは読まず、表示もしない。
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";
import { runNoticing } from "./lib/trends-noticing";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function pageCount(pdf: Buffer): Promise<number> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return doc.numPages;
}

async function pdfText(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return (await extractText(doc, { mergePages: true })).text;
}

/** pdftotext（-layout なし）。無い、読めないときは null */
async function pdfTextAlt(pdf: Buffer): Promise<string | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noticing-"));
  try {
    const file = path.join(dir, "in.pdf");
    fs.writeFileSync(file, pdf);
    const { stdout } = await promisify(execFile)("pdftotext", [file, "-"], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function muniNames(): string[] {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "geo", "muni-index.json"), "utf8")) as Record<string, { name: string }>;
  return [...new Set(Object.values(idx).map((m) => m.name))];
}

runNoticing(process.argv.slice(2), {
  surveyDir: path.join(ROOT, "data", "private", "survey"),
  noticingFile: path.join(ROOT, "data", "private", "survey-noticing.json"),
  summaryFile: path.join(ROOT, "data", "private", "noticing-summary.json"),
  previousExtractFile: path.join(ROOT, "data", "private", "survey-extract.json"),
  log: (line) => console.log(line),
  now: () => new Date(),
  pageCount,
  pdfText,
  pdfTextAlt,
  // 再試行しない（二重の課金を避ける）
  makeClient: () => new Anthropic({ maxRetries: 0 }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  muniNames,
}).then(
  (code) => process.exit(code),
  (e: unknown) => {
    // 鍵や応答の本文を出さない。例外の名前と状態の番号だけ。
    console.error(`失敗: ${e instanceof Error ? e.name : "unknown"}: ${(e as { status?: number }).status ?? ""}`);
    process.exit(1);
  },
);
