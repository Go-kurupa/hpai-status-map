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

  it("簡略化の値と、0.85km が半対角と 30m を覆うこと（限界）がある", () => {
    for (const s of ["1.5%", "interval=30", "0.85km", "30m", "限界"]) expect(sec).toContain(s);
  });

  it("2 つの節（出典と加工／利用条件）に分かれ、加工済みの出典の文がある", () => {
    expect(sec).toContain("## N03 の出典と加工");
    expect(sec).toContain("## N03 の利用条件");
    expect(sec).toContain("国土数値情報「行政区域データ N03 2026 年版」をもとに、この作品の作者が形の簡略化、政令市の区の統合、隣り合いの計算を行って作成");
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

describe("docs/data-sources.md の国と県の公開文書の利用条件", () => {
  const sec = section("国と県の公開文書の利用条件");
  it("農林水産省、環境省、厚生労働省は公共データ利用規約（第1.0版）（PDL1.0）。確かめた URL と日付がある", () => {
    expect(sec).toContain("公共データ利用規約（第1.0版）（PDL1.0）");
    for (const url of ["https://www.maff.go.jp/j/use/link.html", "https://www.env.go.jp/mail.html", "https://www.mhlw.go.jp/chosakuken/index.html"]) {
      expect(sec, url).toContain(url);
    }
    expect(sec.match(/確かめた日 2026-11-04/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
  it("出典の記載、加工の記載、国が作ったかのように見せないこと、を書く", () => {
    for (const s of ["出典", "加工したこと", "あたかも国"]) expect(sec, s).toContain(s);
  });
  it("e-Gov のサイトの利用規約は未確認。条文は著作権法第 13 条", () => {
    expect(sec).toMatch(/e-Gov[^\n]*利用規約[^\n]*未確認/u);
    expect(sec).toContain("著作権法第 13 条");
    expect(sec).toContain("https://laws.e-gov.go.jp/");
  });
  it("県のサイトポリシー: 確かめた 1 県の記述と、ほかの県は未確認", () => {
    expect(sec).toContain("https://www.pref.okayama.jp/page/detail-4318.html");
    expect(sec).toMatch(/ほかの県は未確認/u);
  });
  it("CC BY との互換や、政府標準利用規約への準拠、とは書かない（どのページも言っていない）", () => {
    expect(sec).not.toMatch(/互換(性)?(が|は)?(ある|あります|です)/u);
    expect(sec).toMatch(/CC BY との互換については何も書いていない/u);
    expect(sec).toMatch(/互換を前提にしない/u);
  });
});

describe("docs/data-sources.md の渡りの経路図の節", () => {
  const sec = section("渡りの経路図（data/migration/routes/）", "過去の事例");
  it("出典の URL、規約の URL、確かめた日がある", () => {
    for (const s of ["環境省「渡り鳥の飛来経路について」", "wataridori_hiraikeiro.html", "https://www.env.go.jp/mail.html", "PDL1.0", "確かめた日 2026-11-05"]) {
      expect(sec, s).toContain(s);
    }
  });
  it("改変しないこと。個別の追跡の図は載せず、リンクで案内すること", () => {
    for (const s of ["改変", "無断転用不可", "migration_route.html", "リンク"]) expect(sec, s).toContain(s);
  });
  it("解けていない点を未確認と書く（国土地理院の地図、追跡の受託、All Rights Reserved）", () => {
    expect(sec).toMatch(/国土地理院[^\n]*\*\*未確認\*\*/u);
    expect(sec).toMatch(/東京大学[^\n]*\*\*未確認\*\*/u);
    expect(sec).toMatch(/All Rights Reserved[^\n]*\*\*未確認\*\*/u);
  });
});

describe("docs/data-sources.md の前書きと、画像の扱い", () => {
  it("元データを入れないという文に、経路図の例外がある", () => {
    expect(doc).toMatch(/元データは公開リポジトリに入れない[^\n]*例外は環境省の経路図 5 枚/u);
  });
  it("「本作品は画像を使わない」とだけ書かない。農林水産省の画像に限る", () => {
    expect(doc).not.toContain("本作品は画像を使わない");
    expect(doc).toContain("本作品は農林水産省の画像を使わない");
  });
});

describe("docs/data-sources.md と docs/mcp-usage.md に内部の言葉がない", () => {
  const mcp = fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "docs", "mcp-usage.md"), "utf8");
  it.each([
    ["data-sources.md", doc],
    ["mcp-usage.md", mcp],
  ])("%s", (_n, text) => {
    expect(text).not.toMatch(/契約 \d|設計書 ?§|§\d|人の作業|索引 Q|\b[FIMWX]-\d{2}\b/u);
  });
});
