import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { RowItem, RowList } from "./RowList";
import { StatRow, StatTile } from "./StatRow";

afterEach(cleanup);

describe("StatTile", () => {
  it("読み込み中は「…」、読めないときは「読み込めませんでした」で、0 と言わない", () => {
    render(
      <StatRow label="状態">
        <StatTile label="今日の死亡" value={{ status: "loading" }} />
        <StatTile label="直近 7 日" value={{ status: "failed" }} />
        <StatTile label="今日の入力" value={{ status: "ok", value: "2 / 3", unit: "鶏舎" }} note="1 鶏舎は未入力" />
      </StatRow>,
    );
    const items = within(screen.getByRole("list", { name: "状態" })).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["今日の死亡…", "直近 7 日読み込めませんでした", "今日の入力2 / 3鶏舎1 鶏舎は未入力"]);
  });
  it("tone=alert の札だけ赤い枠の class が付き、href があれば札全体がリンクになる", () => {
    render(
      <StatRow label="状態">
        <StatTile label="鶏舎" value={{ status: "ok", value: "0", unit: "件" }} tone="alert" href="#houses" />
      </StatRow>,
    );
    expect(screen.getByRole("listitem").className).toContain("is-alert");
    expect(screen.getByRole("link").getAttribute("href")).toBe("#houses");
  });
  it("札の並びの class は .stat-tiles（地図の .stat-row と別）。PC の幅でも 1 列に詰めず、折り返す", () => {
    render(
      <StatRow label="状態">
        {["a", "b", "c", "d", "e"].map((k) => (
          <StatTile key={k} label={k} value={{ status: "ok", value: "1" }} />
        ))}
      </StatRow>,
    );
    const list = screen.getByRole("list", { name: "状態" });
    expect(list.className).toBe("stat-tiles");
    expect(list.className).not.toContain("stat-row");
    const css = readFileSync("web/src/ui/theme.css", "utf-8");
    // 地図の 64rem 以上の規則（grid-auto-flow: column）は .stat-row だけ。.stat-tiles には当てない
    for (const m of css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)) {
      if (/grid-auto-flow/.test(m[1]!)) expect(m[1]).not.toMatch(/\.stat-tiles/);
    }
    expect(css).toMatch(/\.stat-tiles\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
    expect(css).not.toMatch(/\.stat-tiles[^{]*\{[^}]*grid-auto-flow/);
  });
});

describe("RowItem", () => {
  it("印は文字と読み上げの名前の両方で出し、押すものと行の下のものを置ける", () => {
    render(
      <RowList label="今日の入力">
        <RowItem mark="todo" title="2 号舎" sub="飼養 400 羽" act={<button type="button">記録する</button>} more={<p>結果</p>} />
        <RowItem mark="done" title="1 号舎" />
        <RowItem mark="off" markLabel="空舎" title="3 号舎" />
      </RowList>,
    );
    expect(screen.getByRole("img", { name: "未入力" }).textContent).toBe("☐");
    expect(screen.getByRole("img", { name: "記録済み" }).textContent).toBe("☑");
    expect(screen.getByRole("img", { name: "空舎" }).textContent).toBe("－");
    expect(screen.getByRole("button", { name: "記録する" })).toBeTruthy();
    expect(screen.getByText("結果")).toBeTruthy();
  });
});
