// 過去の事例の出典（国の PDF 6 本）の文字層に、各行の市町村名があるか確かめる（F-08 Step 4）。
//
//   npx tsx scripts/check-history-sources.ts [--history data/history/cases.json] [--dir data/private/history-pdf]
//
// PDF は politeFetch で 1 本ずつ 1 回だけ取り、--dir（data/private/ は .gitignore 済み）に置く。
// 置いてあれば取り直さない。取れなければ再試行せず、その出典の行を「文字層なし」として報告する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { extractText, getDocumentProxy } from "unpdf";
import type { HistoryCase } from "@hpai/shared/types";
import { politeFetch } from "../functions/src/watch/politeFetch";
import { findMissingInSources } from "./lib/history";

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWED_HOST = "www.maff.go.jp";
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export async function runCheckHistorySources(argv: string[], write: (s: string) => void): Promise<number> {
  let values: { history?: string; dir?: string };
  try {
    values = parseArgs({ args: argv, options: { history: { type: "string" }, dir: { type: "string" } }, strict: true }).values;
  } catch (e) {
    write(`${(e as Error).message}\n`);
    return 2;
  }
  const history = path.resolve(values.history ?? path.join(ROOT, "data", "history", "cases.json"));
  const dir = path.resolve(values.dir ?? path.join(ROOT, "data", "private", "history-pdf"));
  const rows = JSON.parse(fs.readFileSync(history, "utf8")) as HistoryCase[];
  const urls = [...new Set(rows.map((r) => r.sourceUrl))].sort();
  fs.mkdirSync(dir, { recursive: true });

  const textBySource = new Map<string, string>();
  for (const url of urls) {
    const file = path.join(dir, path.basename(new URL(url).pathname));
    let source = "取り済み";
    if (!fs.existsSync(file)) {
      const outcome = await politeFetch(url, { allowUrl: (u) => u.protocol === "https:" && u.hostname === ALLOWED_HOST, maxBytes: MAX_PDF_BYTES });
      if (outcome.kind !== "ok") {
        write(`取れませんでした（再試行しません）: ${url} → ${JSON.stringify(outcome)}\n`);
        continue;
      }
      fs.writeFileSync(file, outcome.body);
      source = `取得 ${outcome.body.length} バイト`;
    }
    try {
      const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      textBySource.set(url, text);
      write(`${path.basename(file)}: ${source}、${totalPages} ページ、文字 ${text.length}\n`);
    } catch (e) {
      write(`文字層を読めません: ${url} → ${(e as Error).message}\n`);
    }
  }

  const missing = findMissingInSources(rows, textBySource);
  write(`照合: ${rows.length} 行のうち見つからない行 ${missing.length}\n`);
  for (const m of missing) {
    const r = m.row;
    write(`  ${m.reason === "no_text" ? "文字層なし" : "名前なし"}: ${r.season}-${r.no}${r.related ? "（関連）" : ""} ${r.muniNameThen} ${path.basename(r.sourceUrl)}\n`);
  }
  return missing.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCheckHistorySources(process.argv.slice(2), (s) => process.stdout.write(s)).then((code) => process.exit(code));
}
