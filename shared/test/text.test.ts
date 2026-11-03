import { describe, expect, it } from "vitest";
import { hasHpaiWord, normalizeForMatch } from "../src/text";

// 国の PDF の文字層が出す部首の文字（U+2E80〜U+2FDF）と、本来の漢字の組
const RADICAL_PAIRS = "⺠民 ⻁虎 ⻄西 ⻅見 ⻆角 ⻈言 ⻉貝 ⻊足 ⻋車 ⻑長 ⻘青 ⻝食 ⻣骨 ⻤鬼 ⻨麦 ⻩黄 ⻫斉 ⻭歯 ⻯竜 ⻲亀";

describe("normalizeForMatch", () => {
  it("康熙部首（NFKC で直る）を直す", () => {
    expect(normalizeForMatch("⾼病原性⿃")).toBe("高病原性鳥");
  });

  it("試験の入力が本当に部首の文字で、素通りだと緑にならない", () => {
    expect("⾼病原性⿃").not.toBe("高病原性鳥");
    expect("⾼病原性⿃".normalize("NFKC")).toBe("高病原性鳥");
    expect("⻲岡市".normalize("NFKC")).toBe("⻲岡市"); // NFKC で変わらない
    expect("⻲".codePointAt(0)).toBe(0x2ef2);
  });

  it("CJK 部首補助（NFKC で変わらない）を表で直す", () => {
    expect(normalizeForMatch("⻲岡市")).toBe("亀岡市");
    expect(normalizeForMatch("⻘")).toBe("青");
    expect(normalizeForMatch("⻑")).toBe("長");
  });

  it("変換表の 20 組をすべて直す", () => {
    const pairs = RADICAL_PAIRS.split(" ");
    expect(pairs).toHaveLength(20);
    for (const pair of pairs) {
      const [radical, kanji] = [...pair];
      expect(pair, pair).toHaveLength(2);
      expect(radical!.codePointAt(0)!, pair).toBeGreaterThanOrEqual(0x2e80);
      expect(radical!.codePointAt(0)!, pair).toBeLessThanOrEqual(0x2eff);
      expect(normalizeForMatch(radical!), pair).toBe(kanji);
    }
  });

  it("空白と改行を除く", () => {
    expect(normalizeForMatch("津 山\n市　")).toBe("津山市");
    expect(normalizeForMatch("\t岡山\r\n県 ")).toBe("岡山県");
  });

  it("ヶとケを同じにする", () => {
    expect(normalizeForMatch("金ヶ崎町")).toBe(normalizeForMatch("金ケ崎町"));
    expect(normalizeForMatch("金ヶ崎町")).toBe("金ケ崎町");
  });

  it("全角の英数を半角にする", () => {
    expect(normalizeForMatch("ＨＰＡＩ　２０２５")).toBe("HPAI2025");
  });
});

describe("hasHpaiWord", () => {
  it("部首の文字でも見つける", () => {
    expect(hasHpaiWord("⿃インフルエンザに関する相談窓口")).toBe(true);
    expect(hasHpaiWord("⾼病原性⿃インフルエンザ")).toBe(true);
  });

  it("語ごとに見つける", () => {
    expect(hasHpaiWord("鳥インフルエンザ")).toBe(true);
    expect(hasHpaiWord("高病原性")).toBe(true);
    expect(hasHpaiWord("疑似患畜の確認")).toBe(true);
    expect(hasHpaiWord("HPAI")).toBe(true);
    expect(hasHpaiWord("ＨＰＡＩ")).toBe(true);
  });

  it("空白や改行で割れた語も見つける", () => {
    expect(hasHpaiWord("鳥イン\nフルエンザ")).toBe(true);
    expect(hasHpaiWord("高 病 原 性")).toBe(true);
  });

  it("人のインフルエンザは対象外（設計書 §9.1）", () => {
    expect(hasHpaiWord("インフルエンザ様疾患による学校の臨時休業（第39報）")).toBe(false);
    expect(hasHpaiWord("")).toBe(false);
  });
});
