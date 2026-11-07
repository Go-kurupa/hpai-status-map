import type { Case } from "@hpai/shared/types";
import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeasonCharts, type SeasonChartsProps } from "./SeasonCharts";

afterEach(cleanup);

const on = (date: string | null, prefCode = "33"): Case =>
  ({
    id: `${date}-${prefCode}`,
    season: 2026,
    prefCode,
    muniCode: null,
    stages: date ? { confirmed: { date, time: null } } : {},
    negation: "none",
    confirmState: "auto",
  }) as unknown as Case;

const base: SeasonChartsProps = {
  loaded: true,
  allUnchecked: false,
  countByPref: { "33": 1, "01": 3 },
  cases: [on("2026-10-06"), on("2026-11-02", "01"), on("2026-11-03", "01"), on("2026-11-04", "01")],
  season: 2026,
  today: "2026-11-05",
  failedPrefCodes: [],
  asOfText: "11 月 4 日 8:30 時点",
  source: "出典: 農林水産省と各県の発表",
};
const text = () => document.body.textContent ?? "";

describe("SeasonCharts", () => {
  it("県ごとの棒は多い順で、数字を棒の横に書く。棒の長さは最大に対する割合", () => {
    render(<SeasonCharts {...base} />);
    const rows = within(screen.getByRole("list", { name: "県ごとの今季の件数" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["北海道3 件", "岡山県1 件"]);
    expect((rows[0]!.querySelector(".month-bar-fill") as HTMLElement).style.width).toBe("100%");
    expect(parseFloat((rows[1]!.querySelector(".month-bar-fill") as HTMLElement).style.width)).toBeCloseTo(100 / 3);
  });

  it("週ごとの棒は最初と最後の週の日付と縦軸の目盛りを書く。読み上げは事例のある週だけで、県と町も読み込める。0 件を読ませない", () => {
    render(<SeasonCharts {...base} />);
    const list = screen.getByRole("list", { name: "週ごとの全国の発生の棒" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["10 月 5 日の週 1 件（岡山県 町名なし）", "11 月 2 日の週 3 件（北海道 町名なし（3 件））"]);
    expect(list.children).toHaveLength(6); // 9/28〜11/2 の 6 週
    // 縦軸の目盛り（最大 3 件なので 1 刻み）。棒の上に数字は置かない（2026-11-06 作者の決定）
    expect(within(screen.getByRole("list", { name: "縦軸の目盛り（件）" })).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["0", "1", "2", "3"]);
    expect(document.querySelector(".week-count")).toBeNull();
    expect(text()).toContain("9 月 28 日の週");
    expect(text()).not.toMatch(/(^|[^0-9])0 件/);
    const fills = [...list.querySelectorAll<HTMLElement>(".week-bar-fill")];
    expect(fills.map((f) => f.style.getPropertyValue("--r"))).toEqual(["0.3333", "1"]);
  });

  it("未確認の県は棒にせず『確認できていません』と書く。事例のある未確認の県の棒は残す", () => {
    render(<SeasonCharts {...base} failedPrefCodes={["01", "23"]} />);
    const rows = within(screen.getByRole("list", { name: "県ごとの今季の件数" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["北海道3 件", "岡山県1 件"]);
    expect(screen.getByText("確認できた範囲の件数です。北海道、愛知県は確認できていません。")).toBeTruthy();
  });

  it("今季 0 件で未確認の県があるときは、棒も 0 も出さず、確認できていないことだけ書く", () => {
    render(<SeasonCharts {...base} countByPref={{}} cases={[]} failedPrefCodes={["23"]} />);
    expect(screen.getByText("愛知県は確認できていません。")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("週ごとの全国の発生（今季）")).toBeNull();
    expect(text()).not.toMatch(/(^|[^0-9])0 件/);
  });

  it("今季 0 件で全県確認できているときは、枠を出さない", () => {
    const { container } = render(<SeasonCharts {...base} countByPref={{}} cases={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("読み込めていないとき、1 県も確認できていないときは、枠を出さない（月の表が断りを書く）", () => {
    const { container, rerender } = render(<SeasonCharts {...base} loaded={false} />);
    expect(container.firstChild).toBeNull();
    rerender(<SeasonCharts {...base} allUnchecked />);
    expect(container.firstChild).toBeNull();
  });

  it("日付のない事例は棒に入れず、件数を書く。県の棒には入る", () => {
    render(<SeasonCharts {...base} countByPref={{ "33": 3 }} cases={[on("2026-11-02"), on(null), on(null)]} />);
    expect(screen.getByText("日付が分からないため、週ごとの棒に入れていない事例が 2 件あります。")).toBeTruthy();
    expect(screen.getByText("3 件")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "週ごとの全国の発生の棒" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("どの事例にも日付がなければ、週の棒と軸を出さず件数だけ書く", () => {
    render(<SeasonCharts {...base} countByPref={{ "33": 1 }} cases={[on(null)]} />);
    expect(screen.queryByRole("list", { name: "週ごとの全国の発生の棒" })).toBeNull();
    expect(text()).not.toContain("最大");
    expect(screen.getByText("日付が分からないため、週ごとの棒に入れていない事例が 1 件あります。")).toBeTruthy();
  });

  it("時点と出典の 1 行、呼び出し側の断りを添える。時点がなければ出典だけ", () => {
    const { rerender } = render(<SeasonCharts {...base} note={<p>断りの文</p>} />);
    expect(screen.getByText("11 月 4 日 8:30 時点。出典: 農林水産省と各県の発表")).toBeTruthy();
    expect(screen.getByText("断りの文")).toBeTruthy();
    rerender(<SeasonCharts {...base} asOfText={null} />);
    expect(screen.getByText("出典: 農林水産省と各県の発表")).toBeTruthy();
  });

  it("禁句がない", () => {
    render(<SeasonCharts {...base} failedPrefCodes={["23"]} />);
    expect(findWordingViolations(text())).toEqual([]);
    expect(text()).not.toMatch(/安全|安心|問題ありません|区域の外です/);
  });
});
