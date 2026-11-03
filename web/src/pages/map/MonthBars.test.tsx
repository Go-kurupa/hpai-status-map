import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MonthBars } from "./MonthBars";

afterEach(cleanup);

describe("MonthBars", () => {
  const months = [
    { month: 10, count: 1, headCount: 459000, unknownHeadCases: 0 },
    { month: 11, count: 4, headCount: 100, unknownHeadCases: 2 },
    { month: 5, count: 0, headCount: 0, unknownHeadCases: 0 },
  ];

  it("月ごとに件数と羽数を表で出す。羽数が分からない事例は数を書く", () => {
    render(<MonthBars months={months} loaded />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]!.textContent).toContain("10 月");
    expect(rows[1]!.textContent).toContain("1 件");
    expect(rows[1]!.textContent).toContain("459,000 羽");
    expect(rows[2]!.textContent).toContain("羽数の分からない事例 2 件");
    expect(rows[3]!.textContent).toContain("0 件");
  });

  it("読めていないときは表でなく、読めていないと書く", () => {
    render(<MonthBars months={[]} loaded={false} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/まだ読めていません/)).toBeTruthy();
  });
});
