import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeasonBar } from "./SeasonBar";

afterEach(cleanup);

const BARS = [
  { season: 2026, label: "今季", count: 0 },
  { season: 2025, label: "昨季", count: 24 },
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

  it("件数は『24 件』と書き、読めていないものを 0 件に見せない", () => {
    render(<SeasonBar bars={BARS} selected={2026} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /昨季.*24 件/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /今季.*0 件/ })).toBeTruthy();
    const unread = screen.getByRole("button", { name: /3 年前/ });
    expect(unread.textContent).toContain("まだ読めていません");
    expect(unread.textContent).not.toMatch(/0 件/);
  });

  it("注記があれば件数に添える", () => {
    render(<SeasonBar bars={[{ season: 2026, label: "今季", count: 0, note: "確認できていない県あり" }]} selected={2026} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /今季.*0 件.*確認できていない県あり/ })).toBeTruthy();
  });

  it("押すとそのシーズンを渡す", () => {
    const onSelect = vi.fn();
    render(<SeasonBar bars={BARS} selected={2026} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /昨季/ }));
    expect(onSelect).toHaveBeenCalledWith(2025);
  });

  it("棒の長さは件数に比例し、最大でも 100%、読めていないものは 0", () => {
    const { container } = render(<SeasonBar bars={BARS} selected={2026} onSelect={() => {}} />);
    const widths = [...container.querySelectorAll<HTMLElement>(".season-bar-fill")].map((e) => e.style.width);
    expect(widths.map((w) => parseFloat(w))).toEqual([0, expect.closeTo(47.0588, 3), 100, 0]);
  });
});
