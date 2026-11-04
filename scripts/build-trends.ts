// 全国の傾向（X-27）。国の疫学調査チームの現地調査の概要を Claude（Batch）で 3 つの項目に揃え、シーズンごとに数える。
//
//   npx tsx scripts/build-trends.ts --fetch              … 現地調査の概要の PDF を集める（無料。国のサイトへ。Claude は呼ばない）
//   npx tsx scripts/build-trends.ts [--dry-run]          … 件数と見積もりだけを出す（Claude は呼ばない）
//   npx tsx scripts/build-trends.ts --yes                … **有料の Claude API（Batch）を呼ぶ**。人が支払いの上限を置いた後にだけ
//   npx tsx scripts/build-trends.ts --resume <batchId>   … 保存したバッチの結果を取り直す（新しい依頼は作らない）
//   npx tsx scripts/build-trends.ts --aggregate          … 手元の抽出の結果から data/trends/summary.json を書く
//
// PDF と 1 事例ごとの結果は data/private/（公開しない）。実行の本体は scripts/lib/trends.ts。
// 鍵は SDK が環境から読む。ここでは読まず、表示もしない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getDocumentProxy } from "unpdf";
import { politeFetch } from "../functions/src/watch/politeFetch";
import { runTrends } from "./lib/trends";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAFF_HOST = "www.maff.go.jp";
const MAX_BYTES = 30 * 1024 * 1024;

/** 1 回だけ取る。国のサイトの外へは出ない（リダイレクトの先も同じ）。取れなければ null（再試行しない） */
async function fetchOne(url: string): Promise<Buffer | null> {
  const r = await politeFetch(url, { allowUrl: (u) => u.protocol === "https:" && u.hostname === MAFF_HOST, maxBytes: MAX_BYTES });
  if (r.kind === "ok") return r.body;
  console.log(`  ${url} → ${r.kind}${"status" in r ? ` ${r.status}` : ""}${"code" in r && r.code ? ` ${r.code}` : ""}`);
  return null;
}

async function pageCount(pdf: Buffer): Promise<number> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return doc.numPages;
}

function muniNames(): string[] {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "geo", "muni-index.json"), "utf8")) as Record<string, { name: string }>;
  return [...new Set(Object.values(idx).map((m) => m.name))];
}

runTrends(process.argv.slice(2), {
  surveyDir: path.join(ROOT, "data", "private", "survey"),
  extractFile: path.join(ROOT, "data", "private", "survey-extract.json"),
  summaryFile: path.join(ROOT, "data", "trends", "summary.json"),
  log: (line) => console.log(line),
  now: () => new Date(),
  fetchOne,
  pageCount,
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
