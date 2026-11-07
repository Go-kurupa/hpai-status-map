// 環境省の「野鳥における鳥インフルエンザ発生状況」の今季の PDF を、表としてプログラムで読み、wildBirds を作る（Claude は使わない）。
// 報道発表を読む道（読み取り I-05）は照合と二重読みが厳しく、野鳥の陽性が載らないことがあった（2026-11-07 の調べ）。
// 国の一覧の表は、検査の段階（簡易、遺伝子、最終判定）と野鳥監視重点区域の日付を 1 件ずつ持つので、これを正にする。
//
// - pdf.js の座標では 2025 も 2026 も 1 件が 1 列（ページが回転している）。回転の違う版に備えて、項目名の並ぶ向きから 1 件が 1 行の表も読む。
// - 1 件ごとの記録の番号は「野鳥国内 N 例目」（番号のない件は回収日、県、市町村、種）。段階が変わっても同じ記録を上書きする。
// - 読めない（項目名が見つからない、件が 0、必須の欄が欠ける、見たことのない言い方、前に書いた番号の件が消えた）ときは失敗として返す。
//   黙って 0 件にしない。黙って一部だけ書かない。
import { createHash } from "node:crypto";
import type { GeoStore } from "@hpai/shared/geo";
import { findMuniByName } from "@hpai/shared/geo";
import { prefCodeOfName } from "@hpai/shared/pref";
import { muniCoreName } from "@hpai/shared/read/names";
import type { IsoDate, Season, WildBird, WildBirdTest } from "@hpai/shared/types";

/** PDF の文字 1 片と位置（pdf.js の座標。y は下から上へ増える） */
export interface PdfItem {
  page: number;
  s: string;
  x: number;
  y: number;
}

type Field = "nationalNo" | "collectedOn" | "pref" | "muni" | "sample" | "species" | "screening" | "pathogenicity" | "final" | "zoneFrom" | "zoneTo";

/** 項目名（正規化した文）→ 欄。null は値を取らないが、近さの比べに加える項目名 */
const LABELS: ReadonlyArray<readonly [string, Field | null]> = [
  ["野鳥国内", "nationalNo"],
  ["回収日", "collectedOn"],
  ["採取日", null],
  ["都道府県", "pref"],
  ["都道府県内", null],
  ["市町村", "muni"],
  ["検体の種類", "sample"],
  ["種名", "species"],
  ["国内希少", null],
  ["野生動植物種", null],
  ["陽性個体数", null],
  ["結果", "screening"],
  ["結果判明日", null],
  ["HA亜型", null],
  ["病原性", "pathogenicity"],
  ["最終判定", "final"],
  ["指定日", "zoneFrom"],
  ["解除日", "zoneTo"],
];
/** 欄を束ねるだけの見出し。値の近さの比べには使わない */
const GROUP_LABELS = new Set(["場所", "検体情報", "簡易検査", "遺伝子検査", "野鳥監視重点区域", "○例目"]);
/** 表があると言える項目名。どれかが欠けたら、そのページを表として読まない */
const NEEDED: readonly Field[] = ["nationalNo", "collectedOn", "pref", "muni", "pathogenicity", "final"];

/** 見たことのある言い方（2025 と 2026 の控えの全件）。ほかの言い方は形の変化として失敗にする */
const KNOWN_RESULT = /^(?:検査中|陰性(?:\(.*\))?|H\d+(?:N\d+)?亜型高病原性)$/u;
const KNOWN_SCREENING = /^(?:簡易陽性|簡易陰性|検査中)$/u;

const norm = (s: string): string => s.normalize("NFKC").replace(/\s+/gu, "");
const DASH = new Set(["ー", "－", "-", "―", "‐"]);

export interface MoeTableRow {
  /** 野鳥国内の例目。番号のない件（陰性の疑い事例など）は null */
  nationalNo: number | null;
  collectedOn: string;
  prefecture: string;
  municipality: string | null;
  sample: string | null;
  species: string | null;
  screening: string | null;
  pathogenicity: string | null;
  final: string | null;
  zoneFrom: string | null;
  zoneTo: string | null;
}

export type ParseResult = { ok: true; rows: MoeTableRow[] } | { ok: false; reason: string };

const isPrefName = (s: string): boolean => prefCodeOfName(s) !== null && /[都道府県]$/u.test(s);

type PageResult = { kind: "no_table" } | { kind: "bad"; reason: string } | { kind: "rows"; rows: MoeTableRow[] };

/** 1 ページ分の表を読む */
function parsePage(items: readonly PdfItem[]): PageResult {
  const cells = items.map((i) => ({ ...i, n: norm(i.s) })).filter((i) => i.n !== "");
  const labels = cells.filter((c) => LABELS.some(([l]) => l === c.n));
  const labelOf = (f: Field) => labels.find((c) => LABELS.find(([l]) => l === c.n)?.[1] === f);
  if (NEEDED.some((f) => labelOf(f) === undefined)) {
    // 項目名がそろわないのに県名の値があるページは、表の形が変わったとみなす（黙って飛ばさない）
    return cells.some((c) => isPrefName(c.n)) && labels.length > 0 ? { kind: "bad", reason: "labels_missing" } : { kind: "no_table" };
  }

  // 項目名が縦に並ぶ（x の幅 < y の幅）なら 1 件が 1 列。横に並ぶなら 1 件が 1 行
  const xs = labels.map((l) => l.x);
  const ys = labels.map((l) => l.y);
  const columnMode = Math.max(...xs) - Math.min(...xs) < Math.max(...ys) - Math.min(...ys);
  const rec = (c: { x: number; y: number }) => (columnMode ? c.x : c.y);
  const fld = (c: { x: number; y: number }) => (columnMode ? c.y : c.x);

  // 件の位置は「都道府県」の欄の値（県の正式名）で決める。読む順: 列の向きは左から、行の向きは上から
  const prefLabel = labelOf("pref")!;
  const anchors = cells
    .filter((c) => isPrefName(c.n) && c !== prefLabel && Math.abs(fld(c) - fld(prefLabel)) < 20)
    .sort((a, b) => (columnMode ? rec(a) - rec(b) : rec(b) - rec(a)));
  if (anchors.length === 0) return { kind: "rows", rows: [] };
  // 件に割り当てる距離の上限: 件の間隔の半分強（間隔が分からない 1 件だけのときは 15）。外れる文字（欄外の注記など）は値にしない
  const gaps = anchors.slice(1).map((a, i) => Math.abs(rec(a) - rec(anchors[i]!)));
  const reach = gaps.length > 0 ? Math.min(...gaps) * 0.55 : 15;
  // 項目名の側（列の向きなら左、行の向きなら上）の文字は値ではない
  const labelSide = (c: { x: number; y: number }) => (columnMode ? c.x < rec(anchors[0]!) - reach : c.y > Math.max(...ys) - 2);
  const fieldLabels = labels.filter((l) => !GROUP_LABELS.has(l.n));

  const buckets = anchors.map(() => new Map<Field, Array<{ n: string; f: number; r: number }>>());
  for (const c of cells) {
    if (labels.includes(c) || GROUP_LABELS.has(c.n) || labelSide(c)) continue;
    let best = 0;
    for (let i = 1; i < anchors.length; i++) if (Math.abs(rec(c) - rec(anchors[i]!)) < Math.abs(rec(c) - rec(anchors[best]!))) best = i;
    if (Math.abs(rec(c) - rec(anchors[best]!)) > reach) continue;
    const label = fieldLabels.reduce((a, b) => (Math.abs(fld(c) - fld(b)) < Math.abs(fld(c) - fld(a)) ? b : a));
    const field = LABELS.find(([l]) => l === label.n)?.[1];
    if (!field) continue;
    const m = buckets[best]!;
    m.set(field, [...(m.get(field) ?? []), { n: c.n, f: fld(c), r: rec(c) }]);
  }

  const text = (m: Map<Field, Array<{ n: string; f: number; r: number }>>, f: Field): string | null => {
    const parts = m.get(f);
    if (!parts || parts.length === 0) return null;
    // つなぐ順: 列の向きは上から（y の大きい順）、行の向きは左から
    const sorted = [...parts].sort((a, b) => (columnMode ? b.f - a.f || a.r - b.r : a.f - b.f || b.r - a.r));
    const t = sorted.map((p) => p.n).join("");
    return DASH.has(t) ? null : t;
  };
  const rows: MoeTableRow[] = [];
  for (const m of buckets) {
    const no = text(m, "nationalNo");
    if (no !== null && !/^\d+例目$/u.test(no)) return { kind: "bad", reason: "national_no_unreadable" };
    rows.push({
      nationalNo: no === null ? null : Number(/^(\d+)/u.exec(no)![1]),
      collectedOn: text(m, "collectedOn") ?? "",
      prefecture: text(m, "pref") ?? "",
      municipality: text(m, "muni"),
      sample: text(m, "sample"),
      species: text(m, "species"),
      screening: text(m, "screening"),
      pathogenicity: text(m, "pathogenicity"),
      final: text(m, "final"),
      zoneFrom: text(m, "zoneFrom"),
      zoneTo: text(m, "zoneTo"),
    });
  }
  return { kind: "rows", rows };
}

/**
 * PDF の全ページを読む。次のときは失敗: 表のあるページが 1 つもない、件が 0、項目名のないページに県名がある、
 * 回収日や県が読めない件、見たことのない検査の言い方、番号のある件の段階が決まらない。
 */
export function parseMoeTable(items: readonly PdfItem[], season: Season = 2026): ParseResult {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const rows: MoeTableRow[] = [];
  let tables = 0;
  for (const p of pages) {
    const r = parsePage(items.filter((i) => i.page === p));
    if (r.kind === "no_table") continue;
    if (r.kind === "bad") return { ok: false, reason: r.reason };
    tables++;
    rows.push(...r.rows);
  }
  if (tables === 0) return { ok: false, reason: "no_table" };
  if (rows.length === 0) return { ok: false, reason: "no_rows" };
  for (const r of rows) {
    if (dateInSeason(r.collectedOn, season) === null || !/^\d{1,2}\/\d{1,2}$/u.test(r.collectedOn) || prefCodeOfName(r.prefecture) === null) return { ok: false, reason: "row_unreadable" };
    if ((r.pathogenicity !== null && !KNOWN_RESULT.test(r.pathogenicity)) || (r.final !== null && !KNOWN_RESULT.test(r.final))) return { ok: false, reason: "unknown_result_wording" };
    if (r.screening !== null && !KNOWN_SCREENING.test(r.screening)) return { ok: false, reason: "unknown_screening_wording" };
    // 番号は遺伝子検査で高病原性と分かった件につく（前季の 171 件すべて）。番号があるのに段階が決まらないのは読み違い
    if (r.nationalNo !== null && testOf(r) !== "hpai_confirmed") return { ok: false, reason: "numbered_row_not_confirmed" };
  }
  const nos = rows.map((r) => r.nationalNo).filter((n): n is number => n !== null);
  if (new Set(nos).size !== nos.length) return { ok: false, reason: "duplicate_national_no" };
  return { ok: true, rows };
}

/**
 * 検査の段階。最終判定が決まっていればそれを先に、検査中なら遺伝子検査を見る。
 * 陰性・高病原性でない → negative、高病原性 → hpai_confirmed、簡易陽性だけ → screening_positive。
 * どれでもない（簡易陰性で検査中など）は null（まだ陽性ではないので載せない）。
 */
export function testOf(r: Pick<MoeTableRow, "screening" | "pathogenicity" | "final">): WildBirdTest | null {
  const decided = (s: string | null): WildBirdTest | null => (s === null ? null : /陰性|高病原性でない/u.test(s) ? "negative" : /高病原性/u.test(s) ? "hpai_confirmed" : null);
  const fin = decided(r.final);
  if (fin !== null) return fin;
  const path = decided(r.pathogenicity);
  if (path !== null) return path;
  if (/陽性/u.test(r.screening ?? "")) return "screening_positive";
  return null;
}

/** "10/27" → 季の年で補った日付。6〜12 月は季の年、1〜5 月は翌年。暦にない日（2/30 など）は null */
export function dateInSeason(md: string | null, season: Season): IsoDate | null {
  const m = md === null ? null : /^(\d{1,2})\/(\d{1,2})/u.exec(md);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = month >= 6 ? season : season + 1;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as IsoDate;
}

/** 一覧の題の「令和8年11月6日現在」→ 2026-11-06。なければ null */
export function asOfFromTitle(title: string): IsoDate | null {
  const m = /令和(\d+)年(\d+)月(\d+)日現在/u.exec(title.normalize("NFKC").replace(/\s+/gu, ""));
  if (!m) return null;
  const y = Number(m[1]) + 2018;
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d.toISOString().slice(0, 10) as IsoDate;
}

/** 番号は「野鳥国内 N 例目」で決める。番号のない件は回収日、県、市町村、種から */
export function tableBirdId(season: Season, r: Pick<MoeTableRow, "nationalNo" | "collectedOn" | "prefecture" | "municipality" | "species">): string {
  if (r.nationalNo !== null) return `wb-moe-${season}-${r.nationalNo}`;
  const h = createHash("sha256").update([season, r.collectedOn, r.prefecture, r.municipality ?? "", r.species ?? ""].join("|")).digest("hex").slice(0, 16);
  return `wb-moe-${season}-x${h}`;
}
const NUMBERED = (season: Season) => new RegExp(`^wb-moe-${season}-\\d+$`, "u");
const TABLE_PREFIX = (season: Season) => `wb-moe-${season}-`;

/** 表の 1 件を wildBirds の 1 件にする。まだ陽性でない件（検査中で簡易陰性など）は null */
export function rowToWildBird(r: MoeTableRow, season: Season, geo: GeoStore, sourceUrl: string): WildBird | null {
  const test = testOf(r);
  const date = dateInSeason(r.collectedOn, season);
  const prefCode = prefCodeOfName(r.prefecture);
  if (test === null || date === null || prefCode === null) return null;
  const core = r.municipality === null ? null : muniCoreName(r.municipality);
  const muniCode = core === null ? null : findMuniByName(prefCode, core, geo);
  // 種名の欄が「ー」のときは検体の種類（環境試料（水）など）を種の欄に出す
  const species = r.species ?? r.sample;
  return {
    id: tableBirdId(season, r),
    season,
    date,
    prefCode,
    muniCode,
    muniName: muniCode === null ? core : (geo.index[muniCode]?.name ?? core),
    species,
    test,
    focusZone: { from: dateInSeason(r.zoneFrom, season), to: r.zoneTo !== null && /解除/u.test(r.zoneTo) && !/予定/u.test(r.zoneTo) ? dateInSeason(r.zoneTo, season) : null },
    sourceUrl,
  };
}

const DAY = 86_400_000;
const dayDiff = (a: IsoDate, b: IsoDate): number => (Date.parse(a) - Date.parse(b)) / DAY;

/**
 * 読み取り（報道発表など）から作った記録 old が、表の件 t と同じものになりうるか。
 * 同じ県、同じ市町村（名前の芯）、種が両方あって同じ、日付が回収日の 7 日前〜10 日後（読み取りは結果の日を取ることがある）。
 */
export function sameEvent(t: Pick<WildBird, "prefCode" | "muniName" | "species" | "date">, old: Pick<WildBird, "prefCode" | "muniName" | "species" | "date">): boolean {
  if (t.prefCode !== old.prefCode) return false;
  if (t.muniName === null || old.muniName === null || muniCoreName(t.muniName) !== muniCoreName(old.muniName)) return false;
  if (t.species === null || old.species === null || t.species !== old.species) return false;
  const d = dayDiff(old.date, t.date);
  return d >= -7 && d <= 10;
}

/** wildBirds の読み書き（試験で差し替える） */
export interface WildBirdIo {
  listSeason(season: Season): Promise<WildBird[]>;
  set(b: WildBird): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SyncReport = { ok: true; written: string[]; removed: string[]; unchanged: number } | { ok: false; reason: string; missing: string[] };

/** 項目の並び順によらない比べ */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * 表の件を wildBirds に書く（変わったものだけ）。書く前に、前に書いた番号のある件が今回もすべてあるかを確かめ、なければ何も書かずに失敗を返す。
 * - 表から消えた番号のない件（後から番号がついた、訂正された）は消す。
 * - 読み取りから作った同じ件の記録は消す。ただし、一覧の時点（asOf）より後の日付の記録は、表にまだ載っていない新しい件かもしれないので消さない。
 *   asOf が分からなければ、読み取りの記録は消さない。1 つの表の件に対して消すのは、日付の最も近い 1 件だけ。
 */
export async function syncWildBirdTable(birds: readonly WildBird[], season: Season, io: WildBirdIo, asOf: IsoDate | null): Promise<SyncReport> {
  const existing = await io.listSeason(season);
  const ids = new Set(birds.map((b) => b.id));
  const missing = existing.filter((b) => NUMBERED(season).test(b.id) && !ids.has(b.id)).map((b) => b.id);
  if (missing.length > 0) return { ok: false, reason: "numbered_rows_disappeared", missing };

  const byId = new Map(existing.map((b) => [b.id, b]));
  const written: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  for (const b of birds) {
    const cur = byId.get(b.id);
    if (cur && canonical(cur) === canonical(b)) unchanged++;
    else {
      await io.set(b);
      written.push(b.id);
    }
  }
  for (const old of existing) {
    if (old.id.startsWith(TABLE_PREFIX(season)) && !NUMBERED(season).test(old.id) && !ids.has(old.id)) {
      await io.remove(old.id);
      removed.push(old.id);
    }
  }
  if (asOf !== null) {
    const readings = existing.filter((b) => !b.id.startsWith("wb-moe-") && b.date <= asOf);
    const claimed = new Set<string>();
    for (const t of birds) {
      const match = readings
        .filter((r) => !claimed.has(r.id) && sameEvent(t, r))
        .sort((a, b) => Math.abs(dayDiff(a.date, t.date)) - Math.abs(dayDiff(b.date, t.date)))[0];
      if (!match) continue;
      claimed.add(match.id);
      await io.remove(match.id);
      removed.push(match.id);
    }
  }
  return { ok: true, written, removed, unchanged };
}

/** 確かめに使う: 市町村の番号が引けなかった件の数 */
export const unmatchedMuni = (birds: readonly WildBird[]): number => birds.filter((b) => b.muniCode === null).length;
