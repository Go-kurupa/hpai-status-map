import { describe, expect, it } from "vitest";
import {
  dateInQuote,
  headCountInQuote,
  nationalNoInQuote,
  prefNoInQuote,
  quoteExists,
  radiusInQuote,
  timeInQuote,
  valueInQuote,
} from "../src/read/quote";
import type { ReadDate } from "../src/read/types";

const d = (year: number | null, month: number, day: number, time: string | null = null): ReadDate => ({ year, month, day, time });

describe("quoteExists", () => {
  it("空白と改行を除いて本文にあれば true（部首用の文字も同じ字として扱う）", () => {
    expect(quoteExists("疑似患畜を\n確認 しました", "本日、疑似患畜を確認しました。")).toBe(true);
    expect(quoteExists("⻑野県", "長野県で発生")).toBe(true);
    expect(quoteExists("鳥インフル", "鳥インフルエンザ")).toBe(true);
  });
  it("本文になければ false、空の引用は false", () => {
    expect(quoteExists("疑似患畜を確認", "簡易検査で陽性でした")).toBe(false);
    expect(quoteExists("", "本文")).toBe(false);
    expect(quoteExists("  \n", "本文")).toBe(false);
  });
});

describe("valueInQuote", () => {
  it("正規化した引用が値を含めば true", () => {
    expect(valueInQuote("鏡野町", "苫田郡鏡野町の農場")).toBe(true);
    expect(valueInQuote("津山市", "岡山県鏡野町")).toBe(false);
    expect(valueInQuote("", "岡山県")).toBe(false);
  });
});

describe("headCountInQuote（数の式を 1 つのまとまりで読む）", () => {
  it.each([
    [430000, "家きん全羽（約43万羽）の殺処分"],
    [6000, "約0.6万羽"],
    [459000, "約45.9万羽"],
    [9000, "約9,000羽"],
    [43000, "４万３千羽"],
    [10800, "10,800羽"],
    [75137, "処分羽数７５，１３７羽（羽数精査中）"],
  ])("%i は「%s」で ○", (value, quote) => {
    expect(headCountInQuote(value, quote)).toBe(true);
  });
  it("まとまりの途中の数は候補にしない（43万羽の 43 と 8 は ×）", () => {
    expect(headCountInQuote(43, "約43万羽")).toBe(false);
    expect(headCountInQuote(8, "国内8例目、約43万羽")).toBe(false);
    expect(headCountInQuote(430000, "約43万羽")).toBe(true);
  });
  it("羽のつかない数や桁の違いは ×", () => {
    expect(headCountInQuote(7, "搬出制限区域内農場 7 戸")).toBe(false);
    expect(headCountInQuote(43000, "約43万羽")).toBe(false);
    expect(headCountInQuote(1, "11羽")).toBe(false);
  });
});

describe("国内何例目、県内何例目", () => {
  it("国内は「国内」「全国」の直後の N例目、県内はそれ以外", () => {
    const q = "国内8例目、県内1例目です。";
    expect(nationalNoInQuote(8, q)).toBe(true);
    expect(nationalNoInQuote(1, q)).toBe(false);
    expect(prefNoInQuote(1, q)).toBe(true);
    expect(prefNoInQuote(8, q)).toBe(false);
  });
  it("羽数の文では ×", () => {
    expect(nationalNoInQuote(430000, "約43万羽")).toBe(false);
    expect(prefNoInQuote(43, "約43万羽")).toBe(false);
  });
});

describe("dateInQuote", () => {
  it("年あり、令和、全角、スラッシュ", () => {
    expect(dateInQuote(d(2025, 12, 20), "令和7年12月20日")).toBe(true);
    expect(dateInQuote(d(2025, 12, 20), "令和７年 12 月 20 日")).toBe(true);
    expect(dateInQuote(d(2025, 12, 20), "2025年12月20日")).toBe(true);
    expect(dateInQuote(d(null, 12, 20), "１２月２０日")).toBe(true);
    expect(dateInQuote(d(null, 10, 27), "10/27 回収")).toBe(true);
    expect(dateInQuote(d(null, 12, 20), "令和7年12月20日")).toBe(true);
  });
  it("日がずれる、年がずれる、年が引用にない、月日が違う", () => {
    expect(dateInQuote(d(2025, 12, 21), "12月20日")).toBe(false);
    expect(dateInQuote(d(2024, 12, 20), "令和7年12月20日")).toBe(false);
    expect(dateInQuote(d(2025, 12, 20), "12月20日")).toBe(false);
    expect(dateInQuote(d(null, 12, 20), "11月20日")).toBe(false);
  });
  it("時刻がある値は、引用の時刻とも合う", () => {
    expect(dateInQuote(d(null, 12, 20, "09:00"), "12月20日午前9時")).toBe(true);
    expect(dateInQuote(d(null, 12, 20, "10:00"), "12月20日午前9時")).toBe(false);
    expect(dateInQuote(d(null, 12, 20, "09:00"), "12月20日")).toBe(false);
  });
});

describe("timeInQuote", () => {
  it("午後、24 時間、午前、分なし", () => {
    expect(timeInQuote("14:26", "午後2時26分")).toBe(true);
    expect(timeInQuote("14:26", "14時26分")).toBe(true);
    expect(timeInQuote("14:26", "14:26")).toBe(true);
    expect(timeInQuote("09:00", "午前9時")).toBe(true);
    expect(timeInQuote("01:17", "午前1時１７分終了")).toBe(true);
    expect(timeInQuote("00:00", "午前0時")).toBe(true);
    expect(timeInQuote("12:00", "午後0時")).toBe(true);
  });
  it("合わない時刻、「時間」は時刻でない", () => {
    expect(timeInQuote("10:00", "午前9時")).toBe(false);
    expect(timeInQuote("09:30", "午前9時")).toBe(false);
    expect(timeInQuote("12:00", "12時間")).toBe(false);
  });
});

describe("radiusInQuote（半径の文）", () => {
  const zone = "農場から半径3km以内の区域について移動制限区域の設定、半径3kmから10km以内の区域について搬出制限区域の設定";
  it("半径、km、制限の語が同じ文にあれば ○", () => {
    expect(radiusInQuote(3, zone)).toBe(true);
    expect(radiusInQuote(10, zone)).toBe(true);
    expect(radiusInQuote(3, "発生農場から半径３キロ以内の区域について｢移動制限区域｣として設定し")).toBe(true);
  });
  it("農場数、日数のすり替えは ×", () => {
    expect(radiusInQuote(12, "半径3km以内の農場は12戸です")).toBe(false);
    expect(radiusInQuote(10, "移動制限は10日間です")).toBe(false);
  });
  it("区域の外への自粛の要請の 10 は ×（京都の型）", () => {
    expect(radiusInQuote(10, "発生農場から半径10km圏内の農場に出荷の自粛を要請しました")).toBe(false);
    expect(radiusInQuote(10, "半径10km圏内の移動制限区域外の農場に出荷の自粛を要請しました")).toBe(false);
  });
  it("文を「。」で分け、別の文の語は借りない／桁の境目", () => {
    expect(radiusInQuote(10, "半径10kmの農場です。移動制限区域を設定しました。")).toBe(false);
    expect(radiusInQuote(3, "半径13km以内の区域は移動制限区域です")).toBe(false);
    expect(radiusInQuote(3, "半径3km以内の区域は移動制限区域です")).toBe(true);
  });
});
