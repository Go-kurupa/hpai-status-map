import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeForMatch } from "@hpai/shared/text";
import { extractPdfText, fingerprint, hasTextLayerOf, sha256Hex } from "../src/watch/extract";
import { describeFixture } from "./helpers/fixtures";

/** 1 ページに英数字を描いただけの最小の PDF。ページごとの本文を渡す。 */
function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("hasTextLayerOf（1 ページ平均 30 字未満は文字層なし）", () => {
  it("29 字は false、30 字は true", () => {
    expect(hasTextLayerOf("a".repeat(29), 1)).toBe(false);
    expect(hasTextLayerOf("a".repeat(30), 1)).toBe(true);
  });
  it("ページ数で割った平均で見る", () => {
    expect(hasTextLayerOf("a".repeat(59), 2)).toBe(false);
    expect(hasTextLayerOf("a".repeat(60), 2)).toBe(true);
  });
  it("空白と改行は数えない", () => {
    expect(hasTextLayerOf(`${"a".repeat(29)}   \n\n  `, 1)).toBe(false);
  });
  it("ページがなければ false", () => {
    expect(hasTextLayerOf("a".repeat(100), 0)).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("30 字のページは文字層あり、29 字は文字層なし", async () => {
    const ok = await extractPdfText(makePdf(["x".repeat(30)]));
    expect(ok.pages).toBe(1);
    expect(ok.text).toContain("x".repeat(30));
    expect(ok.hasTextLayer).toBe(true);
    const ng = await extractPdfText(makePdf(["x".repeat(29)]));
    expect(ng.pages).toBe(1);
    expect(ng.hasTextLayer).toBe(false);
  });
  it("複数ページは平均で見る（30 字と 0 字の 2 ページ → 平均 15 字で文字層なし）", async () => {
    const r = await extractPdfText(makePdf(["x".repeat(30), ""]));
    expect(r.pages).toBe(2);
    expect(r.hasTextLayer).toBe(false);
  });
  it("読めない PDF は throw せず空を返す", async () => {
    expect(await extractPdfText(Buffer.from("これは PDF ではありません"))).toEqual({ text: "", pages: 0, hasTextLayer: false });
    expect(await extractPdfText(Buffer.alloc(0))).toEqual({ text: "", pages: 0, hasTextLayer: false });
  });
});

describe("fingerprint / sha256Hex", () => {
  it("全角と半角、空白と改行の違いは同じ指紋", () => {
    expect(fingerprint("令和７年 １２月")).toBe(fingerprint("令和7年\n12月"));
  });
  it("日付が違えば違う指紋", () => {
    expect(fingerprint("12月20日 発生")).not.toBe(fingerprint("12月21日 発生"));
  });
  it("sha256Hex は 64 桁の 16 進小文字。文字列と Buffer で同じ", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex("abc"));
  });
});

const PREV_PDF = path.resolve(import.meta.dirname, "../../data/private/fixtures/maff/r7_hpai_kokunai-240.pdf");
describeFixture("国の事例一覧 PDF（控え）", [PREV_PDF], () => {
  it("部首用の文字が混じる文字層でも、正規化の後に津山が見つかる", async () => {
    const r = await extractPdfText(fs.readFileSync(PREV_PDF));
    expect(r.hasTextLayer).toBe(true);
    expect(r.pages).toBeGreaterThan(0);
    expect(r.text).not.toContain("津山"); // 生の文字層は「岡⼭県津⼭市」（康熙部首の山）
    expect(normalizeForMatch(r.text)).toContain("津山");
  });
});
