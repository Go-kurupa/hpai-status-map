import { describe, expect, it } from "vitest";
import { FIXED_TEXT, riskAnywhereParts } from "../src/wording";

describe("riskAnywhereParts（守る文を、文・出典の名前・URL に分ける）", () => {
  it("文の本体、出典の名前、URL に分かれる", () => {
    const p = riskAnywhereParts();
    expect(p.sentence).toBe("件数が少なくても、シーズン中はどこでも感染のリスクがあります");
    expect(p.sourceName).toBe("農林水産省 疫学調査報告書");
    expect(p.url).toMatch(/^https:\/\/www\.maff\.go\.jp\/.+\.pdf$/u);
  });

  it("組み戻すと FIXED_TEXT.riskAnywhere と一字一句同じ（文の正は変えない）", () => {
    const p = riskAnywhereParts();
    expect(`${p.sentence}（出典: ${p.sourceName} ${p.url}）`).toBe(FIXED_TEXT.riskAnywhere);
  });

  it("文の本体と出典の名前に URL が入らない", () => {
    const p = riskAnywhereParts();
    expect(p.sentence).not.toContain("http");
    expect(p.sourceName).not.toContain("http");
  });
});
