import type { Case, HistoryCase } from "@hpai/shared/types";
import { describe, expect, it } from "vitest";
import historyJson from "../../../../data/history/cases.json";
import { badgeStates, buildPrefBars, buildSeasonView, buildWeeks, JAPAN_BOUNDS, listSeasonBars, MUNI_ZOOM } from "./seasonView";

const history = historyJson as HistoryCase[];
const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
const COUNTS = [52, 25, 84, 11, 51, 24];

function mkCase(o: Partial<Case> = {}): Case {
  return {
    id: "c1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-20T12:00:00+09:00",
    ...o,
  };
}

function past(season: number, o: { current?: number; rows?: readonly HistoryCase[] } = {}) {
  return buildSeasonView({ season, current: o.current ?? 2026, currentCases: [], history: o.rows ?? history });
}

describe("過去 6 シーズン（実データ）", () => {
  it("total が 52、25、84、11、51、24", () => {
    expect(SEASONS.map((s) => past(s).total)).toEqual(COUNTS);
  });

  it("related:false は 247 行で、related:true を足しても件数が同じ", () => {
    expect(history.filter((h) => !h.related)).toHaveLength(247);
    const onlyMain = history.filter((h) => !h.related);
    expect(SEASONS.map((s) => past(s, { rows: onlyMain }).total)).toEqual(COUNTS);
    expect(history.some((h) => h.related)).toBe(true);
  });

  it("県の合計はシーズンの件数と一致し、事例の数と cases の長さも一致する", () => {
    for (const s of SEASONS) {
      const v = past(s);
      expect(Object.values(v.countByPref).reduce((a, b) => a + b, 0)).toBe(v.total);
      expect(v.cases).toHaveLength(v.total);
      expect(v.isCurrent).toBe(false);
      expect(v.loaded).toBe(true);
    }
  });

  it("2025 の月別の件数と羽数", () => {
    const v = past(2025);
    expect(v.months.map((m) => [m.month, m.count])).toEqual([
      [10, 1],
      [11, 4],
      [12, 7],
      [1, 6],
      [2, 2],
      [3, 3],
      [4, 1],
      [5, 0],
    ]);
    expect(v.months.map((m) => m.headCount)).toEqual([459000, 1194000, 2241000, 338000, 620000, 657000, 230000, 0]);
  });

  it("過去の事例は確定で、津山市 33203 が confirmedMuniCodes にある", () => {
    const v = past(2025);
    expect(v.confirmedMuniCodes).toContain("33203");
    expect(v.suspectedMuniCodes).toEqual([]);
  });

  it("過去の記録が読み込めていない（history が null）ときは loaded:false で件数を 0 にしない", () => {
    const v = buildSeasonView({ season: 2025, current: 2026, currentCases: [], history: null });
    expect(v.loaded).toBe(false);
    expect(v.months).toEqual([]);
  });
});

describe("今季", () => {
  it("今季 = 2025（再現）で履歴の 2025 を混ぜない", () => {
    const v = buildSeasonView({ season: 2025, current: 2025, currentCases: [mkCase({ season: 2025 })], history });
    expect(v.isCurrent).toBe(true);
    expect(v.total).toBe(1);
    expect(v.label).toBe("今季");
  });

  it("currentCases が null のときは loaded:false で、件数の棒は count null", () => {
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: null, history });
    expect(v.loaded).toBe(false);
    expect(v.total).toBe(0);
    const bars = listSeasonBars({ current: 2026, currentCases: null, history });
    expect(bars[0]).toEqual({ season: 2026, label: "今季", count: null });
  });

  it("{suspected} は疑い、{suspected, confirmed} は確定", () => {
    const sus = mkCase({ id: "a", muniCode: "33203", stages: { suspected: { date: "2026-11-19", time: null } } });
    const con = mkCase({
      id: "b",
      muniCode: "33204",
      stages: { suspected: { date: "2026-11-19", time: null }, confirmed: { date: "2026-11-20", time: null } },
    });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [sus, con], history: [] });
    expect(v.suspectedMuniCodes).toEqual(["33203"]);
    expect(v.confirmedMuniCodes).toEqual(["33204"]);
  });

  it("同じ市町村に疑いと確定があれば確定だけに入れる", () => {
    const sus = mkCase({ id: "a", stages: { suspected: { date: "2026-11-19", time: null } } });
    const con = mkCase({ id: "b" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [sus, con], history: [] });
    expect(v.suspectedMuniCodes).toEqual([]);
    expect(v.confirmedMuniCodes).toEqual(["33203"]);
    expect(v.total).toBe(2);
  });

  it("確認中は件数と塗りに入らず reviewingPrefCodes に入る", () => {
    const rev = mkCase({ id: "rev-x", confirmState: "reviewing", muniCode: null, muniName: null, prefCode: "31" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [rev], history: [] });
    expect(v.total).toBe(0);
    expect(v.countByPref).toEqual({});
    expect(v.confirmedMuniCodes).toEqual([]);
    expect(v.suspectedMuniCodes).toEqual([]);
    expect(v.reviewingPrefCodes).toEqual(["31"]);
  });

  it("否定は数えず、否定の候補は数える", () => {
    const neg = mkCase({ id: "n", negation: "negated", muniCode: "33204" });
    const cand = mkCase({ id: "c", negation: "candidate", muniCode: "33205" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [neg, cand], history: [] });
    expect(v.total).toBe(1);
    expect(v.confirmedMuniCodes).toEqual(["33205"]);
    expect(v.reviewingPrefCodes).toEqual([]);
  });

  it("別のシーズンの事例は数えない", () => {
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [mkCase({ season: 2025 })], history: [] });
    expect(v.total).toBe(0);
  });
});

describe("月別の棒", () => {
  it("9 月の事例は 9 月の棒を足して隠さず、シーズンの順に並ぶ", () => {
    const sep = mkCase({ id: "s", stages: { confirmed: { date: "2026-09-30", time: null } }, headCount: 500 });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [sep], history: [] });
    expect(v.months.map((m) => m.month)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5]);
    expect(v.months[0]).toMatchObject({ month: 9, count: 1, headCount: 500 });
    expect(v.months.reduce((a, m) => a + m.count, 0)).toBe(v.total);
  });

  it("羽数 null は unknownHeadCases に数え、羽数の合計に入れない", () => {
    const a = mkCase({ id: "a", headCount: null });
    const b = mkCase({ id: "b", headCount: 100, muniCode: "33204" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [a, b], history: [] });
    const nov = v.months.find((m) => m.month === 11)!;
    expect(nov).toMatchObject({ count: 2, headCount: 100, unknownHeadCases: 1 });
  });

  it("疑いだけの事例は疑いの日付の月に入る", () => {
    const sus = mkCase({ stages: { suspected: { date: "2026-12-31", time: null } } });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [sus], history: [] });
    expect(v.months.find((m) => m.month === 12)!.count).toBe(1);
  });
});

describe("棒の一覧", () => {
  it("今季、1 年前、2 年前…6 年前の順で、件数は履歴から数える", () => {
    const bars = listSeasonBars({ current: 2026, currentCases: [mkCase()], history });
    expect(bars.map((b) => b.label)).toEqual(["今季", "1 年前", "2 年前", "3 年前", "4 年前", "5 年前", "6 年前"]);
    expect(bars.map((b) => b.season)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
    expect(bars.map((b) => b.count)).toEqual([1, 24, 51, 11, 84, 25, 52]);
  });

  it("履歴がない年（今季 2025 の 6 年前）は棒にしない", () => {
    const bars = listSeasonBars({ current: 2025, currentCases: [], history });
    expect(bars.map((b) => b.season)).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
  });

  it("history が null のときは過去の棒の count が null（0 にしない）", () => {
    const bars = listSeasonBars({ current: 2026, currentCases: [], history: null });
    expect(bars).toHaveLength(7);
    expect(bars.slice(1).every((b) => b.count === null)).toBe(true);
    expect(bars[0]!.count).toBe(0);
  });
});

describe("バッジと定数", () => {
  it("MUNI_ZOOM は 6、JAPAN_BOUNDS は日本全体", () => {
    expect(MUNI_ZOOM).toBe(6);
    expect(JAPAN_BOUNDS).toEqual([
      [122.9, 24.0],
      [146.0, 45.6],
    ]);
  });

  it("MUNI_ZOOM 未満では 1 件以上の県と確認中の県だけ。以上では空", () => {
    const con = mkCase({ id: "a", prefCode: "33" });
    const con2 = mkCase({ id: "b", prefCode: "33", muniCode: "33204" });
    const rev = mkCase({ id: "rev-x", confirmState: "reviewing", muniCode: null, muniName: null, prefCode: "31" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [con, con2, rev], history: [] });
    expect(badgeStates(v, 5.9)).toEqual([
      { prefCode: "31", text: "確認中" },
      { prefCode: "33", text: "2" },
    ]);
    expect(badgeStates(v, 6)).toEqual([]);
  });

  it("件数と確認中の両方がある県は両方を書く。読み込み前は出さない", () => {
    const con = mkCase({ id: "a", prefCode: "33" });
    const rev = mkCase({ id: "rev-x", confirmState: "reviewing", muniCode: null, muniName: null, prefCode: "33" });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [con, rev], history: [] });
    expect(badgeStates(v, 5)).toEqual([{ prefCode: "33", text: "1 件・確認中" }]);
    const loading = buildSeasonView({ season: 2026, current: 2026, currentCases: null, history: [] });
    expect(badgeStates(loading, 5)).toEqual([]);
  });
});

describe("buildPrefBars（県ごとの棒）", () => {
  it("多い順に並べる。同じ数は県の番号の順。発生のない県は 0 の棒にしない", () => {
    const bars = buildPrefBars({ "33": 1, "01": 3, "46": 3, "15": 2 });
    expect(bars.map((b) => [b.name, b.count])).toEqual([
      ["北海道", 3],
      ["鹿児島県", 3],
      ["新潟県", 2],
      ["岡山県", 1],
    ]);
  });

  it("0 件の県と、数のない県（未確認の県を含む）は棒にしない", () => {
    expect(buildPrefBars({ "01": 2, "23": 0 }).map((b) => b.prefCode)).toEqual(["01"]);
    expect(buildPrefBars({})).toEqual([]);
  });
});

describe("buildWeeks（週ごとの棒）", () => {
  const on = (date: string, o: Partial<Case> = {}) => mkCase({ id: date, stages: { confirmed: { date, time: null } }, ...o });
  const shape = (r: ReturnType<typeof buildWeeks>) => r.weeks.map((w) => `${w.monday}:${w.count}`);

  it("週は月曜に始まる。日曜は前の週、月曜は新しい週に入る", () => {
    const r = buildWeeks([on("2026-11-01"), on("2026-11-02"), on("2026-11-08"), on("2026-11-09")], 2026, "2026-11-10");
    expect(r.weeks.at(-3)).toMatchObject({ monday: "2026-10-26", count: 1 }); // 11/1 は日曜
    expect(r.weeks.at(-2)).toMatchObject({ monday: "2026-11-02", count: 2 }); // 11/2 は月曜、11/8 は日曜
    expect(r.weeks.at(-1)).toMatchObject({ monday: "2026-11-09", count: 1 });
    expect(r.undated).toBe(0);
  });

  it("10 月の最初の日を含む週から今週まで並べる。発生のない週も 0 として持つ", () => {
    expect(shape(buildWeeks([on("2026-10-14")], 2026, "2026-10-20"))).toEqual(["2026-09-28:0", "2026-10-05:0", "2026-10-12:1", "2026-10-19:0"]);
  });

  it("年をまたいでも続く（週が 12/28 に始まり、1/3 までが同じ週）", () => {
    const r = buildWeeks([on("2026-12-31"), on("2027-01-03"), on("2027-01-04")], 2026, "2027-01-05");
    expect(r.weeks.at(-2)).toMatchObject({ monday: "2026-12-28", count: 2 });
    expect(r.weeks.at(-1)).toMatchObject({ monday: "2027-01-04", count: 1 });
    expect(new Set(r.weeks.map((w) => w.monday)).size).toBe(r.weeks.length);
  });

  it("週ごとに、数えた事例の県と町を持つ（件数と同じ数）", () => {
    const r = buildWeeks([on("2026-10-14", { prefCode: "33", muniName: "津山市" }), on("2026-10-15", { prefCode: "31", muniName: null })], 2026, "2026-10-20");
    const w = r.weeks.find((x) => x.monday === "2026-10-12")!;
    expect(w.places).toEqual([
      { prefCode: "33", muniName: "津山市" },
      { prefCode: "31", muniName: null },
    ]);
    expect(r.weeks.every((x) => x.places.length === x.count)).toBe(true);
  });

  it("日付のない事例は棒に入れず数える", () => {
    const r = buildWeeks([on("2026-10-14"), mkCase({ id: "x", stages: {} })], 2026, "2026-10-20");
    expect(r.undated).toBe(1);
    expect(r.weeks.reduce((s, w) => s + w.count, 0)).toBe(1);
  });

  it("形の違う日付、今日より後、今季より前の日付は棒に入れず数える", () => {
    const r = buildWeeks([on("2026-13-40"), on("2026-10-21"), on("2026-05-31"), on("2026-10-14")], 2026, "2026-10-20");
    expect(r.undated).toBe(3);
    expect(r.weeks.at(-1)!.monday).toBe("2026-10-19");
    expect(r.weeks[0]!.monday).toBe("2026-09-28");
  });

  it("確認中と否定は数えない。今季でない事例も数えない。再現の事例は数える", () => {
    const r = buildWeeks(
      [on("2026-10-14", { confirmState: "reviewing" }), on("2026-10-14", { negation: "negated" }), on("2026-10-14", { season: 2025 }), on("2026-10-14", { confirmState: "replay" })],
      2026,
      "2026-10-20",
    );
    expect(r.weeks.reduce((s, w) => s + w.count, 0)).toBe(1);
    expect(r.undated).toBe(0);
  });

  it("6〜9 月に事例があれば、その週までさかのぼる。週の始まりはシーズンの前でもよい（2025-06-01 は日曜）", () => {
    expect(buildWeeks([on("2026-06-01")], 2026, "2026-06-10").weeks.map((w) => w.monday)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(buildWeeks([on("2025-06-01", { season: 2025 })], 2025, "2025-06-02").weeks.map(({ monday, count }) => ({ monday, count }))).toEqual([
      { monday: "2025-05-26", count: 1 },
      { monday: "2025-06-02", count: 0 },
    ]);
  });

  it("0 件なら棒の週はどれも 0。10 月より前で事例がなければ週を並べない", () => {
    expect(buildWeeks([], 2026, "2026-10-05").weeks).toEqual([
      { monday: "2026-09-28", count: 0, places: [] },
      { monday: "2026-10-05", count: 0, places: [] },
    ]);
    expect(buildWeeks([], 2026, "2026-08-01")).toEqual({ weeks: [], undated: 0 });
  });
});
