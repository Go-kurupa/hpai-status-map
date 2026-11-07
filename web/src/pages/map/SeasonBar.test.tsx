import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeasonBar } from "./SeasonBar";

afterEach(cleanup);

const BARS = [
  { season: 2026, label: "今季", count: 0 },
  { season: 2025, label: "1 年前", count: 24 },
  { season: 2024, label: "2 年前", count: 51 },
  { season: 2023, label: "3 年前", count: null },
];

describe("SeasonBar", () => {
  it("棒は aria-pressed の button で、選んだものだけ true", () => {
    render(<SeasonBar bars={BARS} selected={2025} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
  });

  it("件数は『24 件』と書き、読み込めていないものを 0 件に見せない", () => {
    render(<SeasonBar bars={BARS} selected={2026} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /1 年前.*24 件/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /今季.*0 件/ })).toBeTruthy();
    const unread = screen.getByRole("button", { name: /3 年前/ });
    expect(unread.textContent).toContain("まだ読み込めていません");
    expect(unread.textContent).not.toMatch(/0 件/);
  });

  it("確認できていない県があれば『確認できた範囲では N 件（M 県は確認できていません）』と、県の数を出す", () => {
    render(<SeasonBar bars={[{ season: 2026, label: "今季", count: 0, unchecked: 3 }]} selected={2026} onSelect={() => {}} />);
    const btn = screen.getByRole("button", { name: /今季/ });
    expect(btn.textContent).toContain("確認できた範囲では 0 件（3 県は確認できていません）");
    expect(btn.textContent).not.toMatch(/(^|[^0-9])0 件$/);
  });

  it("47 県とも確認できていないときは件数を見出しにせず『まだ確認できていません』", () => {
    render(<SeasonBar bars={[{ season: 2026, label: "今季", count: 0, unchecked: 47, allUnchecked: true }]} selected={2026} onSelect={() => {}} />);
    const btn = screen.getByRole("button", { name: /今季/ });
    expect(btn.textContent).toContain("まだ確認できていません");
    expect(btn.textContent).not.toContain("0 件");
  });

  it("押すとそのシーズンを渡す", () => {
    const onSelect = vi.fn();
    render(<SeasonBar bars={BARS} selected={2026} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /1 年前/ }));
    expect(onSelect).toHaveBeenCalledWith(2025);
  });

  it("今季でない棒に印を付ける", () => {
    const { container } = render(<SeasonBar bars={BARS} selected={2026} onSelect={() => {}} current={2026} />);
    const fills = [...container.querySelectorAll<HTMLElement>(".season-bar-fill")];
    expect(fills.map((e) => e.classList.contains("is-past"))).toEqual(BARS.map((b) => b.season !== 2026));
  });

  it("棒の長さは件数に比例し、最大でも 100%、読み込めていないものは 0", () => {
    const { container } = render(<SeasonBar bars={BARS} selected={2026} onSelect={() => {}} />);
    const widths = [...container.querySelectorAll<HTMLElement>(".season-bar-fill")].map((e) => e.style.width);
    expect(widths.map((w) => parseFloat(w))).toEqual([0, expect.closeTo(47.0588, 3), 100, 0]);
  });
});
