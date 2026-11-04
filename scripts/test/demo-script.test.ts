// docs/demo-script.md の試験。設計書の「デモの筋」の 8 場面が、実在する試験名と結びついていること。
// 場面 2〜7 は web/e2e/demo-walkthrough.spec.ts の試験名を指し、場面 1 と 8 は語りのみ。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findWordingViolations } from "@hpai/shared/wording";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const doc = fs.readFileSync(path.join(ROOT, "docs", "demo-script.md"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "web", "e2e", "demo-walkthrough.spec.ts"), "utf8");

/** 場面 N の試験名（場面 2〜7）。 */
const specTitles = new Map<number, string>(
  [...spec.matchAll(/test\("(場面 ([2-7]): [^"]+)"/gu)].map((m) => [Number(m[2]), m[1]!] as const),
);

/** 表の行（見出しと区切りを除く）を、セルの配列にする。 */
const tableRows = (text: string): string[][] =>
  text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*:?-/u.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/gu, "").split("|").map((c) => c.trim()));

const rows = tableRows(doc);
const header = rows[0] ?? [];
const scenes = rows.slice(1);

describe("docs/demo-script.md", () => {
  it("元にする試験に、場面 2〜7 の名前がある（空の走査で通らない）", () => {
    expect([...specTitles.keys()].sort()).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("冒頭に『誰の、どんな課題を、どう解決するか』がある（表より前）", () => {
    const head = doc.slice(0, doc.indexOf("|"));
    expect(head).toContain("誰の");
    expect(head).toContain("どんな課題を");
    expect(head).toContain("どう解決");
  });

  it("表の列は URL、操作、語り、確かめること（場面の列を先頭に持つ）", () => {
    expect(header).toEqual(["場面", "URL", "操作", "語り", "確かめること"]);
  });

  it("8 つの場面が順に並ぶ", () => {
    expect(scenes).toHaveLength(8);
    scenes.forEach((r, i) => expect(r[0], `${i + 1} 行目`).toMatch(new RegExp(`^場面 ${i + 1}\\b`, "u")));
    for (const r of scenes) {
      expect(r).toHaveLength(5);
      for (const c of r) expect(c, r[0]).not.toBe("");
    }
  });

  it.each([2, 3, 4, 5, 6, 7])("場面 %i は、demo-walkthrough.spec.ts の試験名をそのまま指す", (n) => {
    const row = scenes[n - 1]!;
    expect(row[4]).toContain(specTitles.get(n)!);
  });

  it.each([1, 8])("場面 %i は語りのみ", (n) => {
    expect(scenes[n - 1]![4]).toContain("語りのみ");
  });

  it("場面 2〜7 の URL は、登録なしの経路（/ から始まる）", () => {
    for (const n of [2, 3, 4, 5, 6, 7]) expect(scenes[n - 1]![1], `場面 ${n}`).toMatch(/`\//u);
  });

  it("映さないものの一覧がある", () => {
    const sec = doc.slice(doc.indexOf("映さないもの"));
    for (const w of ["農場の正確な位置", "働く人", "取引先", "発送先", "本番の会員データ", "鍵", "ブラウザの保存パスワード", "メール"]) {
      expect(sec, w).toContain(w);
    }
    expect(sec).toContain("役場の近くのマス目");
  });

  it("撮る前の確認（場面 7 が skip でないこと、帯と仮の地点、数字が実測か）がある", () => {
    for (const w of ["skip", "去年の再現です", "仮の地点", "実測"]) expect(doc, w).toContain(w);
  });

  it("MCP の場面は本番の接続で撮る", () => {
    expect(doc).toMatch(/MCP[^\n]*本番/u);
  });

  it("まだ起きていないことを、事実のように書かない（使い続けます）。去年 12 月には 2025 年 12 月を併記する", () => {
    expect(doc).not.toMatch(/使い続けます|使い続ける/u);
    for (const m of doc.matchAll(/去年 12 月/gu)) {
      expect(doc.slice(m.index!, m.index! + 30), "去年 12 月").toContain("2025 年 12 月");
    }
  });

  it("禁句、効果の数字、内部の言葉、電話番号の形がない", () => {
    expect(findWordingViolations(doc)).toEqual([]);
    expect(doc).not.toMatch(/削減|短縮|\d+(?:\.\d+)?\s*倍/u);
    expect(doc).not.toMatch(/\b[FIMWX]-\d{2}\b|本体|部下|索引|契約|人の作業|\bQ\d{1,2}\b|§/u);
    expect(doc).not.toMatch(/0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}/u);
    expect(doc).not.toMatch(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u);
  });

  it("リンクの先が実在する", () => {
    for (const m of doc.matchAll(/\]\(([^)\s]+)\)/gu)) {
      const l = m[1]!;
      if (/^(https?:|mailto:|#)/u.test(l)) continue;
      expect(fs.existsSync(path.resolve(ROOT, "docs", decodeURIComponent(l.split("#")[0]!))), l).toBe(true);
    }
  });
});
