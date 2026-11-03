import { describe, expect, it } from "vitest";
import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import type { HistoryCase } from "@hpai/shared/types";
import { buildHistory, findMissingInSources, parseRawCases, renderUnmatchedMd, sortHistory, type RawCase } from "../lib/history";

/** 名前の対応だけを試すので、形はいらない。 */
function geoWith(entries: Array<[string, string, string]>): GeoStore {
  const index: Record<string, MuniEntry> = {};
  for (const [code, name, prefCode] of entries) {
    index[code] = { code, name, prefCode, center: [0, 0], bbox: [0, 0, 0, 0] };
  }
  return {
    index,
    adjacency: {},
    ensurePrefs: async () => {},
    geometry: () => {
      throw new Error("形は読まない");
    },
  };
}

const GEO = geoWith([
  ["03381", "金ケ崎町", "03"],
  ["01233", "伊達市", "01"],
  ["07213", "伊達市", "07"],
  ["40130", "福岡市", "40"],
  ["33202", "津山市", "33"],
]);

function raw(o: Partial<RawCase> = {}): RawCase {
  return {
    season: "2022",
    no: 1,
    pref: "岩手県",
    municipality: "金ヶ崎町",
    date: "2022-11-13",
    bird: "採卵鶏",
    housing: "ケージ飼い",
    count: 120000,
    source: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/220929-305.pdf",
    related: false,
    ...o,
  };
}

describe("buildHistory", () => {
  it("season は数値、count は headCount、bird は birdUse、source は sourceUrl、県と市町村は符号", () => {
    const { cases, unmatched } = buildHistory([raw()], GEO);
    expect(unmatched).toEqual([]);
    expect(cases).toEqual([
      {
        season: 2022,
        no: 1,
        prefCode: "03",
        muniCode: "03381",
        muniNameThen: "金ヶ崎町",
        date: "2022-11-13",
        birdUse: "採卵鶏",
        housing: "ケージ飼い",
        headCount: 120000,
        sourceUrl: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/220929-305.pdf",
        related: false,
      } satisfies HistoryCase,
    ]);
    expect(typeof cases[0]!.season).toBe("number");
  });

  it("related を保ち、note は持ち越さない（キーは HistoryCase の 11 個だけ）", () => {
    const { cases } = buildHistory([raw({ related: true, note: "発生日は原本に個別記載なし" })], GEO);
    expect(cases[0]!.related).toBe(true);
    expect(Object.keys(cases[0]!).sort()).toEqual(
      ["season", "no", "prefCode", "muniCode", "muniNameThen", "date", "birdUse", "housing", "headCount", "sourceUrl", "related"].sort(),
    );
    expect(JSON.stringify(cases)).not.toContain("原本に個別記載なし");
  });

  it("bird、housing、count が null なら null", () => {
    const { cases } = buildHistory([raw({ bird: null, housing: null, count: null })], GEO);
    expect(cases[0]).toMatchObject({ birdUse: null, housing: null, headCount: null });
  });

  it("nameMap のキーは「県|市町村」（原本の綴りのまま）。金ヶ崎と金ケ崎は同じコード", () => {
    const { nameMap } = buildHistory([raw(), raw({ no: 2, municipality: "金ケ崎町" })], GEO);
    expect(nameMap).toEqual({ "岩手県|金ヶ崎町": "03381", "岩手県|金ケ崎町": "03381" });
  });

  it("同じ名前の市町村は県で分かれる（北海道の伊達市と福島県の伊達市）", () => {
    const { nameMap } = buildHistory(
      [raw({ pref: "北海道", municipality: "伊達市" }), raw({ no: 2, pref: "福島県", municipality: "伊達市" })],
      GEO,
    );
    expect(nameMap["北海道|伊達市"]).toBe("01233");
    expect(nameMap["福島県|伊達市"]).toBe("07213");
  });

  it("福岡市は政令市のコード 40130", () => {
    const { cases } = buildHistory([raw({ pref: "福岡県", municipality: "福岡市" })], GEO);
    expect(cases[0]!.muniCode).toBe("40130");
  });

  it("対応しない行（知らない町、知らない県）は unmatched に出し、cases と nameMap に入れない", () => {
    const bad1 = raw({ no: 2, municipality: "存在しない町" });
    const bad2 = raw({ no: 3, pref: "不明県" });
    const { cases, nameMap, unmatched } = buildHistory([raw(), bad1, bad2], GEO);
    expect(cases).toHaveLength(1);
    expect(unmatched).toEqual([bad1, bad2]);
    expect(Object.keys(nameMap)).toEqual(["岩手県|金ヶ崎町"]);
  });

  it("県の中に同名が複数あれば対応しない（推測で選ばない）", () => {
    const geo = geoWith([
      ["47001", "同名市", "47"],
      ["47002", "同名市", "47"],
    ]);
    const { cases, unmatched } = buildHistory([raw({ pref: "沖縄県", municipality: "同名市" })], geo);
    expect(cases).toEqual([]);
    expect(unmatched).toHaveLength(1);
  });

  it("並びは (season, related, no) で決まり、入力の順に左右されない。nameMap のキーも整列", () => {
    const rows = [
      raw({ season: "2023", no: 1 }),
      raw({ season: "2022", no: 2, related: true }),
      raw({ season: "2022", no: 2 }),
      raw({ season: "2022", no: 1, pref: "福岡県", municipality: "福岡市" }),
    ];
    const a = buildHistory(rows, GEO);
    const b = buildHistory([...rows].reverse(), GEO);
    expect(a.cases.map((c) => `${c.season}-${c.related ? "r" : "m"}-${c.no}`)).toEqual(["2022-m-1", "2022-m-2", "2022-r-2", "2023-m-1"]);
    expect(b.cases).toEqual(a.cases);
    expect(Object.keys(a.nameMap)).toEqual([...Object.keys(a.nameMap)].sort());
    expect(Object.keys(b.nameMap)).toEqual(Object.keys(a.nameMap));
  });

  it("season が数でない行は throw する（黙って落とさない）", () => {
    expect(() => buildHistory([raw({ season: "令和4" })], GEO)).toThrow();
  });
});

describe("sortHistory", () => {
  it("同じ (season, related, no) は入力の順を保つ", () => {
    const a = { season: 2022, no: 1, related: true, muniCode: "03381" } as HistoryCase;
    const b = { season: 2022, no: 1, related: true, muniCode: "33202" } as HistoryCase;
    expect(sortHistory([a, b]).map((x) => x.muniCode)).toEqual(["03381", "33202"]);
  });
});

describe("parseRawCases", () => {
  it("配列でなければ throw", () => {
    expect(() => parseRawCases({})).toThrow();
  });
  it("必須の欄が欠けた行は throw（行の位置を示す）", () => {
    expect(() => parseRawCases([{ season: "2022" }])).toThrow(/0/);
  });
  it("正しい行は読める", () => {
    expect(parseRawCases([raw()])).toEqual([raw()]);
  });
});

describe("renderUnmatchedMd", () => {
  it("0 件なら「対応づかない事例: 0 件」", () => {
    expect(renderUnmatchedMd([])).toContain("対応づかない事例: 0 件");
  });
  it("あれば件数と行を出す", () => {
    const md = renderUnmatchedMd([raw({ municipality: "存在しない町" })]);
    expect(md).toContain("対応づかない事例: 1 件");
    expect(md).toContain("存在しない町");
  });
});

describe("findMissingInSources（出典の文字層に市町村名があるか）", () => {
  const url = "https://www.maff.go.jp/x.pdf";
  const h = (o: Partial<HistoryCase>): HistoryCase => ({
    season: 2022,
    no: 1,
    prefCode: "03",
    muniCode: "03381",
    muniNameThen: "金ヶ崎町",
    date: "2022-11-13",
    birdUse: null,
    housing: null,
    headCount: null,
    sourceUrl: url,
    related: false,
    ...o,
  });

  it("ヶ と ケ、部首の文字、空白と改行の違いを越えて見つける", () => {
    const text = new Map([[url, "岩手県 金ケ\n崎町 ⻑野県 ⻄ ⻑ 野市"]]);
    expect(findMissingInSources([h({}), h({ no: 2, muniNameThen: "長野市" })], text)).toEqual([]);
  });

  it("見つからない行と、文字層を取っていない出典の行を返す", () => {
    const other = "https://www.maff.go.jp/y.pdf";
    const text = new Map([[url, "津山市"]]);
    const missing = findMissingInSources([h({}), h({ no: 3, sourceUrl: other })], text);
    expect(missing.map((m) => [m.row.no, m.reason])).toEqual([
      [1, "name_not_found"],
      [3, "no_text"],
    ]);
  });
});
