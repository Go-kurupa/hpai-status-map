import type { Case, HistoryCase, MuniCode, Season } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { OverlayState } from "./applyView";
import { CompareOverlay, latestOf, LATEST_COLORS, overlayOf, type CompareOverlayProps } from "./CompareOverlay";
import { CMP_TEXT } from "./compareTexts";
import { buildSeasonView } from "./seasonView";

const hist = (o: Partial<HistoryCase>): HistoryCase => ({
  season: 2024,
  no: 1,
  prefCode: "33",
  muniCode: "33203",
  muniNameThen: "津山市",
  date: "2024-12-20",
  birdUse: "採卵鶏",
  housing: null,
  headCount: 430000,
  sourceUrl: "https://www.maff.go.jp/x.pdf",
  related: false,
  ...o,
});
const nowCase = (o: Partial<Case>): Case => ({
  id: "c1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: "採卵鶏",
  housing: null,
  headCount: 1000,
  stages: { suspected: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
  ...o,
});

// 2024: 津山市・美作市、2025: 美作市・倉敷市 → 1 だけ 津山、2 だけ 倉敷、両方 美作
const HISTORY: HistoryCase[] = [
  hist({}),
  hist({ no: 2, muniCode: "33215", muniNameThen: "美作市" }),
  hist({ season: 2025, no: 1, muniCode: "33215", muniNameThen: "美作市", date: "2025-12-02" }),
  hist({ season: 2025, no: 2, muniCode: "33202", muniNameThen: "倉敷市", date: "2026-01-10" }),
  hist({ season: 2025, no: 3, muniCode: "33202", related: true }),
];
const NAMES: Record<string, string> = { "33203": "津山市", "33215": "美作市", "33202": "倉敷市" };

const view = (season: Season, o: { currentCases?: Case[] | null; history?: HistoryCase[] | null } = {}) =>
  buildSeasonView({ season, current: 2026, currentCases: o.currentCases === undefined ? [] : o.currentCases, history: o.history === undefined ? HISTORY : o.history });

type RigOpts = Partial<CompareOverlayProps> & { first?: Season; second?: Season; firstView?: ReturnType<typeof view>; secondView?: ReturnType<typeof view> };
function rig(o: RigOpts = {}) {
  const calls: Array<Parameters<CompareOverlayProps["renderMap"]>[0]> = [];
  const picks: Season[][] = [];
  const first = o.first ?? 2024;
  const second = o.second ?? 2025;
  const seasons = o.seasons ?? [first, second];
  const views = o.views ?? seasons.map((s, i) => (i === 0 && o.firstView ? o.firstView : i === 1 && o.secondView ? o.secondView : view(s)));
  const { first: _f, second: _s, firstView: _fv, secondView: _sv, ...rest } = o;
  const p: CompareOverlayProps = {
    options: [2026, 2025, 2024, 2023].map((s) => ({ season: s as Season, label: s === 2026 ? "今季" : `${2026 - s} 年前` })),
    seasons,
    onSeasons: (s) => picks.push(s),
    current: 2026,
    currentCases: [],
    history: HISTORY,
    historyFailed: false,
    onRetryHistory: () => {},
    asOf: "2026-11-10T08:30:00+09:00",
    failedPrefCodes: [],
    views,
    focus: null,
    muniName: (c: MuniCode) => NAMES[c] ?? null,
    renderMap: (m) => {
      calls.push(m);
      return <div data-testid="map" />;
    },
    ...rest,
  };
  render(
    <MemoryRouter>
      <CompareOverlay {...p} />
    </MemoryRouter>,
  );
  return { last: () => calls[calls.length - 1]!, calls, picks };
}

afterEach(cleanup);

describe("overlayOf", () => {
  it("今季は疑いも発生ありにする。どちらかが読めていなければ null", () => {
    const now = view(2026, { currentCases: [nowCase({})] });
    const s = overlayOf(now, view(2024), "both", ["01"])!;
    expect(s.first).toEqual(["33203"]);
    expect(s.unwatchedPrefCodes).toEqual(["01"]);
    expect(overlayOf(view(2024), view(2025), "both", ["01"])!.unwatchedPrefCodes).toEqual([]);
    expect(overlayOf(view(2026, { currentCases: null }), view(2024), "both", [])).toBeNull();
    expect(overlayOf(view(2024, { history: null }), view(2025, { history: null }), "both", [])).toBeNull();
  });
});

describe("CompareOverlay", () => {
  it("地図は 1 枚で、重ね合わせを渡す。凡例に 3 つの町の数", () => {
    const r = rig();
    expect(screen.getAllByTestId("map")).toHaveLength(1);
    expect(r.last().overlay).toEqual<OverlayState>({ first: ["33203", "33215"], second: ["33202", "33215"], show: "both", unwatchedPrefCodes: [], names: ["2 年前", "1 年前"] });
    const legend = screen.getByRole("list", { name: CMP_TEXT.legendAria });
    // 「比べる 1・2」ではなく、シーズンの呼び方（今季・1 年前…）で書く（作者 11/7）
    expect(within(legend).getByText("2 年前だけで発生（1 町）")).toBeTruthy();
    expect(within(legend).getByText("1 年前だけで発生（1 町）")).toBeTruthy();
    expect(legend.textContent).not.toContain("比べる");
    expect(within(legend).getByText(CMP_TEXT.legendBoth(1))).toBeTruthy();
  });

  it("見せ方の切り替え（重ねる・1 だけ・2 だけ）は出さず、いつも重ねる（2026-11-07 作者の決定）", () => {
    const r = rig();
    expect(screen.queryByRole("button", { name: "1 だけ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "2 だけ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重ねる" })).toBeNull();
    expect(r.last().overlay!.show).toBe("both");
  });

  it("町を押すと、2 つのシーズンの事例が 1 つの欄に上下に並ぶ", () => {
    const r = rig();
    act(() => r.last().onInspectMuni("33215"));
    const panel = screen.getByRole("region", { name: "美作市" });
    const heads = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads[0]).toContain("2 年前（2024 年 6 月〜2025 年 5 月）");
    expect(heads[1]).toContain("1 年前（2025 年 6 月〜2026 年 5 月）");
    expect(panel.textContent).not.toContain("比べる");
    expect(heads[0]).toContain("2024 年 6 月");
    expect(within(panel).getByText("2024 年 12 月 20 日")).toBeTruthy();
    expect(within(panel).getByText("2025 年 12 月 2 日")).toBeTruthy();
  });

  it("同じシーズンを選ぶと案内を出し、凡例は「両方」の 1 行だけ", () => {
    rig({ first: 2025, second: 2025 });
    expect(screen.getByText(CMP_TEXT.sameSeason)).toBeTruthy();
    const legend = screen.getByRole("list", { name: CMP_TEXT.legendAria });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([CMP_TEXT.legendBoth(2)]);
  });

  it("今季を読めていない間は塗らない", () => {
    const r = rig({ first: 2026, firstView: view(2026, { currentCases: null }), currentCases: null });
    // 1 シーズン分の普通の塗りを出さないよう、空の重ね合わせを渡す。確認できていない県は今季なので示す
    expect(r.last().overlay).toEqual<OverlayState>({ first: [], second: [], show: "both", unwatchedPrefCodes: [], names: ["今季", "1 年前"] });
    // 凡例も町の数も出さない（読めていない断りは MapPage が出す）
    expect(screen.queryByRole("list", { name: CMP_TEXT.legendAria })).toBeNull();
  });

  it("今季を選ぶと、疑いを含むと添え、確認できていない県を重ねる間も示す", () => {
    const cases = [nowCase({})];
    const r = rig({ first: 2026, firstView: view(2026, { currentCases: cases }), currentCases: cases, failedPrefCodes: ["01"] });
    expect(screen.getByText(CMP_TEXT.currentSuspected)).toBeTruthy();
    expect(r.last().overlay!.unwatchedPrefCodes).toEqual(["01"]);
    expect(screen.getByText(CMP_TEXT.legendUnwatched)).toBeTruthy();
  });

  it("過去 2 シーズンどうしでは、確認できていない県も疑いの断りも出さない", () => {
    const r = rig({ failedPrefCodes: ["01"] });
    expect(r.last().overlay!.unwatchedPrefCodes).toEqual([]);
    expect(screen.queryByText(CMP_TEXT.currentSuspected)).toBeNull();
    expect(screen.queryByText(CMP_TEXT.legendUnwatched)).toBeNull();
  });

  it("画面に禁じた語がない", () => {
    const r = rig();
    act(() => r.last().onInspectMuni("33215"));
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

// 3 つ以上のシーズン（設計書 2026-11-06-data-explore E12、作者 11/6 深夜。案 3「いちばん新しい発生」）
const HISTORY3: HistoryCase[] = [...HISTORY, hist({ season: 2023, no: 1, muniCode: "33203", date: "2023-12-01" }), hist({ season: 2023, no: 2, muniCode: "33201", muniNameThen: "岡山市", date: "2024-01-05" })];
const view3 = (season: Season) => buildSeasonView({ season, current: 2026, currentCases: [], history: HISTORY3 });

describe("latestOf", () => {
  it("町ごとに、選んだうち最後に発生したシーズンの色。シーズンごとに最後になった町の数", () => {
    const r = latestOf([view3(2023), view3(2024), view3(2025)], [], 2026)!;
    const color = new Map(r.state.colors);
    // 津山 2023・2024 → 2024、美作 2024・2025 → 2025、倉敷 2025、岡山 2023
    expect(color.get("33203")).toBe(r.colorOf.get(2024));
    expect(color.get("33215")).toBe(r.colorOf.get(2025));
    expect(color.get("33201")).toBe(r.colorOf.get(2023));
    expect(Object.fromEntries(r.bySeason)).toEqual({ 2023: 1, 2024: 1, 2025: 2 });
    // 色はシーズンごとに固定（今季から何年前かで決まる。選ぶ数で変わらない）。同じ系統の色を並べない。赤は使わない（作者 11/7）
    expect(r.colorOf.get(2024)).toBe(LATEST_COLORS[2]);
    expect(latestOf([view3(2024), view3(2025)], [], 2026)!.colorOf.get(2024)).toBe(LATEST_COLORS[2]);
    expect(new Set(LATEST_COLORS).size).toBe(7);
    expect(LATEST_COLORS).not.toContain("#b3261e");
    // 選んだシーズン全体で 2 回以上発生した町は、発生の回数（事例の数）を持つ（地図に「計◯回」の札。作者 11/7）
    expect(r.state.counts).toEqual([["33203", 2], ["33215", 2]]);
    expect(latestOf([view3(2023), buildSeasonView({ season: 2026, current: 2026, currentCases: null, history: HISTORY3 })], [], 2026)).toBeNull();
  });
});

describe("CompareOverlay（3 つ以上）", () => {
  it("シーズンはボタンで選ぶ。押すと足し、もう一度押すと外す。最後の 1 つは外せない", () => {
    const r = rig();
    const group = screen.getByRole("group", { name: CMP_TEXT.seasonsAria });
    expect(within(group).getByRole("button", { name: /2 年前/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: /3 年前/ }));
    expect(r.picks.at(-1)).toEqual([2023, 2024, 2025]);
    fireEvent.click(within(group).getByRole("button", { name: /2 年前/ }));
    expect(r.picks.at(-1)).toEqual([2025]);
    cleanup();
    const one = rig({ seasons: [2025], views: [view(2025)] });
    fireEvent.click(within(screen.getByRole("group", { name: CMP_TEXT.seasonsAria })).getByRole("button", { name: /1 年前/ }));
    expect(one.picks).toEqual([]);
  });

  it("3 つ選ぶと、地図に最後の発生の色を渡す。凡例に各シーズンが最後の町の数", () => {
    const r = rig({ seasons: [2023, 2024, 2025], views: [view3(2023), view3(2024), view3(2025)], history: HISTORY3 });
    expect(r.last().overlay).toBeNull();
    expect(r.last().latest!.colors).toHaveLength(4);
    const legend = screen.getByRole("list", { name: CMP_TEXT.legendAria });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      CMP_TEXT.legendLatest("3 年前（2023 年 6 月〜2024 年 5 月）", 1),
      CMP_TEXT.legendLatest("2 年前（2024 年 6 月〜2025 年 5 月）", 1),
      CMP_TEXT.legendLatest("1 年前（2025 年 6 月〜2026 年 5 月）", 2),
    ]);
    expect(screen.getByText(CMP_TEXT.latestHint)).toBeTruthy();
  });

  it("3 つのとき町を押すと、選んだシーズンごとに事例が並ぶ（新しい順）", () => {
    const r = rig({ seasons: [2023, 2024, 2025], views: [view3(2023), view3(2024), view3(2025)], history: HISTORY3 });
    act(() => r.last().onInspectMuni("33203"));
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toHaveLength(3);
    expect(heads[0]).toContain("2025 年 6 月");
    expect(heads[2]).toContain("2023 年 6 月");
  });
});

describe("「計◯回」と押した町の赤い枠（作者 11/7）", () => {
  it("同じシーズンに 2 回発生した町も、発生の回数で数える", () => {
    const h = [...HISTORY3, hist({ season: 2023, no: 9, muniCode: "33201", muniNameThen: "岡山市", date: "2024-02-01" })];
    const v = (s: Season) => buildSeasonView({ season: s, current: 2026, currentCases: [], history: h });
    const r = latestOf([v(2023), v(2024), v(2025)], [], 2026)!;
    expect(new Map(r.state.counts).get("33201")).toBe(2);
  });

  it("町を押すと地図に押した町を渡し、閉じると外す", () => {
    const r = rig({ seasons: [2023, 2024, 2025], views: [view3(2023), view3(2024), view3(2025)], history: HISTORY3 });
    expect(r.last().picked).toBeNull();
    act(() => r.last().onInspectMuni("33203"));
    expect(r.last().picked).toBe("33203");
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(r.last().picked).toBeNull();
  });

  it("凡例の下に「計◯回」の意味を書く", () => {
    rig({ seasons: [2023, 2024, 2025], views: [view3(2023), view3(2024), view3(2025)], history: HISTORY3 });
    expect(screen.getByText(CMP_TEXT.countNote)).toBeTruthy();
    expect(CMP_TEXT.countNote).toContain("計");
    expect(CMP_TEXT.countBadge(3)).toBe("計 3 回");
  });
});

