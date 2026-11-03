// 前季（2025 シーズン）の国の報道発表の控えで、国との突き合わせの入力が揃うことを確かめる（I-18）。
// 控えは scripts/fetch-maff-fixtures.ts が data/private/fixtures/maff/ に置く（公開しない）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterMaffItems } from "@hpai/shared/read/maff";
import { appOnlyConfirmed, liftGaps, missingNationalNos, nationalConfirmedNos, nationalListUrls, parseNationalFact, type NationalFact, type NationalLiftFact } from "@hpai/shared/read/reconcile";
import type { Case, HistoryCase } from "@hpai/shared/types";
import { decodeBody, extractHtml } from "../src/watch/extract";
import { describeFixture } from "./helpers/fixtures";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/private/fixtures/maff");
const MONTHS = ["2510", "2511", "2512", "2601", "2602", "2603", "2604"];
const LIST_FILES = MONTHS.map((m) => path.join(DIR, `arc-${m}.html`));
const CASES_JSON = path.join(ROOT, "data/history/cases.json");

const readPage = (file: string, url: string) => extractHtml(decodeBody(fs.readFileSync(file), "text/html"), url);

describeFixture("国の月別一覧 7 ページの本文の控え（国との突き合わせ）", [...LIST_FILES, CASES_JSON], () => {
  const links = MONTHS.flatMap((m) => readPage(path.join(DIR, `arc-${m}.html`), `https://www.maff.go.jp/j/press/arc/${m}.html`).links);
  const items = filterMaffItems(links);
  const facts = items.map((i) => parseNationalFact(i, readPage(path.join(DIR, path.basename(new URL(i.url).pathname)), i.url).text));
  const prev = (JSON.parse(fs.readFileSync(CASES_JSON, "utf8")) as HistoryCase[]).filter((h) => h.season === 2025 && !h.related);
  const asCase = (h: HistoryCase): Case => ({
    id: `h${h.season}-${h.no}`,
    season: h.season,
    nationalNo: h.no,
    prefNo: null,
    prefCode: h.prefCode,
    muniCode: h.muniCode,
    muniName: h.muniNameThen,
    birdUse: h.birdUse,
    housing: h.housing,
    headCount: h.headCount,
    stages: { confirmed: { date: h.date, time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [h.sourceUrl],
    updatedAt: `${h.date}T12:00:00+09:00`,
  });

  it("45 本の発表がすべて読め、国の確定の N が 1〜24 の 24 事例で埋まる", () => {
    expect(items.filter((_, i) => facts[i] === null).map((i) => i.url)).toEqual([]);
    const all = facts as NationalFact[];
    expect([...nationalConfirmedNos(all, 2025)].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("作品に 24 事例がなければ 24 件とも欠け、揃っていれば欠けも国にない確定もない", () => {
    const all = facts as NationalFact[];
    const nos = nationalConfirmedNos(all, 2025);
    expect(missingNationalNos(nos, [], 2025)).toHaveLength(24);
    const cases = prev.map(asCase);
    expect(cases).toHaveLength(24);
    expect(missingNationalNos(nos, cases, 2025)).toEqual([]);
    expect(appOnlyConfirmed(cases, nos, 2025, new Date("2026-05-31T12:00:00+09:00"))).toEqual([]);
  });

  it("解除 21 本のうち、解除の段階のない事例に当たるものがすべて再適用の候補になる", () => {
    const lifts = (facts as NationalFact[]).filter((f): f is NationalLiftFact => f.type === "movement_lifted");
    expect(lifts).toHaveLength(21);
    expect(liftGaps(lifts, prev.map(asCase), 2025)).toHaveLength(21);
  });

  it("見る一覧: 5 月中旬は新着の一覧と 2510〜2604 の月別の一覧", () => {
    const urls = nationalListUrls(new Date("2026-05-15T03:00:00Z"));
    expect(urls.slice(1).map((u) => u.match(/arc\/(\d{4})\.html/)![1])).toEqual(MONTHS);
  });
});
