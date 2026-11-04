import { describe, expect, it } from "vitest";
import { compareReads } from "../src/read/compare";
import type { ReadDate, ReadResult, SecondReadResult, VerifyReport } from "../src/read/types";

const date = (year: number | null, month: number, day: number, time: string | null = null): ReadDate => ({ year, month, day, time });
const none = { value: null, quote: null };
const q = <T,>(value: T | null) => ({ value, quote: "引用" });

const primary: ReadResult = {
  kind: "confirmed",
  kindQuote: "k",
  multipleCases: false,
  prefecture: q("岡山県"),
  municipality: q("苫田郡鏡野町"),
  nationalNo: none, prefNo: none, birdUse: none, housing: none, headCount: none, negationBasis: none,
  primaryStage: "confirmed",
  primaryDate: date(2025, 12, 20, "09:00"),
  primaryDateQuote: "d",
  stageEvents: [], radiiKm: [], estimates: [], wildBirds: [],
};
const second: SecondReadResult = {
  kind: "confirmed",
  multipleCases: false,
  prefecture: "岡山県",
  municipality: "鏡野町",
  primaryStage: "confirmed",
  primaryDate: date(2025, 12, 20),
  wildBirds: [],
};

describe("compareReads: 一致", () => {
  it("書き方の違い（郡、区、県名の短縮）と時刻の有無は一致", () => {
    expect(compareReads(primary, second)).toEqual({ match: true, mismatches: [] });
    expect(compareReads({ ...primary, municipality: q("岡山市北区") }, { ...second, municipality: "岡山市" }).match).toBe(true);
    expect(compareReads(primary, { ...second, prefecture: "岡山" }).match).toBe(true);
    expect(compareReads(primary, { ...second, primaryDate: date(2025, 12, 20, "13:00") }).match).toBe(true);
  });
  it("年が片方 null なら月日で比べる", () => {
    expect(compareReads(primary, { ...second, primaryDate: date(null, 12, 20) }).match).toBe(true);
    expect(compareReads({ ...primary, primaryDate: date(null, 12, 20) }, second).match).toBe(true);
    expect(compareReads(primary, { ...second, primaryDate: date(null, 12, 21) }).mismatches).toEqual(["primaryDate"]);
  });
  it("両方 null の段階と日付（否定など）は一致", () => {
    const n = compareReads(
      { ...primary, kind: "negated", primaryStage: null, primaryDate: null },
      { ...second, kind: "negated", primaryStage: null, primaryDate: null },
    );
    expect(n.match).toBe(true);
  });
});

describe("compareReads: わざと誤った読み手", () => {
  it("kind", () => {
    expect(compareReads(primary, { ...second, kind: "suspected" }).mismatches).toContain("kind");
  });
  it("prefecture", () => {
    expect(compareReads(primary, { ...second, prefecture: "鳥取県" })).toEqual({ match: false, mismatches: ["prefecture"] });
    expect(compareReads(primary, { ...second, prefecture: null }).mismatches).toEqual(["prefecture"]);
  });
  it("municipality", () => {
    expect(compareReads(primary, { ...second, municipality: "津山市" })).toEqual({ match: false, mismatches: ["municipality"] });
    expect(compareReads(primary, { ...second, municipality: null }).mismatches).toEqual(["municipality"]);
  });
  it("primaryStage", () => {
    expect(compareReads(primary, { ...second, primaryStage: "suspected" })).toEqual({ match: false, mismatches: ["primaryStage"] });
    expect(compareReads(primary, { ...second, primaryStage: null }).mismatches).toEqual(["primaryStage"]);
  });
  it("primaryDate（年、月、片方 null）", () => {
    expect(compareReads(primary, { ...second, primaryDate: date(2025, 12, 21) }).mismatches).toEqual(["primaryDate"]);
    expect(compareReads(primary, { ...second, primaryDate: date(2024, 12, 20) }).mismatches).toEqual(["primaryDate"]);
    expect(compareReads(primary, { ...second, primaryDate: null }).mismatches).toEqual(["primaryDate"]);
  });
  it("multipleCases の不一致は kind に数える", () => {
    expect(compareReads(primary, { ...second, multipleCases: true })).toEqual({ match: false, mismatches: ["kind"] });
  });
  it("複数の食い違いはすべて出る", () => {
    const r = compareReads(primary, { ...second, municipality: "津山市", primaryStage: "suspected" });
    expect(r.mismatches).toEqual(expect.arrayContaining(["municipality", "primaryStage"]));
  });
});

describe("compareReads: 対象外の種類は種類だけ比べる", () => {
  it("drill 同士なら県や市町村が違っても一致", () => {
    const a: ReadResult = { ...primary, kind: "drill", prefecture: none, municipality: none, primaryStage: null, primaryDate: null };
    const b: SecondReadResult = { ...second, kind: "drill", prefecture: "岡山県", municipality: null, primaryStage: null, primaryDate: null };
    expect(compareReads(a, b).match).toBe(true);
  });
});

describe("compareReads: 野鳥", () => {
  const birdP = (date_: ReadDate, muni: string | null, test: "screening_positive" | "hpai_confirmed" | "negative" = "negative", pref = "宮城県") => ({
    date: date_, prefecture: pref, municipality: muni, species: null, test, quote: "q",
  });
  const birdS = (date_: ReadDate, muni: string | null, test: "screening_positive" | "hpai_confirmed" | "negative" = "negative", pref = "宮城県") => ({
    date: date_, prefecture: pref, municipality: muni, test,
  });
  const wp = (birds: ReadResult["wildBirds"]): ReadResult => ({ ...primary, kind: "wild_bird", prefecture: none, municipality: none, primaryStage: null, primaryDate: null, wildBirds: birds });
  const ws = (birds: SecondReadResult["wildBirds"]): SecondReadResult => ({ ...second, kind: "wild_bird", prefecture: null, municipality: null, primaryStage: null, primaryDate: null, wildBirds: birds });

  it("順序を問わず一致、年が片方 null なら月日で比べる", () => {
    const a = wp([birdP(date(null, 10, 27), "栗原市"), birdP(date(2025, 11, 2), "岩見沢市", "hpai_confirmed", "北海道")]);
    const b = ws([birdS(date(2025, 11, 2), "岩見沢市", "hpai_confirmed", "北海道"), birdS(date(2025, 10, 27), "栗原市")]);
    expect(compareReads(a, b)).toEqual({ match: true, mismatches: [] });
  });
  it("test、日付、市町村、件数の食い違いは wildBirds", () => {
    const base = wp([birdP(date(null, 10, 27), "栗原市")]);
    expect(compareReads(base, ws([birdS(date(null, 10, 27), "栗原市", "hpai_confirmed")])).mismatches).toEqual(["wildBirds"]);
    expect(compareReads(base, ws([birdS(date(null, 10, 28), "栗原市")])).mismatches).toEqual(["wildBirds"]);
    expect(compareReads(base, ws([birdS(date(null, 10, 27), "石巻市")])).mismatches).toEqual(["wildBirds"]);
    expect(compareReads(base, ws([birdS(date(null, 10, 27), null)])).mismatches).toEqual(["wildBirds"]);
    expect(compareReads(base, ws([])).mismatches).toEqual(["wildBirds"]);
    expect(compareReads(base, ws([birdS(date(null, 10, 27), "栗原市"), birdS(date(null, 10, 27), "栗原市")])).mismatches).toEqual(["wildBirds"]);
  });
});

// 照合が取得元の県で補った（主の県が空）ときは、補った県で別の読み手と比べる。補っていなければ今までどおり。
describe("compareReads: 照合で補った都道府県", () => {
  const nullPref: ReadResult = { ...primary, prefecture: none };
  const filled = (prefCode: string | null, marked = true): Pick<VerifyReport, "issues" | "normalized"> => ({
    issues: marked ? [{ field: "prefecture", check: "value_in_quote", mandatory: false, detail: "prefecture_filled_from_source" }] : [],
    normalized: { prefCode } as VerifyReport["normalized"],
  });
  it("補った県と別の読み手の県が同じなら一致", () => {
    expect(compareReads(nullPref, second, filled("33"))).toEqual({ match: true, mismatches: [] });
    expect(compareReads(nullPref, { ...second, prefecture: "岡山" }, filled("33")).match).toBe(true);
  });
  it("別の読み手が違う県、または空なら食い違い", () => {
    expect(compareReads(nullPref, { ...second, prefecture: "鳥取県" }, filled("33")).mismatches).toEqual(["prefecture"]);
    expect(compareReads(nullPref, { ...second, prefecture: null }, filled("33")).mismatches).toEqual(["prefecture"]);
  });
  it("補った印がない、照合がない、主の県が空でないときは今までどおり", () => {
    expect(compareReads(nullPref, second, filled("33", false)).mismatches).toEqual(["prefecture"]);
    expect(compareReads(nullPref, second).mismatches).toEqual(["prefecture"]);
    expect(compareReads(nullPref, second, null).mismatches).toEqual(["prefecture"]);
    expect(compareReads({ ...primary, prefecture: q("鳥取県") }, second, filled("33")).mismatches).toEqual(["prefecture"]);
  });
});
