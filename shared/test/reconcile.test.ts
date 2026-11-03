import { describe, expect, it } from "vitest";
import {
  appOnlyConfirmed,
  confirmedAtOf,
  liftGaps,
  missingNationalNos,
  nationalListUrls,
  nationalConfirmedNos,
  parseNationalFact,
  type NationalFact,
} from "../src/read/reconcile";
import type { Case } from "../src/types";

const PRESS = "https://www.maff.go.jp/j/press/";

function aCase(o: Partial<Case> = {}): Case {
  return {
    id: "33203-2025-12-20-1",
    season: 2025,
    nationalNo: 8,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: "09:00" } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2025-12-20T10:00:00+09:00",
    ...o,
  };
}

describe("nationalListUrls: 見る一覧", () => {
  it("2026-01-15 は index.html と arc/2510、2511、2512", () => {
    expect(nationalListUrls(new Date("2026-01-15T03:00:00Z"))).toEqual([`${PRESS}index.html`, `${PRESS}arc/2510.html`, `${PRESS}arc/2511.html`, `${PRESS}arc/2512.html`]);
  });
  it("シーズンの最初の月（10 月）は index.html だけ。11 月は 2510 まで", () => {
    expect(nationalListUrls(new Date("2025-10-05T03:00:00Z"))).toEqual([`${PRESS}index.html`]);
    expect(nationalListUrls(new Date("2025-11-20T03:00:00Z"))).toEqual([`${PRESS}index.html`, `${PRESS}arc/2510.html`]);
  });
  it("年をまたいでも前の月まで。5 月は 2510〜2604", () => {
    const urls = nationalListUrls(new Date("2026-05-31T03:00:00Z"));
    expect(urls[0]).toBe(`${PRESS}index.html`);
    expect(urls.slice(1)).toEqual(["2510", "2511", "2512", "2601", "2602", "2603", "2604"].map((m) => `${PRESS}arc/${m}.html`));
  });
  it("シーズン外（6〜9 月）は index.html だけ", () => {
    expect(nationalListUrls(new Date("2026-07-01T03:00:00Z"))).toEqual([`${PRESS}index.html`]);
    expect(nationalListUrls(new Date("2026-09-30T03:00:00Z"))).toEqual([`${PRESS}index.html`]);
  });
  it("日本時間の月で数える（UTC では 12 月でも JST では 1 月）", () => {
    expect(nationalListUrls(new Date("2025-12-31T16:00:00Z"))).toEqual([`${PRESS}index.html`, `${PRESS}arc/2510.html`, `${PRESS}arc/2511.html`, `${PRESS}arc/2512.html`]);
  });
});

describe("missingNationalNos: 国にあって作品にない N", () => {
  it("国の N のうち、今季の事例にないものを昇順で返す", () => {
    const cases = [aCase({ nationalNo: 8 }), aCase({ id: "x", nationalNo: 9 })];
    expect(missingNationalNos([11, 8, 9, 10], cases, 2025)).toEqual([10, 11]);
  });
  it("確認中の事例と否定された事例は数えない（国にあるのに作品にない扱い）", () => {
    const cases = [aCase({ nationalNo: 8, negation: "negated" }), aCase({ id: "r", nationalNo: 9, confirmState: "reviewing" }), aCase({ id: "ok", nationalNo: 10 })];
    expect(missingNationalNos([8, 9, 10], cases, 2025)).toEqual([8, 9]);
  });
  it("別のシーズンの同じ N は数えない", () => {
    expect(missingNationalNos([8], [aCase({ season: 2024, nationalNo: 8 })], 2025)).toEqual([8]);
  });
  it("重複を 1 つにする", () => {
    expect(missingNationalNos([3, 3], [], 2025)).toEqual([3]);
  });
});

describe("appOnlyConfirmed: 作品にあって国にない確定（48 時間）", () => {
  const c = aCase({ nationalNo: null, stages: { confirmed: { date: "2025-12-20", time: "09:00" } } });
  const nationalSet = new Set<number>([1, 2]);
  it("12/20 09:00 の確定は、12/22 08:59 では返さず、09:00 で返す", () => {
    expect(appOnlyConfirmed([c], nationalSet, 2025, new Date("2025-12-22T08:59:59+09:00"))).toEqual([]);
    expect(appOnlyConfirmed([c], nationalSet, 2025, new Date("2025-12-22T09:00:00+09:00"))).toEqual([c]);
  });
  it("時刻なし（null）は 00:00 として 48 時間", () => {
    const d = aCase({ id: "d", nationalNo: null, stages: { confirmed: { date: "2025-12-20", time: null } } });
    expect(appOnlyConfirmed([d], nationalSet, 2025, new Date("2025-12-21T23:59:00+09:00"))).toEqual([]);
    expect(appOnlyConfirmed([d], nationalSet, 2025, new Date("2025-12-22T00:00:00+09:00"))).toEqual([d]);
  });
  it("国の一覧にある N は返さない", () => {
    const d = aCase({ nationalNo: 2 });
    expect(appOnlyConfirmed([d], nationalSet, 2025, new Date("2026-01-30T00:00:00+09:00"))).toEqual([]);
  });
  it("確認中、否定、国の情報から作った事例、確定の段階がない事例、別シーズンは返さない", () => {
    const now = new Date("2026-01-30T00:00:00+09:00");
    const others = [
      aCase({ id: "a", nationalNo: null, confirmState: "reviewing" }),
      aCase({ id: "b", nationalNo: null, negation: "negated" }),
      aCase({ id: "c", nationalNo: 99, confirmState: "national" }),
      aCase({ id: "d", nationalNo: null, stages: { suspected: { date: "2025-12-20", time: null } } }),
      aCase({ id: "e", nationalNo: null, season: 2024 }),
    ];
    expect(appOnlyConfirmed(others, nationalSet, 2025, now)).toEqual([]);
  });
  it("否定の候補の事例は返す（まだ確定の表示が出ている）", () => {
    const d = aCase({ negation: "candidate", nationalNo: null });
    expect(appOnlyConfirmed([d], nationalSet, 2025, new Date("2026-01-30T00:00:00+09:00"))).toEqual([d]);
  });
});

describe("confirmedAtOf", () => {
  it("日付と時刻を JST として読む。時刻が壊れていれば 00:00。確定がなければ null", () => {
    expect(confirmedAtOf(aCase())?.toISOString()).toBe("2025-12-20T00:00:00.000Z");
    expect(confirmedAtOf(aCase({ stages: { confirmed: { date: "2025-12-20", time: "9:05" } } }))?.toISOString()).toBe("2025-12-20T00:05:00.000Z");
    expect(confirmedAtOf(aCase({ stages: { confirmed: { date: "2025-12-20", time: "ふつう" } } }))?.toISOString()).toBe("2025-12-19T15:00:00.000Z");
    expect(confirmedAtOf(aCase({ stages: {} }))).toBeNull();
  });
});

const CONFIRMED_TEXT =
  "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）について 令和7年12月20日 農林水産省 本日、岡山県津山市の家きん農場において、家畜伝染病である高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内8例目）されました。 1.農場の概要 所在地：岡山県津山市 飼養状況：約43万羽（採卵鶏） 2.経緯 （1）令和7年12月19日（金曜日）、岡山県は通報を受けました。";
const LIFT_TEXT =
  "令和8年1月21日 農林水産省 岡山県は、津山市で確認された高病原性鳥インフルエンザ（今シーズン国内8例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年1月21日（水曜日）午前0時（1月20日（火曜日）24時）をもって、当該移動制限を解除しました。";

describe("parseNationalFact: 報道発表の本文から国の事実", () => {
  it("確定の発表は県、市町村、N、日付、羽数、用途", () => {
    const f = parseNationalFact({ url: `${PRESS}syouan/douei/251220.html`, title: "題", type: "confirmed" }, CONFIRMED_TEXT);
    expect(f).toMatchObject({ type: "confirmed", prefCode: "33", muniName: "津山市", nationalNo: 8, date: "2025-12-20", headCount: 430000, birdUse: "採卵鶏", url: `${PRESS}syouan/douei/251220.html` });
  });
  it("解除の発表は N の配列と日付", () => {
    const f = parseNationalFact({ url: `${PRESS}syouan/douei/260121.html`, title: "題", type: "movement_lifted" }, LIFT_TEXT);
    expect(f).toMatchObject({ type: "movement_lifted", prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21" });
  });
  it("定型が崩れていれば null（推測しない）", () => {
    expect(parseNationalFact({ url: "u", title: "t", type: "confirmed" }, "本日、家きん農場で確認されました。")).toBeNull();
    expect(parseNationalFact({ url: "u", title: "t", type: "movement_lifted" }, "解除しました。")).toBeNull();
  });
});

describe("nationalConfirmedNos", () => {
  it("今季の確定の N だけを集める（解除と別のシーズンは入れない）", () => {
    const facts: NationalFact[] = [
      { type: "confirmed", url: "a", title: "", prefCode: "33", muniName: "津山市", nationalNo: 8, date: "2025-12-20", headCount: null, birdUse: null },
      { type: "confirmed", url: "b", title: "", prefCode: "01", muniName: "白老町", nationalNo: 1, date: "2024-12-20", headCount: null, birdUse: null },
      { type: "movement_lifted", url: "c", title: "", prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21", controlDone: null, shipmentLifted: null },
    ];
    expect([...nationalConfirmedNos(facts, 2025)]).toEqual([8]);
  });
});

describe("liftGaps: 解除が事例に反映されていない国の発表", () => {
  const lift: NationalFact & { type: "movement_lifted" } = {
    type: "movement_lifted",
    url: "l",
    title: "",
    prefCode: "33",
    muniName: "津山市",
    nationalNos: [8],
    date: "2026-01-21",
    controlDone: null,
    shipmentLifted: null,
  };
  it("事例に movement_lifted がなければ返す。あれば返さない", () => {
    expect(liftGaps([lift], [aCase()], 2025)).toEqual([lift]);
    expect(liftGaps([lift], [aCase({ stages: { confirmed: { date: "2025-12-20", time: null }, movement_lifted: { date: "2026-01-21", time: null } } })], 2025)).toEqual([]);
  });
  it("監視強化の解除まで進んだ事例は movement_lifted がなくても返さない", () => {
    const c = aCase({ stages: { confirmed: { date: "2025-12-20", time: null }, surveillance_lifted: { date: "2026-02-01", time: null } } });
    expect(liftGaps([lift], [c], 2025)).toEqual([]);
  });
  it("事例がない N は返す（再適用の呼び手が national_missing にする）", () => {
    expect(liftGaps([lift], [], 2025)).toEqual([lift]);
  });
  it("否定された、または否定の候補の事例は自動で直さず返さない", () => {
    expect(liftGaps([lift], [aCase({ negation: "negated" })], 2025)).toEqual([]);
    expect(liftGaps([lift], [aCase({ negation: "candidate" })], 2025)).toEqual([]);
  });
  it("別のシーズンの解除は見ない", () => {
    expect(liftGaps([{ ...lift, date: "2025-03-01" }], [], 2025)).toEqual([]);
  });
  it("複数の N のうち 1 つでも欠けていれば返す", () => {
    const two = { ...lift, nationalNos: [8, 9] };
    const c8 = aCase({ stages: { confirmed: { date: "2025-12-20", time: null }, movement_lifted: { date: "2026-01-21", time: null } } });
    expect(liftGaps([two], [c8], 2025)).toEqual([two]);
  });
});
