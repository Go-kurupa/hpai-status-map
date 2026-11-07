import { describe, expect, it } from "vitest";
import { FIXED_TEXT, FORBIDDEN_PHRASES, findForbiddenPhrases } from "../src/wording";

describe("禁止の語", () => {
  it("一覧", () => {
    expect(FORBIDDEN_PHRASES).toEqual(["区域の外です", "安全", "安心"]);
  });

  it("空白が割れていても見つける", () => {
    expect(findForbiddenPhrases("区域の 外です")).toEqual(["区域の外です"]);
    expect(findForbiddenPhrases("区域の\n外です。安 心してください")).toEqual(["区域の外です", "安心"]);
  });

  it("無ければ空", () => {
    expect(findForbiddenPhrases("県の連絡を確かめてください")).toEqual([]);
    expect(findForbiddenPhrases("")).toEqual([]);
  });
});

describe("FIXED_TEXT", () => {
  it("契約 3.1 の文と一致する", () => {
    expect(FIXED_TEXT.prefContactIsAuthority).toBe("正式な情報は県の連絡です");
    expect(FIXED_TEXT.pastDisclaimer).toBe("過去の記録です。これからの発生を予測するものではありません");
    expect(FIXED_TEXT.replayBanner).toBe("去年の再現です");
    expect(FIXED_TEXT.areaNoDistance).toBe("町だけを選んでいるので、農場からの距離は見ていません。農場の地点を登録すると、区域に入るかを確かめられます");
    expect(FIXED_TEXT.sameMuniLifted).toBe("この町で発生しました（移動制限は解除されました）");
  });

  it("riskAnywhere は国の言葉と出典の URL を含む", () => {
    expect(FIXED_TEXT.riskAnywhere).toContain("件数が少なくても、シーズン中はどこでも感染のリスクがあります");
    expect(FIXED_TEXT.riskAnywhere).toContain(
      "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf",
    );
  });

  it("どの文にも禁止の語がない", () => {
    for (const [key, text] of Object.entries(FIXED_TEXT)) {
      expect(findForbiddenPhrases(text), key).toEqual([]);
    }
  });

  it("6 つのキーだけ", () => {
    expect(Object.keys(FIXED_TEXT).sort()).toEqual(
      ["areaNoDistance", "pastDisclaimer", "prefContactIsAuthority", "replayBanner", "riskAnywhere", "sameMuniLifted"].sort(),
    );
  });
});
