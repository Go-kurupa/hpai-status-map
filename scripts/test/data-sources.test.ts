import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOC = path.resolve(import.meta.dirname, "..", "..", "docs", "data-sources.md");
const doc = fs.readFileSync(DOC, "utf8");

/** `## <from>` から次の `## <to>` の手前まで（to が無ければ最後まで）。 */
function section(from: string, to?: string): string {
  const start = doc.indexOf(`## ${from}`);
  expect(start, `「## ${from}」の節がありません`).toBeGreaterThanOrEqual(0);
  const end = to ? doc.indexOf(`## ${to}`, start) : -1;
  return doc.slice(start, end >= 0 ? end : undefined);
}

describe("docs/data-sources.md の N03 の節", () => {
  // 契約 0 章: N03 の測量法の手続きを「不要と確認した」と書かない
  const sec = section("N03 の出典と加工", "地理院タイル");

  it("出典、加工、利用条件、問い合わせの状況が書かれている", () => {
    for (const s of ["CC BY 4.0", "簡略化", "KsjTmplt-N03-2026.html", "R 7JHf 351", "Q1-24", "Q1-11"]) {
      expect(sec).toContain(s);
    }
    expect(sec).toMatch(/確かめた日（\d{4}-\d{2}-\d{2}）/);
    expect(sec).toMatch(/問い合わせ済み（\d{4}-\d{2}-\d{2}）|確認中/);
  });

  it("手続きが不要だとは書かない", () => {
    expect(sec).not.toMatch(/(不要と確認|手続きは不要|申請不要)/);
    expect(sec).not.toMatch(/手続き.{0,6}不要/);
  });

  it("簡略化の値と、0.85km が半対角と 30m を覆うこと（§19）がある", () => {
    for (const s of ["1.5%", "interval=30", "0.85km", "30m", "§19"]) expect(sec).toContain(s);
  });

  it("2 つの節（出典と加工／利用条件）に分かれ、加工済みの出典の文がある", () => {
    expect(sec).toContain("## N03 の出典と加工");
    expect(sec).toContain("## N03 の利用条件");
    expect(sec).toContain("国土数値情報「行政区域データ N03 2026 年版」をもとに、形の簡略化、政令市の区の統合、隣り合いの計算を行って作成");
  });

  it("手続きの要否は確認できていない、と判断の文がそのまま残っている", () => {
    expect(sec).toContain("手続きの要否は確認できていない");
    expect(sec).toContain("明記された CC BY 4.0 に従って公開する判断をした");
  });
});

describe("docs/data-sources.md の地理院タイルの節", () => {
  const sec = section("地理院タイル");
  it("一覧ページへのリンクと VMAP0 の出所の文がある", () => {
    expect(sec).toContain("ichiran.html");
    expect(sec).toContain("Vector Map Level 0");
  });
  it("リアルタイム読み込みは出典の明示のみで申請不要（公式の文）", () => {
    expect(sec).toContain("出典の明示のみで申請不要");
  });
  it("アクセス数の上限は未確認と書く", () => {
    expect(sec).toMatch(/アクセス数.{0,20}未確認/);
  });
});
