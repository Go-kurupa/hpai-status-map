// 過去 6 シーズンの事例を市町村に対応づける（F-08）。入力は private/research/cases-6seasons.json（読むだけ）。
import { findMuniByName, type GeoStore } from "@hpai/shared/geo";
import { prefCodeOfName } from "@hpai/shared/pref";
import { normalizeForMatch } from "@hpai/shared/text";
import type { HistoryCase, MuniCode } from "@hpai/shared/types";

/** 手元の調査の 1 行。season は文字列（"2020"）で入っている。note は持ち越さない。 */
export interface RawCase {
  season: string | number;
  no: number;
  pref: string;
  municipality: string;
  date: string;
  bird: string | null;
  housing: string | null;
  count: number | null;
  source: string;
  related: boolean;
  note?: string;
}

const isStrOrNull = (x: unknown): boolean => x === null || typeof x === "string";

/** JSON を RawCase[] として読む。形が違う行は位置を添えて throw する。 */
export function parseRawCases(json: unknown): RawCase[] {
  if (!Array.isArray(json)) throw new Error("事例の一覧が配列ではありません");
  return json.map((x: unknown, i) => {
    const r = x as Record<string, unknown> | null;
    const ok =
      !!r &&
      (typeof r.season === "string" || typeof r.season === "number") &&
      Number.isInteger(r.no) &&
      typeof r.pref === "string" &&
      typeof r.municipality === "string" &&
      typeof r.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      isStrOrNull(r.bird) &&
      isStrOrNull(r.housing) &&
      (r.count === null || typeof r.count === "number") &&
      typeof r.source === "string" &&
      typeof r.related === "boolean";
    if (!ok) throw new Error(`${i} 行目の形が違います: ${JSON.stringify(x)}`);
    return x as RawCase;
  });
}

/** (season, related, no) の順に整える。同じ値は入力の順を保つ（安定ソート）。 */
export function sortHistory(rows: readonly HistoryCase[]): HistoryCase[] {
  return [...rows].sort((a, b) => a.season - b.season || Number(a.related) - Number(b.related) || a.no - b.no);
}

/**
 * 県と市町村の名前から市町村コードを引き、HistoryCase にする。
 * 対応しない行（知らない県、知らない町、同名が複数）は unmatched に出す。推測では決めない。
 * nameMap のキーは原本の綴りのまま `県|市町村`（ヶ と ケ は別のキーで同じコード）。
 */
export function buildHistory(
  rows: readonly RawCase[],
  geo: GeoStore,
): { cases: HistoryCase[]; nameMap: Record<string, MuniCode>; unmatched: RawCase[] } {
  const cases: HistoryCase[] = [];
  const unmatched: RawCase[] = [];
  const found = new Map<string, MuniCode>();
  for (const r of rows) {
    const season = Number(r.season);
    if (!Number.isInteger(season)) throw new Error(`season が数ではありません: ${JSON.stringify(r.season)}（${r.pref} ${r.municipality}）`);
    const prefCode = prefCodeOfName(r.pref);
    const muniCode = prefCode === null ? null : findMuniByName(prefCode, r.municipality, geo);
    if (prefCode === null || muniCode === null) {
      unmatched.push(r);
      continue;
    }
    found.set(`${r.pref}|${r.municipality}`, muniCode);
    cases.push({
      season,
      no: r.no,
      prefCode,
      muniCode,
      muniNameThen: r.municipality,
      date: r.date,
      birdUse: r.bird,
      housing: r.housing,
      headCount: r.count,
      sourceUrl: r.source,
      related: r.related,
    });
  }
  const nameMap = Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { cases: sortHistory(cases), nameMap, unmatched };
}

/** unmatched.md の中身。0 件でも「対応づかない事例: 0 件」を書く。 */
export function renderUnmatchedMd(unmatched: readonly RawCase[]): string {
  const lines = ["# 対応づかない事例", "", `対応づかない事例: ${unmatched.length} 件`, ""];
  if (unmatched.length > 0) {
    lines.push("県と市町村の名前が、data/geo の市町村に 1 つだけ対応しなかった行です。推測では決めていません。", "");
    lines.push("| シーズン | 番号 | 県 | 市町村 | 発生日 | 出典 |", "|---|---|---|---|---|---|");
    for (const r of unmatched) lines.push(`| ${r.season} | ${r.no} | ${r.pref} | ${r.municipality} | ${r.date} | ${r.source} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export interface MissingInSource {
  row: HistoryCase;
  reason: "no_text" | "name_not_found";
}

/**
 * 出典の PDF の文字層に、各行の muniNameThen があるか。両方を normalizeForMatch に通して比べる。
 * 文字層を取っていない出典の行は no_text。見つからない行を返す（空なら全行で見つかった）。
 */
export function findMissingInSources(rows: readonly HistoryCase[], textBySource: ReadonlyMap<string, string>): MissingInSource[] {
  const normalized = new Map<string, string>();
  for (const [url, text] of textBySource) normalized.set(url, normalizeForMatch(text));
  const missing: MissingInSource[] = [];
  for (const row of rows) {
    const text = normalized.get(row.sourceUrl);
    if (text === undefined) missing.push({ row, reason: "no_text" });
    else if (!text.includes(normalizeForMatch(row.muniNameThen))) missing.push({ row, reason: "name_not_found" });
  }
  return missing;
}
