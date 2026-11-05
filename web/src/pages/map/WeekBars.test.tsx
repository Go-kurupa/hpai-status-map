import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WeekBar } from "./seasonView";
import { WeekBars, weekPlaceLines, weekTicks } from "./WeekBars";

afterEach(cleanup);

const week = (monday: string, places: WeekBar["places"]): WeekBar => ({ monday, count: places.length, places });
const WEEKS: WeekBar[] = [
  week("2026-11-23", [
    { prefCode: "33", muniName: "津山市" },
    { prefCode: "33", muniName: "津山市" },
    { prefCode: "28", muniName: "姫路市" },
    { prefCode: "31", muniName: null },
  ]),
  week("2026-11-30", []),
  week("2026-12-07", [{ prefCode: "01", muniName: "札幌市" }]),
];

describe("weekTicks（縦軸の目盛り）", () => {
  it("3〜4 本になる切りのよい刻みで、上の端は最大以上", () => {
    expect(weekTicks(3)).toEqual({ step: 1, top: 3 });
    expect(weekTicks(11)).toEqual({ step: 4, top: 12 });
    expect(weekTicks(1)).toEqual({ step: 1, top: 1 });
    expect(weekTicks(37)).toEqual({ step: 10, top: 40 });
  });
});

describe("weekPlaceLines（詳細の県と町）", () => {
  it("県の番号の順に 1 県 1 行。同じ町が 2 件以上なら件数を添え、町の分からない発表は『町名なし』", () => {
    expect(weekPlaceLines(WEEKS[0]!.places)).toEqual(["兵庫県 姫路市", "鳥取県 町名なし", "岡山県 津山市（2 件）"]);
  });

  it("4 県を超えたら『ほか N 県』にまとめる", () => {
    const places = ["01", "02", "03", "04", "05", "06"].map((prefCode) => ({ prefCode, muniName: "某市" }));
    const lines = weekPlaceLines(places);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe("ほか 2 県");
  });
});

describe("WeekBars", () => {
  it("棒にフォーカスすると、その週の件数、日付、県と町を出す。0 件の週はフォーカスできない", () => {
    render(<WeekBars weeks={WEEKS} />);
    const list = screen.getByRole("list", { name: "週ごとの全国の発生の棒" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2); // 0 件の週は読み上げにも出さない
    expect(list.children[1]!.getAttribute("tabindex")).toBeNull();
    fireEvent.focus(items[0]!);
    const tip = document.querySelector(".week-tip")!;
    expect(tip.textContent).toBe("4 件11 月 23 日〜11 月 29 日兵庫県 姫路市鳥取県 町名なし岡山県 津山市（2 件）");
    expect(items[0]!.classList.contains("is-on")).toBe(true);
  });

  it("左右のキーで、件数のある週だけを移る。Escape で閉じる", () => {
    render(<WeekBars weeks={WEEKS} />);
    const items = within(screen.getByRole("list", { name: "週ごとの全国の発生の棒" })).getAllByRole("listitem");
    expect(items[0]!.getAttribute("tabindex")).toBe("0");
    items[0]!.focus();
    fireEvent.keyDown(items[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(items[1]);
    expect(document.querySelector(".week-tip")!.textContent).toContain("北海道 札幌市");
    fireEvent.keyDown(items[1]!, { key: "Escape" });
    expect(document.querySelector(".week-tip")).toBeNull();
  });

  it("縦軸の目盛りを出し、棒の高さは上の端に対する割合", () => {
    render(<WeekBars weeks={WEEKS} />);
    expect(within(screen.getByRole("list", { name: "縦軸の目盛り（件）" })).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["0", "1", "2", "3", "4"]);
    const fills = [...document.querySelectorAll<HTMLElement>(".week-bar-fill")];
    expect(fills.map((f) => f.style.getPropertyValue("--r"))).toEqual(["1", "0.25"]);
  });
});
