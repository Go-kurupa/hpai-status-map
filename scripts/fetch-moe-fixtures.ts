// 環境省の野鳥の入口と今季の PDF、岡山県の常設ページと事例ページの控えを取る（I-12）。公開しない data/private/fixtures/ に置く。
//
//   npx tsx scripts/fetch-moe-fixtures.ts [--root data/private/fixtures]
//
// すべて politeFetch（名乗り、robots.txt、同じホストへ 1.2 秒以上の間隔）。環境省は www.env.go.jp、岡山県は www.pref.okayama.jp の外へは出ない。
// 取れなかったものは再試行せず、最後に一覧で報告する。置いてあるものは取り直さない。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { selectMoeLinks } from "../functions/src/watch/moe";
import { decodeBody, extractHtml } from "../functions/src/watch/extract";
import { politeFetch, type FetchOutcome } from "../functions/src/watch/politeFetch";
import { currentSeason } from "@hpai/shared/season";

const ROOT = path.resolve(import.meta.dirname, "..");
const MOE_HOST = "www.env.go.jp";
const MOE_ENTRANCE = `https://${MOE_HOST}/nature/dobutsu/bird_flu/`;
const OKAYAMA_HOST = "www.pref.okayama.jp";
const OKAYAMA_PAGES = [`https://${OKAYAMA_HOST}/page/816850.html`, `https://${OKAYAMA_HOST}/page/1013219.html`] as const;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export type FetchFn = (url: string, opts: { allowUrl: (u: URL) => boolean; maxBytes?: number }) => Promise<FetchOutcome>;

export interface FetchReport {
  fetched: string[];
  cached: string[];
  failed: Array<{ url: string; outcome: string }>;
}

const allowHost = (host: string) => (u: URL) => u.protocol === "https:" && u.hostname === host;

export async function runFetchMoeFixtures(
  root: string,
  write: (s: string) => void,
  now: Date = new Date(),
  fetchFn: FetchFn = (url, opts) => politeFetch(url, opts),
): Promise<FetchReport> {
  const report: FetchReport = { fetched: [], cached: [], failed: [] };

  async function ensure(url: string, host: string, file: string, maxBytes?: number): Promise<Buffer | null> {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      report.cached.push(url);
      return fs.readFileSync(file);
    }
    const o = await fetchFn(url, { allowUrl: allowHost(host), maxBytes });
    if (o.kind !== "ok") {
      report.failed.push({ url, outcome: JSON.stringify(o) });
      write(`取れませんでした（再試行しません）: ${url} → ${JSON.stringify(o)}\n`);
      return null;
    }
    fs.writeFileSync(file, o.body);
    report.fetched.push(url);
    return o.body;
  }

  // 環境省: 入口 → 今季の PDF と、陰性確定などの報道発表 1 本
  const moeDir = path.join(root, "moe");
  const entrance = await ensure(MOE_ENTRANCE, MOE_HOST, path.join(moeDir, "index.html"));
  if (entrance !== null) {
    const page = extractHtml(decodeBody(entrance, "text/html"), MOE_ENTRANCE);
    const selected = selectMoeLinks(page.links, currentSeason(now));
    write(`環境省の入口のリンク ${page.links.length} 本のうち、選ばれたもの ${selected.length} 本\n`);
    for (const l of selected) write(`  ${l.type}: ${l.text} ${l.href}\n`);
    const season = selected.find((l) => l.type === "season_pdf");
    if (season !== undefined) await ensure(season.href, MOE_HOST, path.join(moeDir, "season.pdf"), MAX_PDF_BYTES);
    const press = selected.find((l) => l.type === "press");
    if (press !== undefined) await ensure(press.href, MOE_HOST, path.join(moeDir, "press-1.html"));
  }

  // 岡山県: I-02 の試験が使う 2 ページ
  const okDir = path.join(root, "okayama");
  for (const url of OKAYAMA_PAGES) await ensure(url, OKAYAMA_HOST, path.join(okDir, path.basename(new URL(url).pathname)));
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = path.resolve(values.root ?? path.join(ROOT, "data", "private", "fixtures"));
  const r = await runFetchMoeFixtures(root, (s) => process.stdout.write(s));
  process.stdout.write(`取得 ${r.fetched.length} 件、置いてあった ${r.cached.length} 件、失敗 ${r.failed.length} 件\n`);
  if (r.failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
