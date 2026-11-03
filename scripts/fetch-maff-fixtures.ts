// 国の報道発表の控えを取る（I-01 Step 3、4）。公開しない data/private/fixtures/maff/ に置く。
//
//   npx tsx scripts/fetch-maff-fixtures.ts [--dir data/private/fixtures/maff]
//
// 月別一覧 7 ページ（2510〜2604）と報道発表の index.html（主の入口の実物）→ 題で絞った確認と解除の発表 → 前季の事例一覧 PDF。
// すべて politeFetch（名乗り、robots.txt、同じホストへ 1.2 秒以上の間隔）。農林水産省の外へは出ない。
// 取れなかったものは再試行せず、最後に一覧で報告する。置いてあるものは取り直さない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { filterMaffItems } from "@hpai/shared/read/maff";
import { decodeBody, extractHtml } from "../functions/src/watch/extract";
import { politeFetch, type FetchOutcome } from "../functions/src/watch/politeFetch";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAFF_HOST = "www.maff.go.jp";
/** 前季（2025 シーズン）の事例一覧 PDF。F-08 が出典にしたもの。 */
const PREV_SEASON_PDF = `https://${MAFF_HOST}/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf`;
/** F-08 の出典の控え。あれば PDF の取得を省く。 */
const HISTORY_PDF_DIR = path.join(ROOT, "data", "private", "history-pdf");
export const LIST_MONTHS = ["2510", "2511", "2512", "2601", "2602", "2603", "2604"] as const;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export type FetchFn = (url: string, opts: { allowUrl: (u: URL) => boolean; maxBytes?: number }) => Promise<FetchOutcome>;

export interface FetchReport {
  fetched: number;
  cached: number;
  failed: Array<{ url: string; outcome: string }>;
  items: number;
}

const allowMaff = (u: URL) => u.protocol === "https:" && u.hostname === MAFF_HOST;

/** 取った本文を file に書く。置いてあれば取らず、cached。 */
export async function runFetchMaffFixtures(
  dir: string,
  write: (s: string) => void,
  fetchFn: FetchFn = (url, opts) => politeFetch(url, opts),
): Promise<FetchReport> {
  fs.mkdirSync(dir, { recursive: true });
  const report: FetchReport = { fetched: 0, cached: 0, failed: [], items: 0 };

  async function ensure(url: string, file: string, maxBytes?: number): Promise<Buffer | null> {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      report.cached += 1;
      return fs.readFileSync(full);
    }
    const o = await fetchFn(url, { allowUrl: allowMaff, maxBytes });
    if (o.kind !== "ok") {
      report.failed.push({ url, outcome: JSON.stringify(o) });
      write(`取れませんでした（再試行しません）: ${url} → ${JSON.stringify(o)}\n`);
      return null;
    }
    fs.writeFileSync(full, o.body);
    report.fetched += 1;
    return o.body;
  }

  // 1. 月別一覧
  const links: Array<{ href: string; text: string }> = [];
  for (const ym of LIST_MONTHS) {
    const url = `https://${MAFF_HOST}/j/press/arc/${ym}.html`;
    const body = await ensure(url, `arc-${ym}.html`);
    if (body === null) continue;
    links.push(...extractHtml(decodeBody(body, "text/html"), url).links);
  }

  await ensure(`https://${MAFF_HOST}/j/press/index.html`, "press-index.html");

  // 2. 題で絞った確認と解除の発表
  const items = filterMaffItems(links);
  report.items = items.length;
  write(`題で絞った発表: ${items.length} 本（確認 ${items.filter((i) => i.type === "confirmed").length}、解除 ${items.filter((i) => i.type === "movement_lifted").length}）\n`);
  for (const item of items) await ensure(item.url, path.basename(new URL(item.url).pathname));

  // 3. 前季の事例一覧 PDF
  const pdfName = path.basename(new URL(PREV_SEASON_PDF).pathname);
  const local = path.join(HISTORY_PDF_DIR, pdfName);
  if (!fs.existsSync(path.join(dir, pdfName)) && fs.existsSync(local)) {
    fs.copyFileSync(local, path.join(dir, pdfName));
    write(`前季の PDF は F-08 の控えから写しました: ${pdfName}\n`);
    report.cached += 1;
  } else {
    await ensure(PREV_SEASON_PDF, pdfName, MAX_PDF_BYTES);
  }

  write(`取得 ${report.fetched}、控えにあった ${report.cached}、失敗 ${report.failed.length}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { dir: { type: "string" } }, strict: true });
  const dir = path.resolve(values.dir ?? path.join(ROOT, "data", "private", "fixtures", "maff"));
  void runFetchMaffFixtures(dir, (s) => process.stdout.write(s)).then((r) => process.exit(r.failed.length === 0 ? 0 : 1));
}
