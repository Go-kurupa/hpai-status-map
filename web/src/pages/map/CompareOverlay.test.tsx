import type { Case, HistoryCase, MuniCode, Season } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { OverlayState } from "./applyView";
import { CompareOverlay, overlayOf, type CompareOverlayProps } from "./CompareOverlay";
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

function rig(o: Partial<CompareOverlayProps> & { first?: Season; second?: Season } = {}) {
  const calls: Array<Parameters<CompareOverlayProps["renderMap"]>[0]> = [];
  const first = o.first ?? 2024;
  const second = o.second ?? 2025;
  const p: CompareOverlayProps = {
    options: [2026, 2025, 2024].map((s) => ({ season: s as Season, label: s === 2026 ? "今季" : `${2026 - s} 年前` })),
    first,
    second,
    onFirst: () => {},
    onSecond: () => {},
    current: 2026,
    currentCases: [],
    history: HISTORY,
    historyFailed: false,
    onRetryHistory: () => {},
    asOf: "2026-11-10T08:30:00+09:00",
    failedPrefCodes: [],
    firstView: view(first),
    secondView: view(second),
    focus: null,
    muniName: (c: MuniCode) => NAMES[c] ?? null,
    renderMap: (m) => {
      calls.push(m);
      return <div data-testid="map" />;
    },
    ...o,
  };
  render(
    <MemoryRouter>
      <CompareOverlay {...p} />
    </MemoryRouter>,
  );
  return { last: () => calls[calls.length - 1]!, calls };
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
    expect(r.last().overlay).toEqual<OverlayState>({ first: ["33203", "33215"], second: ["33202", "33215"], show: "both", unwatchedPrefCodes: [] });
    const legend = screen.getByRole("list", { name: CMP_TEXT.legendAria });
    expect(within(legend).getByText(CMP_TEXT.legendOneOnly(1))).toBeTruthy();
    expect(within(legend).getByText(CMP_TEXT.legendTwoOnly(1))).toBeTruthy();
    expect(within(legend).getByText(CMP_TEXT.legendBoth(1))).toBeTruthy();
  });

  it("見せ方の切り替え", () => {
    const r = rig();
    const group = screen.getByRole("group", { name: CMP_TEXT.showAria });
    fireEvent.click(within(group).getByRole("button", { name: CMP_TEXT.showOne }));
    expect(r.last().overlay!.show).toBe("one");
    expect(within(group).getByRole("button", { name: CMP_TEXT.showOne }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(CMP_TEXT.legendOne(2))).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: CMP_TEXT.showTwo }));
    expect(r.last().overlay!.show).toBe("two");
  });

  it("町を押すと、2 つのシーズンの事例が 1 つの欄に上下に並ぶ", () => {
    const r = rig();
    act(() => r.last().onInspectMuni("33215"));
    const panel = screen.getByRole("region", { name: "美作市" });
    const heads = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads[0]).toContain("比べる 1");
    expect(heads[0]).toContain("2024 年 6 月");
    expect(heads[1]).toContain("比べる 2");
    expect(within(panel).getByText("2024 年 12 月 20 日")).toBeTruthy();
    expect(within(panel).getByText("2025 年 12 月 2 日")).toBeTruthy();
  });

  it("同じシーズンを選ぶと案内を出す", () => {
    rig({ first: 2025, second: 2025 });
    expect(screen.getByText(CMP_TEXT.sameSeason)).toBeTruthy();
  });

  it("今季を読めていない間は塗らない", () => {
    const r = rig({ first: 2026, firstView: view(2026, { currentCases: null }), currentCases: null });
    expect(r.last().overlay).toBeNull();
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
