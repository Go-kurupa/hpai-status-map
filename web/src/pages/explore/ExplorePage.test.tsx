import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import historyJson from "../../../../data/history/cases.json";
import { DataSourceProvider } from "../../data/context";
import type { DataSource } from "../../data/types";
import ExplorePage from "./ExplorePage";
import { EXPLORE_TEXT } from "./texts";

const history = historyJson as HistoryCase[];
const NOW = new Date("2026-11-10T09:00:00+09:00"); // 今季は 2026

const okWatch = (failed: string[] = []): WatchStatus[] =>
  Array.from({ length: 47 }, (_, i) => {
    const prefCode = String(i + 1).padStart(2, "0");
    const ok = !failed.includes(prefCode);
    return { prefCode, checkedAt: "2026-11-10T08:30:00+09:00", ok, lastOkAt: ok ? "2026-11-10T08:30:00+09:00" : null, failingSince: ok ? null : "2026-11-09T08:30:00+09:00" };
  });

const nowCase = (o: Partial<Case> = {}): Case => ({
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
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
  ...o,
});

function rig(o: { cases?: Case[]; failed?: string[]; historyFails?: boolean } = {}) {
  const ds: DataSource = {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => {
      cb(o.cases ?? []);
      return () => {};
    },
    subscribeWildBirds: (_s: Season, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWatchStatus: (cb) => {
      cb(okWatch(o.failed));
      return () => {};
    },
    loadHistory: () => (o.historyFails ? Promise.reject(new Error("読めない")) : Promise.resolve(history)),
  };
  render(
    <MemoryRouter initialEntries={["/explore"]}>
      <DataSourceProvider value={ds}>
        <ExplorePage />
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

const press = (group: string, name: string) => fireEvent.click(within(screen.getByRole("group", { name: group })).getByRole("button", { name }));
const answer = () => document.querySelector(".explore-answer")!.textContent ?? "";

afterEach(cleanup);

describe("ExplorePage", () => {
  it("問いのボタンで条件が入る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.questionsAria, "中国地方の過去は？");
    const region = screen.getByRole("group", { name: EXPLORE_TEXT.regionLabel });
    expect(within(region).getByRole("button", { name: "中国" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("group", { name: EXPLORE_TEXT.useLabel })).getByRole("button", { name: "すべて" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("group", { name: EXPLORE_TEXT.bandLabel })).getByRole("button", { name: "すべて" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("各段は複数選べる。もう一度押すと外れ、「すべて」で戻る。地方が 2 つなら地図への口は出さない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const use = () => screen.getByRole("group", { name: EXPLORE_TEXT.useLabel });
    const pressed = () => within(use()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    press(EXPLORE_TEXT.useLabel, "肉用鶏");
    expect(pressed()).toEqual(["採卵鶏", "肉用鶏"]);
    expect(answer()).toContain("225 件");
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    expect(pressed()).toEqual(["肉用鶏"]);
    press(EXPLORE_TEXT.useLabel, "すべて");
    expect(pressed()).toEqual(["すべて"]);
    press(EXPLORE_TEXT.regionLabel, "東北");
    press(EXPLORE_TEXT.regionLabel, "関東");
    expect(answer()).toContain("88 件");
    expect(screen.queryByRole("link", { name: /地図で.*を見る/ })).toBeNull();
  });

  it("件数と棒と一覧が同時に変わる", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(answer()).toContain("19 件");
    expect(document.querySelectorAll(".explore-bars tbody tr")).toHaveLength(7);
    expect(document.querySelectorAll(".explore-cases tbody tr")).toHaveLength(19);
  });

  it("3 件以下なら守る文を件数の後に出す", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.regionLabel, "中国");
    press(EXPLORE_TEXT.bandLabel, "1,000 羽未満");
    expect(answer()).toContain("1 件");
    const risk = screen.getByText(FIXED_TEXT.riskAnywhere);
    expect(document.querySelector(".explore-answer")!.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    press(EXPLORE_TEXT.bandLabel, "すべて");
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
  });

  it("農場の数で割っていない断りがいつもある", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(screen.getByText(EXPLORE_TEXT.noDenominator)).toBeTruthy();
  });

  it("用途の記載がない今季の事例を伝える", async () => {
    rig({ cases: [nowCase({ birdUse: null })] });
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    expect(screen.getByText("用途の記載がない今季の事例 1 件は、この条件に入れていません")).toBeTruthy();
  });

  it("今季は確認できていない県の断り", async () => {
    rig({ failed: ["01", "02"] });
    await screen.findByText(/過去 6 シーズンと今季/);
    const nowRow = document.querySelector(".explore-bars tbody tr:last-child")!;
    expect(nowRow.textContent).toContain("確認できた範囲では 0 件（2 県は確認できていません）");
  });

  it("地方を選ぶと地図への口が出る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(screen.queryByRole("link", { name: /地図で.*を見る/ })).toBeNull();
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(screen.getByRole("link", { name: "地図で中国を見る" }).getAttribute("href")).toBe("/compare?region=chugoku");
  });

  it("過去を読めないときは、もう一度読む口を出し、件数の 1 文は出さない", async () => {
    rig({ historyFails: true });
    expect(await screen.findByText(EXPLORE_TEXT.historyFailed)).toBeTruthy();
    expect(screen.getByRole("button", { name: EXPLORE_TEXT.retry })).toBeTruthy();
    expect(document.querySelector(".explore-answer")).toBeNull();
  });

  it("一覧は新しい順で、資料へのリンクがある", async () => {
    rig({ cases: [nowCase({ sourceUrls: ["https://www.pref.example/a"] })] });
    await screen.findByText(/過去 6 シーズンと今季/);
    const first = document.querySelector(".explore-cases tbody tr")!;
    expect(first.textContent).toContain("2026 年 11 月 2 日");
    expect(within(first as HTMLElement).getByRole("link").getAttribute("href")).toBe("https://www.pref.example/a");
  });

  it("過去の発生の見方で「条件で見る」が選ばれている", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const nav = screen.getByRole("navigation", { name: "過去の発生の見方" });
    expect(within(nav).getByRole("link", { name: "条件で見る" }).getAttribute("aria-current")).toBe("page");
  });

  it("画面に禁じた語がない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    await act(async () => {});
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});
