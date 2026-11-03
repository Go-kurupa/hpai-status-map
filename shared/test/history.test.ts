import { describe, expect, it } from "vitest";
import { historyToCase, pastCasesOf } from "../src/history";
import type { HistoryCase } from "../src/types";

function mk(o: Partial<HistoryCase> = {}): HistoryCase {
  return {
    season: 2022,
    no: 7,
    prefCode: "03",
    muniCode: "03381",
    muniNameThen: "金ヶ崎町",
    date: "2022-11-13",
    birdUse: "採卵鶏",
    housing: "ケージ飼い",
    headCount: 120000,
    sourceUrl: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/220929-305.pdf",
    related: false,
    ...o,
  };
}

describe("historyToCase（契約 3.1）", () => {
  it("id は h${season}-${no}、国の番号は no、県の番号は null", () => {
    const c = historyToCase(mk());
    expect(c.id).toBe("h2022-7");
    expect(c.nationalNo).toBe(7);
    expect(c.prefNo).toBeNull();
  });

  it("同名の欄を写し、市町村名は muniNameThen", () => {
    const c = historyToCase(mk());
    expect(c).toMatchObject({
      season: 2022,
      prefCode: "03",
      muniCode: "03381",
      muniName: "金ヶ崎町",
      birdUse: "採卵鶏",
      housing: "ケージ飼い",
      headCount: 120000,
    });
  });

  it("段階は confirmed だけ（時刻なし）、半径は空、県の見込みはすべて null", () => {
    const c = historyToCase(mk());
    expect(c.stages).toEqual({ confirmed: { date: "2022-11-13", time: null } });
    expect(c.radiiKm).toEqual([]);
    expect(c.prefEstimates).toEqual({ shipment: null, movement: null, surveillance: null });
  });

  it("否定なし、確定状態は national、出典は 1 つ、updatedAt は日付の 0 時（日本時間）", () => {
    const c = historyToCase(mk());
    expect(c.negation).toBe("none");
    expect(c.negatedAt).toBeNull();
    expect(c.confirmState).toBe("national");
    expect(c.sourceUrls).toEqual([mk().sourceUrl]);
    expect(c.updatedAt).toBe("2022-11-13T00:00:00+09:00");
  });

  it("欄が null の事例は null のまま写す", () => {
    const c = historyToCase(mk({ birdUse: null, housing: null, headCount: null }));
    expect(c.birdUse).toBeNull();
    expect(c.housing).toBeNull();
    expect(c.headCount).toBeNull();
  });

  it("related:true は throw する（関連農場は段階に数えない）", () => {
    expect(() => historyToCase(mk({ related: true }))).toThrow();
  });
});

describe("pastCasesOf（related:false だけを Case にする）", () => {
  it("関連農場を除き、順序を保つ", () => {
    const out = pastCasesOf([mk({ no: 1 }), mk({ no: 1, related: true, muniCode: "03201" }), mk({ no: 2 })]);
    expect(out.map((c) => c.id)).toEqual(["h2022-1", "h2022-2"]);
  });
});
