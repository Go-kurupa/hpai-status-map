import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MonthBars } from "./MonthBars";
import { TEXT } from "./texts";

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

  it("過去のシーズンの棒に印を付ける（今季には付けない）", () => {
    const { container, rerender } = render(<MonthBars months={months} loaded past />);
    expect(container.querySelector(".month-bars.is-past")).not.toBeNull();
    rerender(<MonthBars months={months} loaded />);
    expect(container.querySelector(".month-bars.is-past")).toBeNull();
  });

  it("読み込めていないときは表でなく、読み込めていないと書く", () => {
    render(<MonthBars months={[]} loaded={false} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/まだ読み込めていません/)).toBeTruthy();
  });

  it("allUnchecked では表を出さず、まだ確認できていないと書く", () => {
    render(<MonthBars months={months} loaded allUnchecked />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(TEXT.listNoneChecked)).toBeTruthy();
    expect(document.body.textContent).not.toContain("0 件");
  });

  it("allUnchecked でも読み込めていないときは今のまま", () => {
    render(<MonthBars months={[]} loaded={false} allUnchecked />);
    expect(screen.getByText(/まだ読み込めていません/)).toBeTruthy();
    expect(screen.queryByText(TEXT.listNoneChecked)).toBeNull();
  });
});
