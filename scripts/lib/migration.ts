// 渡り鳥の飛来（季節の参考）の集計。環境省「渡り鳥の飛来状況」の地点別の xlsx を読み、
// 同じ地点の過去の同じ時期と並べた小さな表を作る。取得と書き出しは scripts/build-migration.ts。ここは取得も書き出しもしない（純粋な関数）。
//
// 読み方の決めごと（原本の形は 2026-11-04 に確かめた。形が違えば例外にして、黙って数えない）:
//   - 1 つ目のシートの A 列にラベル、B 列以降が調査の回。「調査年月日」の行が日付（Excel のシリアル値か文字列）、
//     「飛来状況」の行が自由記述（読まない）、その下の行が種ごとの羽数。
//   - 水鳥の合計 = ガン・ヒシクイ・ハクチョウ・ガモ・ハジロ・アイサ・オシドリ・カモの種の行の和。
//     「ガン類」のような科レベルの行（種不明）と、名前だけ合うカモ以外（ハジロカイツブリなど）は入れない。
//   - 空欄は 0 として足す。ただし、その回に 1 つも数が書かれていなければ「数の記録がない回」として扱い、合計を出さない（0 にしない）。
//     空欄が 0 を意味するかは環境省の説明が見つからず、未確認。
import zlib from "node:zlib";
import type { IsoDate } from "@hpai/shared/types";
import type {
  MigrationArrival,
  MigrationArrivalPast,
  MigrationBaseline,
  MigrationPastCount,
  MigrationSite,
} from "../../web/src/pages/trends/migrationTypes";

// ── xlsx を読む（zip + XML。外部の部品を足さない） ──

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** zip の中の 1 ファイルを取り出す。無ければ null。zip でなければ例外 */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip ではありません");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new Error("zip の目次が壊れています");
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const rawSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (entryName === name) {
      if (rawSize > MAX_ENTRY_BYTES) throw new Error("zip の中のファイルが大きすぎます");
      const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`zip の圧縮方式 ${method} は読めません`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/gu, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/** <t>…</t> の文字だけを集める（ふりがな <rPh> は除く） */
function textOf(xml: string): string {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/gu, "");
  let out = "";
  for (const m of noPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)) out += decodeEntities(m[1] ?? "");
  return out;
}

export type Cell = string | number | null;
export type Grid = Cell[][];

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 1 つ目のシートを、行 × 列の表にする（空欄は null） */
export function parseXlsx(buf: Buffer): Grid {
  const sheet = readZipEntry(buf, "xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("xlsx の最初のシートがありません");
  const sstBuf = readZipEntry(buf, "xl/sharedStrings.xml");
  const shared: string[] = sstBuf ? [...sstBuf.toString("utf8").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((m) => textOf(m[1] ?? "")) : [];
  const xml = sheet.toString("utf8");
  const grid: Grid = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
    const attrs = m[1] ?? "";
    const ref = /\br="([A-Z]+)(\d+)"/u.exec(attrs);
    if (!ref) continue;
    const body = m[2] ?? "";
    const type = /\bt="([^"]*)"/u.exec(attrs)?.[1] ?? "n";
    const v = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];
    let cell: Cell = null;
    if (type === "s" && v !== undefined) cell = shared[Number(v)] ?? null;
    else if (type === "inlineStr") cell = textOf(body);
    else if (type === "str" && v !== undefined) cell = decodeEntities(v);
    else if (v !== undefined && v.trim() !== "" && (type === "n" || type === "d")) {
      const num = Number(v);
      cell = Number.isFinite(num) ? num : null;
    }
    if (cell === null || cell === "") continue;
    const r = Number(ref[2]) - 1;
    const c = colIndex(ref[1] ?? "A");
    while (grid.length <= r) grid.push([]);
    const row = grid[r]!;
    while (row.length <= c) row.push(null);
    row[c] = cell;
  }
  return grid;
}

// ── 表から調査の回を取り出す ──

export interface Survey {
  date: IsoDate;
  /** 水鳥の合計。この回に数が 1 つも書かれていなければ null */
  total: number | null;
  /** 種名（正規化後）→ 羽数。数が書かれたものだけ */
  species: Record<string, number>;
}

export interface SiteSurveys {
  siteName: string;
  surveys: Survey[];
  /** 日付が読めず、飛ばした列の数 */
  skippedColumns: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Excel のシリアル値（1900 年起点）→ 日付。範囲外は null */
export function excelSerialToIsoDate(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function cellToDate(c: Cell): IsoDate | null {
  if (typeof c === "number") return excelSerialToIsoDate(c);
  if (typeof c !== "string") return null;
  const m = /^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/u.exec(c.normalize("NFKC").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** 「(亜種)オオヒシクイ 【1】」→「オオヒシクイ」 */
export function normalizeSpeciesName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\(亜種\)/gu, "")
    .replace(/【[^】]*】/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

const WATERBIRD_WORD = /ガン|ヒシクイ|ハクチョウ|ガモ|ハジロ|アイサ|オシドリ|カモ$/u;
/** 名前だけ合う、カモ以外の鳥 */
const NOT_WATERBIRD = new Set(["ハジロカイツブリ", "ハジロコチドリ", "ハジロクロハラアジサシ"]);

/** 水鳥（ガン・ハクチョウ・カモ類）の種の行か。「ガン類」のような科レベルの行は種不明なので入れない */
export function isWaterbirdSpecies(name: string): boolean {
  if (name.endsWith("類")) return false;
  if (NOT_WATERBIRD.has(name)) return false;
  return WATERBIRD_WORD.test(name);
}

const SUBTOTAL_LABEL = /^(合計|総計|小計|計)$/u;

function toCount(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) && c >= 0 ? c : null;
  if (typeof c !== "string") return null;
  const t = c.normalize("NFKC").replace(/,/gu, "").trim();
  return /^\d+$/u.test(t) ? Number(t) : null;
}

export function extractSurveys(grid: Grid): SiteSurveys {
  const label = (r: Cell[] | undefined): string => (typeof r?.[0] === "string" ? r[0].normalize("NFKC").replace(/\s+/gu, "") : "");
  const dateRow = grid.findIndex((r) => /^調査(年月日|日)$/u.test(label(r)));
  if (dateRow < 0) throw new Error("「調査年月日」の行がありません（原本の形が変わった可能性）");
  const textRow = grid.findIndex((r, i) => i > dateRow && label(r) === "飛来状況");
  const firstSpecies = (textRow >= 0 ? textRow : dateRow) + 1;
  const headerRow = grid[0] ?? [];
  const siteCell = headerRow.find((c, i) => i >= 1 && typeof c === "string" && c !== "調査年月日");
  const siteName = typeof siteCell === "string" ? siteCell.normalize("NFKC").trim() : "";

  const rows: Array<{ name: string; water: boolean; cells: Cell[] }> = [];
  for (let r = firstSpecies; r < grid.length; r++) {
    const raw = grid[r]?.[0];
    if (typeof raw !== "string") continue;
    const name = normalizeSpeciesName(raw);
    if (name === "" || SUBTOTAL_LABEL.test(name)) continue;
    rows.push({ name, water: isWaterbirdSpecies(name), cells: grid[r] ?? [] });
  }

  const surveys: Survey[] = [];
  let skippedColumns = 0;
  const width = Math.max(...grid.map((r) => r.length), 0);
  for (let c = 1; c < width; c++) {
    const raw = grid[dateRow]?.[c];
    if (raw === null || raw === undefined) continue;
    const date = cellToDate(raw);
    if (date === null) {
      skippedColumns++;
      continue;
    }
    const species: Record<string, number> = {};
    let any = false;
    let total = 0;
    for (const row of rows) {
      const n = toCount(row.cells[c] ?? null);
      if (n === null) continue;
      any = true;
      species[row.name] = (species[row.name] ?? 0) + n;
      if (row.water) total += n;
    }
    surveys.push({ date, total: any ? total : null, species });
  }
  surveys.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { siteName, surveys, skippedColumns };
}

// ── 集計 ──

const DAY_MS = 86_400_000;
const dayNumber = (d: IsoDate): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/** 整数の中央値（偶数個なら真ん中 2 つの平均を四捨五入） */
export function median(values: number[]): number {
  if (values.length === 0) throw new RangeError("空の中央値");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** 日付の年を差し替える（2 月 29 日は 28 日に寄せる） */
export function shiftYear(date: IsoDate, years: number): IsoDate {
  const y = Number(date.slice(0, 4)) + years;
  const md = date.slice(5);
  return md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : `${y}-${md}`;
}

/** 目標の日に最も近い、数が記録された回（前後 windowDays 日以内。同じ近さなら早い方）。なければ null */
export function nearestSurvey(surveys: Survey[], target: IsoDate, windowDays = 7): (Survey & { total: number }) | null {
  let best: (Survey & { total: number }) | null = null;
  let bestGap = Infinity;
  const t = dayNumber(target);
  for (const s of surveys) {
    if (s.total === null) continue;
    const gap = Math.abs(dayNumber(s.date) - t);
    if (gap <= windowDays && gap < bestGap) {
      best = s as Survey & { total: number };
      bestGap = gap;
    }
  }
  return best;
}

/** 今季の最新の調査（数が記録された回のうち最も新しい日）。なければ null */
export function latestSurvey(surveys: Survey[]): (Survey & { total: number }) | null {
  for (let i = surveys.length - 1; i >= 0; i--) if (surveys[i]!.total !== null) return surveys[i] as Survey & { total: number };
  return null;
}

/** 過去の同じ時期と比べるのに最低限そろってほしいシーズンの数 */
export const MIN_BASELINE_SEASONS = 3;

export interface SiteInput {
  id: number;
  name: string;
  current: Survey[];
  /** シーズン（秋の年）→ その年の調査。取れなかったシーズンは入れない */
  past: ReadonlyMap<number, Survey[]>;
  /** 今季のファイルを取得した日 */
  fetchedAt: IsoDate;
}

/** 今季の最新の調査と、過去のシーズンの同じ時期の調査を並べる。今季に数の記録が 1 回もなければ null */
export function summarizeSite(input: SiteInput, currentSeason: number, baselineSeasons: readonly number[]): MigrationSite | null {
  const latest = latestSurvey(input.current);
  if (!latest) return null;
  const seasons: MigrationPastCount[] = [];
  for (const season of baselineSeasons) {
    const surveys = input.past.get(season);
    if (!surveys) continue;
    const hit = nearestSurvey(surveys, shiftYear(latest.date, season - currentSeason));
    if (hit) seasons.push({ season, date: hit.date, total: hit.total });
  }
  let baseline: MigrationBaseline | null = null;
  if (seasons.length >= MIN_BASELINE_SEASONS) {
    const totals = seasons.map((s) => s.total);
    baseline = { n: seasons.length, median: median(totals), min: Math.min(...totals), max: Math.max(...totals), seasons };
  }
  return { id: input.id, name: input.name, latestDate: latest.date, latestTotal: latest.total, fetchedAt: input.fetchedAt, baseline };
}

/** 主な地点に載せる、過去の同じ時期の水鳥の中央値の下限（羽）。これ未満の地点は、数が小さく揺れも読み取れないので載せない */
export const MAIN_SITE_MIN_MEDIAN = 100;

/** 「主な地点」か。過去の同じ時期と比べられ（baseline あり）、その中央値が下限以上 */
export function isMainSite(site: MigrationSite): boolean {
  return site.baseline !== null && site.baseline.median >= MAIN_SITE_MIN_MEDIAN;
}

export interface ArrivalTarget {
  siteId: number;
  species: string;
  threshold: number;
}

/** しきい値以上を初めて記録した回。数が記録された回だけを見る（記録のない回は飛ばす）。超えなければ null */
export function firstCrossing(surveys: Survey[], species: string, threshold: number): { date: IsoDate; atFirstSurvey: boolean } | null {
  const counted = surveys.filter((s) => s.total !== null);
  for (let i = 0; i < counted.length; i++) {
    if ((counted[i]!.species[species] ?? 0) >= threshold) return { date: counted[i]!.date, atFirstSurvey: i === 0 };
  }
  return null;
}

export interface ArrivalInput {
  siteId: number;
  siteName: string;
  currentSeason: number;
  current: Survey[];
  past: ReadonlyMap<number, Survey[]>;
}

/** 飛来の早さ。今季の最新の調査日がなければ（数の記録が 1 回もない）null */
export function summarizeArrival(input: ArrivalInput, target: ArrivalTarget, pastSeasons: readonly number[]): MigrationArrival | null {
  const latest = latestSurvey(input.current);
  if (!latest) return null;
  // 飛来（秋の到着）だけを見る。その年の 12 月末までの調査に限り、春の戻りなど翌年の調査を混ぜない
  const untilYearEnd = (surveys: Survey[], season: number): Survey[] => surveys.filter((s) => s.date <= `${season}-12-31`);
  const cur = firstCrossing(untilYearEnd(input.current, input.currentSeason), target.species, target.threshold);
  const past: MigrationArrivalPast[] = [];
  for (const season of pastSeasons) {
    const surveys = input.past.get(season);
    if (!surveys || surveys.every((s) => s.total === null)) continue;
    const hit = firstCrossing(untilYearEnd(surveys, season), target.species, target.threshold);
    past.push({ season, date: hit?.date ?? null, atFirstSurvey: hit?.atFirstSurvey ?? false });
  }
  return {
    siteId: input.siteId,
    siteName: input.siteName,
    species: target.species,
    threshold: target.threshold,
    currentDate: cur?.date ?? null,
    latestSurveyDate: latest.date,
    past,
  };
}

// ── 入口のページ ──

export interface IndexLink {
  id: number;
  ext: "xlsx" | "xls";
  /** 例: 「クッチャロ湖」「厚岸・別寒辺牛・霧多布（別寒辺牛川下流・厚岸湖）」 */
  label: string;
}

/** シーズンの入口のページ（html）から、地点ごとのファイルへのリンクを取り出す。同じ番号は 1 つにする */
export function parseIndexLinks(html: string): IndexLink[] {
  const seen = new Map<number, IndexLink>();
  for (const m of html.matchAll(/<a\b[^>]*href="site_csv\/(\d+)\.(xlsx|xls)"[^>]*>([\s\S]*?)(?:<\/a>|<\/td>)/gu)) {
    // 令和 3 年秋期のページは </a> が抜けているので、</td> でも閉じる
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    const text = decodeEntities((m[3] ?? "").replace(/<[^>]+>/gu, "").replace(/&nbsp;/gu, " "))
      .normalize("NFKC")
      .replace(/^\s*\(\d+(?:-\d+)?\)/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    seen.set(id, { id, ext: m[2] as "xlsx" | "xls", label: text });
  }
  return [...seen.values()];
}
