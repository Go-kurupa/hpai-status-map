// 全国の傾向の深掘りの集計（設計書 2026-11-06-trends-redesign）。Claude は呼ばない。
//
//   npx tsx scripts/build-trends-insights.ts   … data/private/survey-extract.json と data/history/cases.json から data/trends/insights.json を書く
//
// 実行の本体は scripts/lib/trends-insights.ts。公開前の検査に落ちたら書かない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJstIso } from "@hpai/shared/dates";
import { aggregateInsights, checkInsights, noticingFromSummary, type CaseRow } from "./lib/trends-insights";
import type { SurveyExtractRow } from "./lib/trends";
import type { NoticingSummary } from "./lib/trends-noticing";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

const rows = read<{ rows: SurveyExtractRow[] }>("data/private/survey-extract.json").rows;
const cases = read<CaseRow[]>("data/history/cases.json");
const muni = read<Record<string, { name: string }>>("data/geo/muni-index.json");
const base = aggregateInsights(rows, cases, toJstIso(new Date()));
// 段階 2 の抽出（作者の了承の後に有料で実行）の集計があれば足す。無ければ「どう気づいたか」は出ない
const noticingFile = path.join(ROOT, "data", "private", "noticing-summary.json");
const insights = fs.existsSync(noticingFile) ? { ...base, noticing: noticingFromSummary(read<NoticingSummary>("data/private/noticing-summary.json")) } : base;
const errors = checkInsights(insights, [...new Set(Object.values(muni).map((m) => m.name))]);
if (errors.length > 0) {
  console.error(["公開前の検査に落ちたので書きません:", ...errors].join("\n"));
  process.exit(1);
}
const out = path.join(ROOT, "data", "trends", "insights.json");
fs.writeFileSync(out, `${JSON.stringify(insights, null, 2)}\n`);
console.log(`${path.relative(ROOT, out)} に書きました（読めた概要 ${insights.total.surveyed} 件）。`);
