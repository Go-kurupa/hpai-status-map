import { describe, expect, it } from "vitest";
import { parseCardsFile } from "../src/consult/schema";
import { EVIDENCE_LABEL } from "../src/consult/types";

const source = {
  id: "maff-guideline-2025",
  title: "飼養衛生管理基準",
  publisher: "農林水産省",
  url: "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/",
  fetchedAt: "2026-11-06",
  domestic: true,
  kind: "guideline",
  license: "PDL1.0",
  licenseVerified: true,
  studyDesign: null,
};

const card = {
  id: "card-001",
  origin: "農林水産省 飼養衛生管理基準",
  action: "鶏舎に入る前に手指と靴を消毒する",
  appliesTo: "鶏舎に人が出入りするすべての農場",
  evidence: "obligation",
  evidenceNote: "基準で義務とされている",
  quote: "衛生管理区域に立ち入る者の手指の消毒を行う",
  sourceId: "maff-guideline-2025",
  locator: "第2 衛生管理区域",
  caveats: ["小規模農場の例外は資料に記載なし"],
  conditionTags: ["entrance", "disinfection"],
  approved: false,
};

const file = () => structuredClone({ sources: [source], cards: [card] });

describe("parseCardsFile", () => {
  it("正しい 1 枚を通す", () => {
    const parsed = parseCardsFile(file());
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]?.id).toBe("card-001");
    expect(parsed.sources[0]?.licenseVerified).toBe(true);
  });

  it("quoteVerified は任意で、付けても通す", () => {
    const f = file();
    (f.cards[0] as Record<string, unknown>).quoteVerified = true;
    expect(parseCardsFile(f).cards[0]?.quoteVerified).toBe(true);
  });

  it("許可された license はすべて通す", () => {
    for (const license of ["PDL1.0", "CC BY", "CC BY 4.0", "OGL v3.0", "US Gov"]) {
      const f = file();
      f.sources[0]!.license = license;
      expect(() => parseCardsFile(f)).not.toThrow();
    }
  });

  it("license が許可外（CC BY-NC）なら throw する", () => {
    const f = file();
    f.sources[0]!.license = "CC BY-NC";
    expect(() => parseCardsFile(f)).toThrow();
  });

  it("sourceId が sources にないなら throw する", () => {
    const f = file();
    f.cards[0]!.sourceId = "no-such-source";
    expect(() => parseCardsFile(f)).toThrow(/no-such-source/);
  });

  it("カードの id が重複していたら throw する", () => {
    const f = file();
    f.cards.push({ ...card });
    expect(() => parseCardsFile(f)).toThrow(/card-001/);
  });

  it("資料の id が重複していたら throw する", () => {
    const f = file();
    f.sources.push({ ...source });
    expect(() => parseCardsFile(f)).toThrow(/maff-guideline-2025/);
  });

  it("quote が空（空白だけを含む）なら throw する", () => {
    for (const quote of ["", "  \n"]) {
      const f = file();
      f.cards[0]!.quote = quote;
      expect(() => parseCardsFile(f)).toThrow();
    }
  });

  it("approved がなければ throw する", () => {
    const f = file();
    delete (f.cards[0] as Record<string, unknown>).approved;
    expect(() => parseCardsFile(f)).toThrow();
  });

  it("evidence が未知の値なら throw する", () => {
    const f = file();
    f.cards[0]!.evidence = "rumor";
    expect(() => parseCardsFile(f)).toThrow();
  });

  it("url が http(s) でないなら throw する", () => {
    const f = file();
    f.sources[0]!.url = "javascript:alert(1)";
    expect(() => parseCardsFile(f)).toThrow();
  });

  it("オブジェクトでない入力は throw する", () => {
    expect(() => parseCardsFile(null)).toThrow();
    expect(() => parseCardsFile([])).toThrow();
  });
});

describe("EVIDENCE_LABEL", () => {
  it("6 つの札がそろっている", () => {
    expect(EVIDENCE_LABEL.obligation).toBe("義務");
    expect(EVIDENCE_LABEL["outbreak-finding"]).toBe("発生農場の調査で見つかった不備");
    expect(EVIDENCE_LABEL["study-association"]).toBe("研究で関係あり");
    expect(EVIDENCE_LABEL["study-no-difference"]).toBe("研究では効果が測られていない");
    expect(EVIDENCE_LABEL.recommendation).toBe("公的機関の推奨");
    expect(EVIDENCE_LABEL["expert-estimate"]).toBe("専門家の推定");
    expect(Object.keys(EVIDENCE_LABEL)).toHaveLength(6);
  });
});
