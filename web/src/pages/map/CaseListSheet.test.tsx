import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CaseListSheet } from "./CaseListSheet";
import { Legend } from "./Legend";
import { DETECTION_LIMIT_NOTE, WILD_ZONE_NOTE, type ListRow, type WildBirdRow } from "./listRows";
import { SURVEILLANCE_NOTE } from "./texts";
import { WatchAsOf, WatchLine } from "./WatchLine";

afterEach(cleanup);

const rows: ListRow[] = [
  { id: "a", prefName: "岡山県", muniName: "津山市", label: "確定", date: "2026-11-02", headCount: 430000, reviewing: false, sourceUrls: ["https://www.maff.go.jp/x.html"] },
  { id: "rev-x", prefName: "鳥取県", muniName: null, label: "確認中", date: null, headCount: null, reviewing: true, sourceUrls: ["https://example.invalid/rev"] },
  { id: "b", prefName: "北海道", muniName: "札幌市", label: "確定", date: "2026-10-30", headCount: null, reviewing: false, sourceUrls: ["javascript:alert(1)"] },
];
const birds: WildBirdRow[] = [
  { id: "w1", prefName: "北海道", muniName: "札幌市", species: "オオハクチョウ", label: "検査中", date: "2026-11-09", sourceUrl: "https://example.invalid/b" },
];

const show = (o: Partial<Parameters<typeof CaseListSheet>[0]> = {}) =>
  render(<CaseListSheet rows={rows} birds={birds} loaded={true} unwatchedCount={0} {...o} />);

describe("CaseListSheet", () => {
  it("閉じると 1 行（『一覧』のボタン、aria-expanded false）。行は出さない", () => {
    show();
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("3 件");
    expect(screen.queryByRole("list", { name: "発生の一覧" })).toBeNull();
  });

  it("押すと aria-expanded true になり、行と 3 つの注記が出る。もう一度押すと閉じる", () => {
    show();
    const btn = screen.getByRole("button", { name: /一覧/ });
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: "発生の一覧" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    for (const note of [DETECTION_LIMIT_NOTE, WILD_ZONE_NOTE, SURVEILLANCE_NOTE]) expect(screen.getByText(note)).toBeTruthy();
    expect(btn.getAttribute("aria-controls")).toBe(document.getElementById(btn.getAttribute("aria-controls")!)?.id);
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "発生の一覧" })).toBeNull();
  });

  it("確認中の行は、県名、確認中、リンクだけ。市町村、日付、羽数は出さない", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    const li = within(screen.getByRole("list", { name: "発生の一覧" })).getAllByRole("listitem")[1]!;
    expect(li.textContent).toContain("鳥取県");
    expect(li.textContent).toContain("確認中");
    expect(li.textContent).not.toMatch(/羽|月|日/);
    expect(li.querySelector("a")?.getAttribute("href")).toBe("https://example.invalid/rev");
  });

  it("確定の行は、県、市町村、段階、日付、羽数、出典のリンク。http(s) 以外はリンクにしない", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    const items = within(screen.getByRole("list", { name: "発生の一覧" })).getAllByRole("listitem");
    expect(items[0]!.textContent).toMatch(/岡山県.*津山市.*確定.*2026 年 11 月 2 日.*430,000 羽/);
    expect(items[0]!.querySelector("a")?.getAttribute("href")).toBe("https://www.maff.go.jp/x.html");
    expect(items[0]!.querySelector("a")?.getAttribute("rel")).toContain("noopener");
    expect(items[2]!.textContent).toContain("羽数の記載なし");
    expect(items[2]!.querySelector("a")).toBeNull();
  });

  it("野鳥は別の一覧。検査中と確定を区別する", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    const bl = screen.getByRole("list", { name: "野鳥の一覧" });
    expect(bl.textContent).toMatch(/札幌市.*オオハクチョウ.*検査中.*2026 年 11 月 9 日/);
  });

  it("野鳥を出さないとき（birds が null）は野鳥の一覧を出さない。環境省の区域の注記は常に出す", () => {
    show({ birds: null });
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    expect(screen.queryByRole("list", { name: "野鳥の一覧" })).toBeNull();
    expect(screen.getByText(WILD_ZONE_NOTE)).toBeTruthy();
  });

  it("読めていないときは件数を出さず、『発生がないとは言えません』。0 件にしない", () => {
    show({ rows: [], birds: [], loaded: false });
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("まだ読めていません");
    expect(btn.textContent).not.toMatch(/0 件/);
    fireEvent.click(btn);
    expect(screen.getByText(/発生がないとは言えません/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "発生の一覧" })).toBeNull();
  });

  it("読めていて 0 行なら、その旨", () => {
    show({ rows: [], birds: [] });
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    expect(screen.getByText(/一覧にできる発生の報告はありません/)).toBeTruthy();
  });

  it("見回りに失敗した県があるとき、0 行を『報告はありません』と断定しない。確認できた範囲、M 県は確認できていません", () => {
    show({ rows: [], birds: [], unwatchedCount: 2 });
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("確認できた範囲では 0 件");
    fireEvent.click(btn);
    const body = document.body.textContent ?? "";
    expect(body).toContain("確認できた範囲では、一覧にできる発生の報告はありません（2 県は確認できていません）");
    expect(body).not.toContain("この期間に、一覧にできる発生の報告はありません");
  });

  it("47 県とも確認できていないときの空は『まだ確認できていません』。0 件にしない", () => {
    show({ rows: [], birds: [], unwatchedCount: 47 });
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("まだ確認できていません");
    expect(btn.textContent).not.toMatch(/0 件/);
    fireEvent.click(btn);
    expect(document.body.textContent).not.toContain("報告はありません");
    expect(document.body.textContent).toContain("まだ確認できていません");
  });

  it("失敗した県があっても行はそのまま出し、件数は『確認できた範囲では N 件』", () => {
    show({ unwatchedCount: 1 });
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("確認できた範囲では 3 件");
    fireEvent.click(btn);
    expect(within(screen.getByRole("list", { name: "発生の一覧" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("全県確認できているとき（0）は従来どおり", () => {
    show({ rows: [], birds: [], unwatchedCount: 0 });
    expect(screen.getByRole("button", { name: /一覧/ }).textContent).toContain("0 件");
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    expect(screen.getByText(/この期間に、一覧にできる発生の報告はありません/)).toBeTruthy();
  });

  it("全文に禁止語がない", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /一覧/ }));
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("Legend", () => {
  it("疑い（斜線）、確定（単色）、野鳥の検査中、野鳥の確定、確認できていない県の 5 つ", () => {
    render(<Legend isCurrent={true} />);
    const items = within(screen.getByRole("list", { name: "地図の見方" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["疑い", "確定", "野鳥の検査中", "野鳥の確定", "確認できていない県"]);
    expect(items[0]!.querySelector(".swatch-hatch")).not.toBeNull();
    expect(items[1]!.querySelector(".swatch-solid")).not.toBeNull();
    expect(items[4]!.querySelector(".swatch-unwatched")).not.toBeNull();
  });

  it("過去のシーズンでは、疑いと確定の見本が過去の色になる", () => {
    render(<Legend isCurrent={false} />);
    expect(document.querySelector(".swatch-solid.is-past")).not.toBeNull();
    expect(document.querySelector(".swatch-hatch.is-past")).not.toBeNull();
  });
});

describe("WatchLine", () => {
  it("確認状況の文をそのまま出す。確認できていない県があれば、発生がないとは言えない旨を添える", () => {
    render(<WatchLine loaded={true} line={{ text: "47 都道府県のうち 46 件を確認、1 件は確認できていません（岡山県）", asOf: null, failedPrefCodes: ["33"], okCount: 46 }} />);
    const el = screen.getByTestId("watch-line");
    expect(el.textContent).toContain("47 都道府県のうち 46 件を確認、1 件は確認できていません（岡山県）");
    expect(el.textContent).toContain("発生がないとは言えません");
  });

  it("全県確認なら添えない", () => {
    render(<WatchLine loaded={true} line={{ text: "47 都道府県のうち 47 件を確認、0 件は確認できていません", asOf: null, failedPrefCodes: [], okCount: 47 }} />);
    expect(screen.getByTestId("watch-line").textContent).not.toContain("言えません");
  });

  it("見回りの結果が未着のときは、文を出さず『まだ読めていません』", () => {
    render(<WatchLine loaded={false} line={{ text: "47 都道府県のうち 0 件を確認、47 件は確認できていません（北海道）", asOf: null, failedPrefCodes: ["01"], okCount: 0 }} />);
    expect(screen.getByTestId("watch-line").textContent).toContain("まだ読めていません");
  });
});

describe("WatchAsOf（いつ時点か）", () => {
  const line = (o: Partial<Parameters<typeof WatchAsOf>[0]["line"]> = {}) => ({
    text: "",
    asOf: "2026-11-04T08:30:00+09:00",
    failedPrefCodes: [] as string[],
    okCount: 47,
    ...o,
  });

  it("確認できた県があれば『8:30 時点』", () => {
    render(<WatchAsOf loaded={true} line={line()} />);
    expect(document.querySelector(".as-of")?.textContent).toBe("11 月 4 日 8:30 時点");
  });

  it("確認できた県が 0 のときは『時点』と出さず、最後に確認を試した時刻だと分かる言い方にする", () => {
    render(<WatchAsOf loaded={true} line={line({ okCount: 0 })} />);
    const t = document.querySelector(".as-of")?.textContent ?? "";
    expect(t).toContain("最後に確認を試した");
    expect(t).toContain("11 月 4 日 8:30");
    expect(t).not.toContain("時点");
  });

  it("時刻がなければ『確認できていません』。結果が未着でも同じ", () => {
    render(<WatchAsOf loaded={true} line={line({ asOf: null, okCount: 0 })} />);
    expect(document.querySelector(".as-of")?.textContent).toBe("確認できていません");
    cleanup();
    render(<WatchAsOf loaded={false} line={line({ asOf: null, okCount: 0 })} />);
    expect(document.querySelector(".as-of")?.textContent).toBe("確認できていません");
  });
});
