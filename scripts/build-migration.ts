// 渡り鳥の飛来（季節の参考）。環境省「渡り鳥の飛来状況」の地点別の xlsx を取り、集計した小さな JSON を data/migration/summary.json に書く。
// Claude も Firestore も呼ばない。農場の危険度や警報ではなく、同じ地点の過去の同じ時期との並べ方だけを作る。
//
//   npx tsx scripts/build-migration.ts --plan      … 取りに行く URL の数と、選んだ地点だけを出す（通信は入口のページ 7 本だけ）
//   npx tsx scripts/build-migration.ts             … 取得（手元に無いものだけ）して集計し、書き出す
//   npx tsx scripts/build-migration.ts --offline   … 通信せず、手元の写しだけで集計する
//
// 取得は scripts の politeFetch（robots.txt を守る・名乗る・同じホストへの間隔をあける）を通し、さらに 1 回ごとに 2 秒あける。
// 手元の写しは data/private/migration-cache/（公開しない）。過去のシーズンのファイルは二度と取らない。
// 今季のファイルと入口のページは、取得した日（日本時間）が今日でなければ取り直す（週 1 回ほど更新される）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import { politeFetch } from "../functions/src/watch/politeFetch";
import {
  checkIndexBody,
  checkXlsxBody,
  extractSurveys,
  isMainSite,
  parseIndexLinks,
  parseXlsx,
  summarizeArrival,
  summarizeSite,
  type ArrivalTarget,
  type IndexLink,
  type Survey,
} from "./lib/migration";
import type { MigrationArrival, MigrationSite, MigrationSummary } from "../web/src/pages/trends/migrationTypes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "www.env.go.jp";
const BASE = `https://${HOST}/nature/dobutsu/bird_flu/migratory/`;
const SOURCE_URL = `${BASE}index.html`;
const CACHE = path.join(ROOT, "data", "private", "migration-cache");
const MANIFEST = path.join(CACHE, "manifest.json");
const OUT = path.join(ROOT, "data", "migration", "summary.json");
const GAP_MS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
/** 比べる過去のシーズンの数（今季の前の 5 シーズン）。シーズンの入口が 2020 年秋期から xlsx で、xls は読まない */
const BASELINE_COUNT = 5;

/** 国指定鳥獣保護区の地点（番号が 1000 未満）に加えて入れる地点。1091 = 倉敷市岡田大池（岡山県で唯一の調査地） */
const EXTRA_IDS: readonly number[] = [1091];

/** 飛来の早さを見る地点・種・しきい値。データで確かめてから絞った（選び方は報告と docs/data-sources.md） */
const ARRIVAL_TARGETS: readonly ArrivalTarget[] = [
  { siteId: 20, species: "マガン", threshold: 1000 }, // 宮島沼（北海道）。過去 6 季の幅が 9/17〜9/28 と狭い
  { siteId: 110, species: "マガン", threshold: 1000 }, // 伊豆沼（宮城県）。長く続く代表的な地点。9/22〜10/04
  { siteId: 110, species: "オオハクチョウ", threshold: 100 }, // 伊豆沼。10/15〜10/28。今季はまだ届いていない
  { siteId: 1091, species: "ヒドリガモ", threshold: 100 }, // 倉敷市岡田大池（岡山県で唯一）。10/10〜11/08 と広く、最初の回で超えた年もある
];

interface ManifestEntry {
  fetchedAt: string;
  lastModified: string | null;
  finalUrl: string;
}
type Manifest = Record<string, ManifestEntry>;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function seasonOf(today: string): number {
  const y = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 8 ? y : y - 1;
}
/** 2025 → ".../ap_wr_transit26/"、今季は番号なし */
function seasonBase(season: number, current: number): string {
  return season === current ? `${BASE}ap_wr_transit/` : `${BASE}ap_wr_transit${pad2(season - 1999)}/`;
}

/** 前回の summary.json の地点数。無い・読めなければ null */
function previousSiteCount(): number | null {
  try {
    const v = JSON.parse(fs.readFileSync(OUT, "utf8")) as { sites?: unknown };
    return Array.isArray(v.sites) ? v.sites.length : null;
  } catch {
    return null;
  }
}

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { plan: { type: "boolean" }, offline: { type: "boolean" } } });
  const now = new Date();
  const today = jstDateOf(now);
  const current = seasonOf(today);
  const baselineSeasons = Array.from({ length: BASELINE_COUNT }, (_, i) => current - BASELINE_COUNT + i);
  const allPast = [current - 6, ...baselineSeasons].filter((s, i, a) => a.indexOf(s) === i && s < current).sort();
  const manifest = loadManifest();
  const problems: string[] = [];
  let fetched = 0;
  let lastFetchAt = 0;

  /** キャッシュにあれば返す。なければ（--offline でなければ）1 回だけ取る。currentFile は今日取っていなければ取り直す */
  async function get(key: string, url: string, refreshDaily: boolean, valid: (b: Buffer) => string | null): Promise<Buffer | null> {
    const file = path.join(CACHE, key);
    const hit = manifest[key];
    const fresh = hit && fs.existsSync(file) && (!refreshDaily || hit.fetchedAt.slice(0, 10) === today);
    if (fresh || values.offline) return fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (values.plan && !key.startsWith("index/")) return fs.existsSync(file) ? fs.readFileSync(file) : null;
    const wait = lastFetchAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const r = await politeFetch(url, { allowUrl: (u) => u.protocol === "https:" && u.hostname === HOST, maxBytes: MAX_BYTES });
    lastFetchAt = Date.now();
    fetched++;
    if (r.kind !== "ok" || r.status !== 200) {
      // 再試行しない（同じ URL を重ねて叩かない）
      problems.push(`${key}: ${r.kind}${"status" in r ? ` ${r.status}` : ""}`);
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    }
    // 読めない本体（エラーページ、途中で切れたもの）は保存しない。manifest も更新しない
    const bad = valid(r.body);
    if (bad !== null) {
      problems.push(`${key}: 取得した本体を保存しませんでした（${bad}）`);
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.body);
    manifest[key] = { fetchedAt: toJstIso(now), lastModified: r.lastModified, finalUrl: r.finalUrl };
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    return r.body;
  }

  // 1. 入口のページ（今季と過去 6 シーズン）から、地点の一覧を作る
  const links = new Map<number, Map<number, IndexLink>>();
  for (const season of [...allPast, current]) {
    const buf = await get(`index/${season}.html`, `${seasonBase(season, current)}index.html`, season === current, checkIndexBody);
    if (!buf) {
      problems.push(`index ${season}: 入口のページがありません`);
      continue;
    }
    links.set(season, new Map(parseIndexLinks(buf.toString("utf8")).map((l) => [l.id, l])));
  }
  const currentLinks = links.get(current);
  if (!currentLinks) {
    console.error("今季の入口のページが読めません。中止します");
    return 1;
  }
  const chosen = [...currentLinks.values()]
    .filter((l) => (l.id < 1000 || EXTRA_IDS.includes(l.id)) && [...allPast].every((s) => links.get(s)?.has(l.id)))
    .sort((a, b) => a.id - b.id);
  const toFetch = chosen.length * (allPast.length + 1);
  console.log(`今季 ${current}、比べる過去 ${baselineSeasons.join("・")}（加えて ${allPast[0]} は飛来の早さだけ）`);
  console.log(`今季の地点 ${currentLinks.size}、連続して載る主な地点 ${chosen.length}、ファイル ${toFetch} 本`);
  console.log(chosen.map((l) => `${l.id}:${l.label}`).join(" / "));
  if (values.plan) return 0;

  // 2. 地点ごとのファイル
  const sites: MigrationSite[] = [];
  const arrivals: MigrationArrival[] = [];
  for (const link of chosen) {
    const past = new Map<number, Survey[]>();
    for (const season of allPast) {
      const l = links.get(season)?.get(link.id);
      if (!l) continue;
      if (l.ext !== "xlsx") {
        problems.push(`${season}/${link.id}: .xls は取りません`);
        continue;
      }
      const buf = await get(`${season}/${link.id}.${l.ext}`, `${seasonBase(season, current)}site_csv/${link.id}.${l.ext}`, false, checkXlsxBody);
      if (!buf) continue;
      try {
        const x = extractSurveys(parseXlsx(buf));
        if (x.skippedColumns > 0) problems.push(`${season}/${link.id}: 日付が読めない列 ${x.skippedColumns}`);
        if (x.unparsedCounts > 0) problems.push(`${season}/${link.id}: 羽数として読めないセル ${x.unparsedCounts}`);
        past.set(season, x.surveys);
      } catch (e) {
        problems.push(`${season}/${link.id}: ${(e as Error).message}`);
      }
    }
    const key = `${current}/${link.id}.${link.ext}`;
    if (link.ext !== "xlsx") {
      problems.push(`${key}: .xls は取りません。この地点は載せません`);
      continue;
    }
    const buf = await get(key, `${seasonBase(current, current)}site_csv/${link.id}.${link.ext}`, true, checkXlsxBody);
    if (!buf) {
      problems.push(`${key}: 今季のファイルがありません。この地点は載せません`);
      continue;
    }
    let curSurveys: Survey[];
    let unreported = 0;
    try {
      const x = extractSurveys(parseXlsx(buf));
      if (x.skippedColumns > 0) problems.push(`${key}: 日付が読めない列 ${x.skippedColumns}`);
      if (x.unparsedCounts > 0) problems.push(`${key}: 羽数として読めないセル ${x.unparsedCounts}`);
      curSurveys = x.surveys;
      unreported = x.unreportedColumns;
    } catch (e) {
      problems.push(`${key}: ${(e as Error).message}`);
      continue;
    }
    const fetchedAt = (manifest[key]?.fetchedAt ?? toJstIso(now)).slice(0, 10);
    const site = summarizeSite({ id: link.id, name: link.label, current: curSurveys, past, fetchedAt, unreported }, current, baselineSeasons);
    if (!site) {
      problems.push(`${key}: 今季は数の記録がまだありません。この地点は載せません`);
      continue;
    }
    if (!isMainSite(site)) continue;
    sites.push(site);
    for (const t of ARRIVAL_TARGETS.filter((a) => a.siteId === link.id)) {
      const a = summarizeArrival({ siteId: link.id, siteName: link.label, currentSeason: current, current: curSurveys, past }, t, allPast);
      if (a) arrivals.push(a);
    }
  }

  const summary: MigrationSummary = {
    generatedAt: toJstIso(now),
    currentSeason: current,
    baselineSeasons,
    sourceUrl: SOURCE_URL,
    sites,
    arrivals,
  };
  // 書き出す前の確認: 地点が 0 件、または前回の半分未満に減ったときは、壊れた取得とみなして書かない
  const prevCount = previousSiteCount();
  if (sites.length === 0 || (prevCount !== null && sites.length * 2 < prevCount)) {
    console.error(`地点が ${sites.length} 件（前回 ${prevCount ?? "なし"} 件）です。取得が壊れた可能性があるので書き出しません`);
    if (problems.length > 0) console.error(`気づいた点 ${problems.length} 件:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`取得 ${fetched} 本。地点 ${sites.length}、飛来の早さ ${arrivals.length} 件を ${path.relative(ROOT, OUT)} に書きました`);
  if (problems.length > 0) console.error(`気づいた点 ${problems.length} 件:\n  ${problems.join("\n  ")}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`失敗: ${e instanceof Error ? e.name : "unknown"}: ${e instanceof Error ? e.message : ""}`);
    process.exit(1);
  },
);
