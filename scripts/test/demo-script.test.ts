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

  it("冒頭の課題は、家保の速報を全国の俯瞰と過去で補う形", () => {
    const head = doc.slice(0, doc.indexOf("|"));
    for (const w of ["家保", "県外や海外", "全国の俯瞰", "過去", "他人事", "怖い思い"]) expect(head, w).toContain(w);
  });

  it("場面の並びは、導入、自分の村の過去、去年の波、備えの切り替えの順で、場面 5〜8 は保つ", () => {
    expect(scenes.map((r) => r[0])).toEqual([
      "場面 1 導入",
      "場面 2 自分の村の過去",
      "場面 3 去年の波が近づく（山場）",
      "場面 4 備えの切り替え",
      "場面 5 記録と報告文",
      "場面 6 近隣の方へ",
      "場面 7 舞台裏と MCP",
      "場面 8 開発とこれから",
    ]);
  });

  it("場面 2 は /area で約 60 km 以内の表と 3,000 羽未満の件数を見せ、全国の件数と分けて語る", () => {
    const r = scenes[1]!;
    expect(r[1]).toContain("/area/");
    expect(r[2]).toContain("約 60 km 以内");
    expect(r[2]).toContain("測り方が違う");
    expect(r[3]).toMatch(/全国では[^」]*3,000 羽未満の農場で 15 件/u);
  });

  it("場面 3 は全国の流れで、輪は発表の区域ではないと語る", () => {
    const r = scenes[2]!;
    expect(r[1]).toContain("/replay");
    expect(r[2]).toContain("全国の流れ");
    for (const w of ["姫路市", "約 28 km", "津山市", "約 16 km", "輪は距離の目安で、発表の区域ではありません", "県の連絡が正です"]) expect(r[3], w).toContain(w);
  });

  it("場面 4 は段階の切り替えの基準を農場が決めると語り、4 事例と見本の農場を通す", () => {
    const r = scenes[3]!;
    expect(r[1]).toContain("/replay");
    expect(r[1]).toContain("/sample/todo");
    expect(r[2]).toContain("12 月の 4 事例");
    for (const w of ["消毒", "働く人への注意喚起", "車両の消毒", "コロナ", "作品が決めず、農場が決めます", "下書き"]) expect(r[3], w).toContain(w);
  });

  it("場面 7 に毎朝の全国まとめ（定型と総括 1 文。合わなければ定型だけ）がある", () => {
    const r = scenes[6]!;
    expect(r[3]).toContain("総括");
    expect(r[3]).toContain("定型だけを送ります");
    expect(r[2]).toContain("作り物のメールを本物のように映さない");
  });

  it("村の名前を書かない（台本は作者の村と書く）", () => {
    expect(doc).not.toMatch(/西粟倉/u);
    expect(doc).toContain("作者の村");
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
