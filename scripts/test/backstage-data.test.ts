// 舞台裏のデータ（data/replay/{docs,backstage,measured-usage}.json）の検査。公開してよい data/ と docs/ だけを読む。
// 実物の読み取りは有料で、利用者が支払いの上限を置くまで行わない。測っていない間は「未計測」と分かる形で置く（作り話を入れない）。
// 測った後は、同じ検査器（checkBackstageData）が簡単でない規則（tamperedDemo、市町村と日付の一致）を見る。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BackstageFile, MeasuredUsage, ReplayScenario } from "@hpai/shared/replay";
import { isPrefDomainHost } from "@hpai/shared/pref";
import { findForbiddenPhrases, findWordingViolations } from "@hpai/shared/wording";
import { checkBackstageData, UNMEASURED_BACKSTAGE, UNMEASURED_USAGE, type DocsFile } from "../lib/backstage";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const readJson = <T,>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as T;
const docsFile = readJson<DocsFile>("data/replay/docs.json");
const backstage = readJson<BackstageFile>("data/replay/backstage.json");
const usage = readJson<MeasuredUsage>("data/replay/measured-usage.json");
const scenario = readJson<ReplayScenario>("data/replay/scenario.json");
const usageDoc = fs.readFileSync(path.join(ROOT, "docs", "api-credit-usage.md"), "utf8");

function* keys(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keys(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keys(x);
    }
}

describe("docs.json（読む文書の一覧）", () => {
  const docs = docsFile.docs;

  it("津山の 6 件（疑い、確定、進捗、防疫措置の完了、搬出解除、移動解除）と、米子、姫路、亀岡の国の発表、姫路市のページ", () => {
    expect(docs).toHaveLength(10);
    const tsuyama = docs.filter((d) => d.expect.muniCode === "33203");
    expect(tsuyama.map((d) => d.expect.kind)).toEqual(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "zone_lifted"]);
    expect(tsuyama.map((d) => d.expect.primaryStage)).toEqual(["suspected", "confirmed", null, "control_done", "shipment_lifted", "movement_lifted"]);
    for (const code of ["31202", "28201", "26206"]) {
      expect(docs.filter((d) => d.expect.muniCode === code && d.url.includes("maff.go.jp")).length, code).toBe(1);
    }
    expect(docs.filter((d) => new URL(d.url).hostname === "www.city.himeji.lg.jp")).toHaveLength(1);
  });

  it("id は一意で、控えのファイル名に使える。出典は https で、国・県・姫路市のページだけ", () => {
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    for (const d of docs) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
      const u = new URL(d.url);
      expect(u.protocol, d.id).toBe("https:");
      const host = u.hostname;
      expect(host === "www.maff.go.jp" || host === "www.city.himeji.lg.jp" || isPrefDomainHost(host), `${d.id} ${host}`).toBe(true);
    }
  });

  it("県のページ（岡山県）の文書だけ sourcePrefCode が 33。国と市のページは null（引用に県名が要る）", () => {
    for (const d of docs) {
      const host = new URL(d.url).hostname;
      expect(d.sourcePrefCode, d.id).toBe(host === "www.pref.okayama.jp" ? "33" : null);
    }
  });

  it("scenario の出来事に結びつく文書は、市町村と日付が出来事と一致する。発表日は出来事の日", () => {
    for (const d of docs) {
      if (d.eventOrder === null) continue;
      const e = scenario.events.find((x) => x.order === d.eventOrder);
      expect(e, d.id).toBeDefined();
      expect(d.expect.muniCode, d.id).toBe(e!.caseAfter.muniCode);
      expect(d.expect.primaryDate, d.id).toBe(e!.date);
      expect(d.announcedOn, d.id).toBe(e!.date);
    }
    // 出来事に結びつくのは、出典がその文書そのものの出来事だけ（国の事例一覧の PDF を出典にする出来事は結びつけない）
    for (const d of docs.filter((x) => x.eventOrder !== null)) {
      expect(scenario.events.find((x) => x.order === d.eventOrder)!.sourceUrl, d.id).toBe(d.url);
    }
    const orders = docs.flatMap((d) => (d.eventOrder === null ? [] : [d.eventOrder]));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("expectVerifyFail を書いた文書は、日付の項目だけで、理由の文があり、禁句を含まない（津山の疑いと確定）", () => {
    const flagged = docs.filter((d) => d.expect.expectVerifyFail !== undefined);
    expect(flagged.map((d) => d.id)).toEqual(["tsuyama-suspected", "tsuyama-confirmed"]);
    for (const d of flagged) {
      expect(d.expect.expectVerifyFail, d.id).toEqual(["primaryDate"]);
      expect(d.expect.primaryDate, d.id).toBeTruthy(); // 読みの比べ先
      const note = d.expect.verifyFailNote ?? "";
      expect(note.length, d.id).toBeGreaterThan(0);
      expect(note.length, d.id).toBeLessThanOrEqual(80);
      expect(findWordingViolations(note), d.id).toEqual([]);
      expect(findForbiddenPhrases(note), d.id).toEqual([]);
    }
  });

  it("本文や引用を持たない（quote のキーがなく、長い文を置かない）", () => {
    expect([...keys(docsFile)]).not.toContain("quote");
    for (const d of docs) {
      expect(d.title.length, d.id).toBeLessThanOrEqual(80);
    }
  });
});

describe("backstage.json と measured-usage.json", () => {
  it("quote のキーがない", () => {
    expect([...keys(backstage)]).not.toContain("quote");
  });

  it("測っていない間は『未計測』の形（空の entries、時刻 null、使用量 0）。測った後は検査器の規則をすべて満たす", () => {
    expect(checkBackstageData({ docs: docsFile, backstage, usage, scenario })).toEqual([]);
  });

  it("状態は 2 つのファイルで揃っている", () => {
    expect(backstage.status).toBe(usage.status);
    if (backstage.status === "unmeasured") {
      expect(backstage).toMatchObject({ entries: [], measuredAt: null });
      expect(usage).toMatchObject({ documents: 0, byModel: {}, measuredAt: null });
      expect(backstage).toEqual(UNMEASURED_BACKSTAGE);
      expect(usage).toEqual(UNMEASURED_USAGE);
    }
  });

  it("scenario の backstageId はすべて backstage.json の項目を指す（測る前はすべて null）", () => {
    const ids = new Set(backstage.entries.map((e) => e.id));
    for (const e of scenario.events) if (e.backstageId !== null) expect(ids.has(e.backstageId), `order ${e.order}`).toBe(true);
    if (backstage.status === "unmeasured") expect(scenario.events.every((e) => e.backstageId === null)).toBe(true);
  });
});

describe("docs/api-credit-usage.md", () => {
  it("表の列は 日付、用途、モデル、トークン数、推定費用 のまま", () => {
    expect(usageDoc).toContain("| 日付 | 用途 | モデル | トークン数 | 推定費用 |");
  });

  it("測っていないときは『未計測』と書き、計測の手順（--yes、支払いの上限）を書く。表に数字の行を作らない", () => {
    if (backstage.status === "unmeasured") {
      expect(usageDoc).toContain("未計測");
      expect(usageDoc).toContain("scripts/build-backstage.ts");
      expect(usageDoc).toContain("--yes");
      expect(usageDoc).toContain("支払いの上限");
      const rows = usageDoc.split("\n").filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
      expect(rows).toEqual([]);
    }
  });
});
