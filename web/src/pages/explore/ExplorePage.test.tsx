import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { RISK_SENTENCE } from "../../ui/RiskLine";
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

function rig(o: { cases?: Case[]; failed?: string[]; historyFails?: boolean; path?: string } = {}) {
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
    loadHistory: () => (o.historyFails ? Promise.reject(new Error("読み込めない")) : Promise.resolve(history)),
  };
  render(
    <MemoryRouter initialEntries={[o.path ?? "/explore"]}>
      <DataSourceProvider value={ds}>
        <ExplorePage />
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

// ボタンの名前は「採卵鶏 171」のように件数が付く。件数の前の語で探す
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const chip = (name: string) => new RegExp(`^${esc(name)}( [0-9,]+ 件)?$`);
const press = (group: string, name: string) => fireEvent.click(within(screen.getByRole("group", { name: group })).getByRole("button", { name: group === EXPLORE_TEXT.questionsAria ? name : chip(name) }));
const answer = () => document.querySelector(".explore-answer")!.textContent ?? "";

afterEach(cleanup);

describe("ExplorePage", () => {
  it("問いのボタンで条件が入る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.questionsAria, "中国地方の過去は？");
    const region = screen.getByRole("group", { name: EXPLORE_TEXT.regionLabel });
    expect(within(region).getByRole("button", { name: chip("中国") }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("group", { name: EXPLORE_TEXT.useLabel })).getByRole("button", { name: chip("すべて") }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("group", { name: EXPLORE_TEXT.bandLabel })).getByRole("button", { name: chip("すべて") }).getAttribute("aria-pressed")).toBe("true");
  });

  it("各段は複数選べる。もう一度押すと外れ、「すべて」で戻る。地方が 2 つなら地図への口は出さない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const use = () => screen.getByRole("group", { name: EXPLORE_TEXT.useLabel });
    const pressed = () => within(use()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.firstChild!.textContent);
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    press(EXPLORE_TEXT.useLabel, "肉用鶏");
    expect(pressed()).toEqual(["採卵鶏", "肉用鶏"]);
    expect(answer()).toMatch(/: 225 件$/);
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    expect(pressed()).toEqual(["肉用鶏"]);
    press(EXPLORE_TEXT.useLabel, "すべて");
    expect(pressed()).toEqual(["すべて"]);
    press(EXPLORE_TEXT.regionLabel, "東北");
    press(EXPLORE_TEXT.regionLabel, "関東");
    expect(answer()).toMatch(/: 88 件$/);
    expect(screen.queryByRole("link", { name: /地図で.*を見る/ })).toBeNull();
  });

  it("件数と棒と一覧が同時に変わる", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(answer()).toMatch(/: 19 件$/);
    expect(document.querySelectorAll(".explore-bars tbody tr")).toHaveLength(7);
    expect(document.querySelectorAll(".explore-cases tbody tr")).toHaveLength(19);
  });

  it("3 件以下なら守る文を件数の後に出す", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.regionLabel, "中国");
    press(EXPLORE_TEXT.bandLabel, "1,000 羽未満");
    expect(answer()).toMatch(/: 1 件$/);
    const risk = screen.getByText(RISK_SENTENCE, { exact: false });
    expect(document.querySelector(".explore-answer")!.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    press(EXPLORE_TEXT.bandLabel, "すべて");
    expect(screen.queryByText(RISK_SENTENCE, { exact: false })).toBeNull();
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

  it("1 文にも、確認できていない県の断りを付ける。選んだ地方の外の県は数えない。なければ付けない（作者 11/6 夜）", async () => {
    rig({ failed: ["01", "02"] });
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(answer()).toContain("（今季は 2 県を確認できていません）");
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(answer()).not.toContain("確認できていません");
    cleanup();
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(answer()).not.toContain("確認できていません");
  });

  it("地方を選ぶと地図への口が出る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(screen.queryByRole("link", { name: /地図で.*を見る/ })).toBeNull();
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(screen.getByRole("link", { name: "地図で中国を見る" }).getAttribute("href")).toBe("/compare?region=chugoku");
  });

  it("過去を読み込めないときは、もう一度読む口を出し、件数の 1 文は出さない", async () => {
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

  it("過去の発生の見方で「数で見る」が選ばれ、見出しは「数で見る過去の発生」", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const nav = screen.getByRole("navigation", { name: "過去の発生の見方" });
    expect(within(nav).getByRole("link", { name: "数で見る" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "地図で比べる" }).getAttribute("href")).toBe("/compare");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("数で見る過去の発生");
  });

  it("地図で比べるから ?region= で開くと、その地方で絞った状態で始まる", async () => {
    rig({ path: "/explore?region=chugoku" });
    await screen.findByText(/中国の過去 6 シーズンと今季/);
    const region = screen.getByRole("group", { name: EXPLORE_TEXT.regionLabel });
    expect(within(region).getByRole("button", { name: chip("中国") }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "地図で中国を見る" }).getAttribute("href")).toBe("/compare?region=chugoku");
  });

  it("?region= の値が地方の名前でなければ、全国で始める", async () => {
    rig({ path: "/explore?region=nowhere" });
    await screen.findByText(/全国の過去 6 シーズンと今季/);
  });

  it("ボタンに件数が出る。選んでもその段のほかのボタンは 0 にならない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const use = screen.getByRole("group", { name: EXPLORE_TEXT.useLabel });
    expect(within(use).getByRole("button", { name: "採卵鶏 171 件" })).toBeTruthy();
    press(EXPLORE_TEXT.useLabel, "採卵鶏");
    expect(within(use).getByRole("button", { name: "肉用鶏 54 件" })).toBeTruthy();
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(within(use).getByRole("button", { name: "採卵鶏 16 件" })).toBeTruthy();
    // 並びは固定（件数で並べ替えない）
    expect(within(use).getAllByRole("button").map((b) => b.firstChild!.textContent)).toEqual(["すべて", "採卵鶏", "肉用鶏", "あひる", "その他"]);
  });

  it("月ごとの件数は 6 月から 5 月の 12 か月。月の行を押すとその月だけになり、もう一度押すと戻る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const months = screen.getByRole("group", { name: EXPLORE_TEXT.monthsAria });
    const buttons = within(months).getAllByRole("button");
    expect(buttons).toHaveLength(12);
    expect(buttons[0]!.textContent).toContain("6 月");
    expect(buttons[11]!.textContent).toContain("5 月");
    const dec = within(months).getByRole("button", { name: /^12 月/ });
    expect(dec.textContent).toContain("72 件");
    fireEvent.click(dec);
    expect(dec.getAttribute("aria-pressed")).toBe("true");
    expect(answer()).toMatch(/: 72 件$/);
    expect(answer()).toContain("12 月");
    expect(document.querySelectorAll(".explore-cases tbody tr")).toHaveLength(72);
    // 月で絞っても、ほかの月の数は消えない
    expect(within(months).getByRole("button", { name: /^1 月/ }).textContent).toContain("74 件");
    fireEvent.click(dec);
    expect(dec.getAttribute("aria-pressed")).toBe("false");
    expect(answer()).toMatch(/: 247 件$/);
  });

  it("日付の記載がない今季の事例は数を伝える", async () => {
    rig({ cases: [nowCase({ stages: {} })] });
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(screen.getByText(EXPLORE_TEXT.undated(1))).toBeTruthy();
  });

  it("シーズン × 月の表のセルに数が出る", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    const table = screen.getByRole("table", { name: EXPLORE_TEXT.gridCaption });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(7);
    expect(table.querySelectorAll("thead th")).toHaveLength(13);
    const total = [...table.querySelectorAll("tbody td")].reduce((n, td) => n + Number(td.textContent), 0);
    expect(total).toBe(247);
  });

  it("守る文は結果全体に 1 回だけ（月ごとには出さない）", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.regionLabel, "中国");
    press(EXPLORE_TEXT.bandLabel, "1,000 羽未満");
    expect(screen.getAllByText(RISK_SENTENCE, { exact: false })).toHaveLength(1);
  });

  it("問いのボタンは月の絞りを外す", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    fireEvent.click(within(screen.getByRole("group", { name: EXPLORE_TEXT.monthsAria })).getByRole("button", { name: /^12 月/ }));
    press(EXPLORE_TEXT.questionsAria, "中国地方の過去は？");
    expect(answer()).toMatch(/: 19 件$/);
  });

  it("守る文の境目: 3 件では出し、4 件では出さない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    press(EXPLORE_TEXT.useLabel, "肉用鶏");
    press(EXPLORE_TEXT.regionLabel, "中部");
    expect(answer()).toMatch(/: 3 件$/);
    expect(screen.getAllByText(RISK_SENTENCE, { exact: false })).toHaveLength(1);
    press(EXPLORE_TEXT.regionLabel, "中部");
    press(EXPLORE_TEXT.regionLabel, "北海道");
    expect(answer()).toMatch(/: 4 件$/);
    expect(screen.queryByText(RISK_SENTENCE, { exact: false })).toBeNull();
  });

  it("確認できていない県は、選んだ地方の中だけを数える", async () => {
    rig({ failed: ["01", "02"] });
    await screen.findByText(/過去 6 シーズンと今季/);
    const nowRow = () => document.querySelector(".explore-bars tbody tr:last-child")!.textContent ?? "";
    press(EXPLORE_TEXT.regionLabel, "中国");
    expect(nowRow()).not.toContain("確認できていません");
    expect(screen.queryByText(EXPLORE_TEXT.gridUnchecked(2))).toBeNull();
    press(EXPLORE_TEXT.regionLabel, "中国");
    press(EXPLORE_TEXT.regionLabel, "東北");
    expect(nowRow()).toContain("確認できた範囲では 0 件（1 県は確認できていません）");
    expect(screen.getByText(EXPLORE_TEXT.gridUnchecked(1))).toBeTruthy();
  });

  it("月で絞ると、日付の記載がない今季の事例を数に入れないと伝える。一覧では日付のない今季の事例を先頭に置く", async () => {
    rig({ cases: [nowCase({ stages: {} })] });
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(document.querySelector(".explore-cases tbody tr")!.textContent).toContain(EXPLORE_TEXT.noDate);
    fireEvent.click(within(screen.getByRole("group", { name: EXPLORE_TEXT.monthsAria })).getByRole("button", { name: /^12 月/ }));
    expect(screen.getByText(EXPLORE_TEXT.missingDate(1))).toBeTruthy();
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("シーズン × 月の表はキーボードで入って横に送れる", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    expect(screen.getByRole("region", { name: EXPLORE_TEXT.gridCaption }).getAttribute("tabindex")).toBe("0");
  });

  it("画面に禁じた語がない", async () => {
    rig();
    await screen.findByText(/過去 6 シーズンと今季/);
    await act(async () => {});
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
    // 条件を選び、少ない件数と断りが出た画面でも
    press(EXPLORE_TEXT.regionLabel, "中国");
    press(EXPLORE_TEXT.bandLabel, "1,000 羽未満");
    fireEvent.click(within(screen.getByRole("group", { name: EXPLORE_TEXT.monthsAria })).getByRole("button", { name: /^12 月/ }));
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});
