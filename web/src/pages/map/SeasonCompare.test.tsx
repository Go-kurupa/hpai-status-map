import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Case, HistoryCase } from "@hpai/shared/types";
import { findWordingViolations } from "@hpai/shared/wording";
import historyJson from "../../../../data/history/cases.json";
import { COMPARE_DISCLAIMER, countThisSeasonToDate, SeasonCompare, type SeasonCompareProps } from "./SeasonCompare";

afterEach(cleanup);

const history = historyJson as HistoryCase[];
const caseOf = (date: string, o: Partial<Case> = {}): Case =>
  ({ id: date, season: 2026, nationalNo: 1, prefNo: null, prefCode: "33", muniCode: "33202", muniName: "x", birdUse: null, housing: null, headCount: null, stages: { confirmed: { date, time: null } }, radiiKm: [], prefEstimates: { shipment: null, movement: null, surveillance: null }, negation: "none", negatedAt: null, confirmState: "national", sourceUrls: [], updatedAt: `${date}T00:00:00+09:00`, ...o }) as Case;

const base: SeasonCompareProps = {
  today: "2026-11-04",
  current: 2026,
  currentCases: [],
  history,
  historyFailed: false,
  asOf: "2026-11-04T08:30:00+09:00",
  unchecked: 0,
  allUnchecked: false,
};
const text = () => document.body.textContent ?? "";

describe("SeasonCompare", () => {
  it("今季と昨季の文が出る（同じ時期までの件数と合計）", () => {
    render(<SeasonCompare {...base} currentCases={[caseOf("2026-11-01"), caseOf("2026-11-03")]} />);
    expect(screen.getByTestId("compare-lead").textContent).toBe(
      "今季（2026/27）は 11 月 4 日までに 2 件。昨季（2025/26）の同じ時期までは 3 件、シーズンの合計は 24 件でした。",
    );
  });
  it("6 シーズンの行と合計が表に並ぶ", () => {
    render(<SeasonCompare {...base} />);
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    for (const total of ["52 件", "25 件", "84 件", "11 件", "51 件", "24 件"]) expect(rows.some((r) => r.includes(total))).toBe(true);
    expect(screen.getByText("12 月").parentElement!.textContent).toContain("72 件");
  });
  it("但し書きと 2 つの時点が出る", () => {
    render(<SeasonCompare {...base} />);
    expect(text()).toContain(COMPARE_DISCLAIMER);
    expect(text()).toContain("時点: 国の事例一覧、確認日 2026-11-02");
    expect(text()).toContain("今季のデータの時点: 11 月 4 日 8:30 時点");
  });
  it("禁句と予測の言い方がない", () => {
    render(<SeasonCompare {...base} />);
    expect(findWordingViolations(text())).toEqual([]);
    expect(text()).not.toMatch(/多くなる|増える|減る|少なくなる|予測します/);
  });
  it("今季が読めていない、確認できていない県があるときは 0 件と書かない", () => {
    const { rerender } = render(<SeasonCompare {...base} currentCases={null} />);
    expect(screen.getByTestId("compare-lead").textContent).toContain("まだ読めていません");
    rerender(<SeasonCompare {...base} unchecked={3} />);
    expect(screen.getByTestId("compare-lead").textContent).toContain("確認できた範囲では 0 件（3 県は確認できていません）");
    rerender(<SeasonCompare {...base} unchecked={47} allUnchecked />);
    expect(screen.getByTestId("compare-lead").textContent).toContain("まだ確認できていません");
    expect(screen.getByTestId("compare-lead").textContent).not.toMatch(/今季.*(^|[^0-9])0 件/);
  });
  it("過去の記録が読めていなくても、但し書きと時点は出て、件数は出さない", () => {
    render(<SeasonCompare {...base} history={null} />);
    expect(text()).toContain("まだ読めていません");
    expect(text()).toContain(COMPARE_DISCLAIMER);
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("横にはみ出さない作り: 表は幅 100% の固定レイアウト（CSS）", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "map.css"), "utf8");
    expect(css).toMatch(/\.compare-table\s*\{[^}]*width: 100%[^}]*table-layout: fixed/);
  });
});

describe("countThisSeasonToDate", () => {
  it("今日までの、数える事例だけ", () => {
    const cs = [caseOf("2026-11-04"), caseOf("2026-11-05"), caseOf("2026-10-01", { negation: "negated" }), caseOf("2026-10-02", { confirmState: "reviewing" }), caseOf("2025-12-01", { season: 2025 })];
    expect(countThisSeasonToDate(cs, 2026, "2026-11-04")).toBe(1);
  });
});
