import type { Case, HistoryCase } from "@hpai/shared/types";
import { act, cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { distanceRingsAt, distanceRingsOf } from "../../geo/distanceRings";
import { TownCasesPanel } from "./TownCasesPanel";

afterEach(cleanup);

const hist = (o: Partial<HistoryCase>): HistoryCase => ({
  season: 2025,
  no: 1,
  prefCode: "33",
  muniCode: "33203",
  muniNameThen: "津山市",
  date: "2025-12-20",
  birdUse: "採卵鶏",
  housing: "ケージ飼い",
  headCount: 430000,
  sourceUrl: "https://www.maff.go.jp/x.pdf",
  related: false,
  ...o,
});
const nowCase = (o: Partial<Case>): Case =>
  ({
    id: "c1",
    season: 2026,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    negation: "none",
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/now"],
    ...o,
  }) as unknown as Case;

const base = { current: 2026, asOf: "2026-11-04T08:30:00+09:00", nearbyTowns: [], onPick: () => {}, onClose: () => {}, historyFailed: false, onRetryHistory: () => {}, hasTown: true };
// 欄は「この町のくわしい状況」へのリンクを持つので、道筋の中で描く
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

describe("TownCasesPanel（地図で押した町の事例）", () => {
  it("今季と過去 6 シーズンの事例を、日付、用途、飼い方、羽数、資料のリンクで出す。関連農場は出さない。新しい順", () => {
    render(
      <TownCasesPanel
        {...base}
        muniCode="33203"
        muniName="津山市"
        currentCases={[nowCase({})]}
        history={[hist({}), hist({ season: 2021, no: 2, date: "2021-11-17", headCount: null }), hist({ no: 3, related: true, date: "2025-12-24" })]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("津山市");
    const lists = document.querySelectorAll(".town-cases-list");
    expect(lists[0]!.textContent).toContain("2026 年 11 月 2 日　確定");
    expect(lists[0]!.textContent).toContain("用途の記載なし・飼い方の記載なし・1,000 羽");
    const pastText = [...document.querySelectorAll(".town-cases-season")].map((e) => e.textContent);
    expect(pastText[0]).toContain("2025 年 6 月〜2026 年 5 月\u00a01 件");
    expect(pastText[0]).toContain("2025 年 12 月 20 日");
    expect(pastText[0]).toContain("採卵鶏・ケージ飼い・430,000 羽");
    expect(pastText[0]).not.toContain("12 月 24 日"); // 関連農場
    expect(pastText[1]).toContain("羽数の記載なし");
    const links = within(document.querySelector(".town-cases") as HTMLElement).getAllByRole("link");
    const external = links.filter((a) => a.getAttribute("href")!.startsWith("https://"));
    expect(external.map((a) => a.getAttribute("href"))).toEqual(["https://example.invalid/now", "https://www.maff.go.jp/x.pdf", "https://www.maff.go.jp/x.pdf"]);
    for (const a of external) expect(a.getAttribute("target")).toBe("_blank");
    // この町のくわしい状況（設計書 2026-11-06-ui-frame 4.2）
    expect(screen.getByRole("link", { name: "この町のくわしい状況" }).getAttribute("href")).toBe("/area/33203");
    expect(screen.getByText(/関連農場は件数に入れていません/)).toBeTruthy();
  });

  // 2026-11-06 作者の決定: 「今季」は日付の範囲で示し、記録がない文は短く「時点で、発生記録はありません」
  it("今季と過去は日付の範囲で見出しに出す。記録がない町は、データの時点の日付で『発生記録はありません』。0 件を安全と読ませない", () => {
    render(<TownCasesPanel {...base} muniCode="33643" muniName="西粟倉村" currentCases={[]} history={[hist({}), hist({ season: 2020, no: 5 })]} />);
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(["今季（2026 年 6 月 1 日から）", "過去 6 シーズン（2020 年 6 月〜2026 年 5 月、国の事例一覧）"]);
    // 文は言葉の途中で折れないよう塊に分けて描く
    const paras = [...document.querySelectorAll(".town-cases > p")].map((e) => e.textContent);
    expect(paras).toContain("2026 年 11 月 4 日 8:30 時点で、発生記録はありません。");
    expect(paras).toContain("発生記録はありません。");
    expect(document.body.textContent).not.toMatch(/安全|安心|0 件/);
    cleanup();
    // 時点が読めなければ日付を書かない（端末の時計で日付を作らない）
    render(<TownCasesPanel {...base} asOf={null} muniCode="33643" muniName="西粟倉村" currentCases={[]} history={[]} />);
    expect([...document.querySelectorAll(".town-cases > p")].filter((e) => e.textContent === "発生記録はありません。")).toHaveLength(2);
  });

  it("町を選んでいないときは、近くで過去に発生のある町をボタンで並べ、押すとその町を選ぶ（キーボードでも選べる）", () => {
    const onPick = vi.fn();
    render(
      <TownCasesPanel
        {...base}
        muniCode={null}
        muniName={null}
        currentCases={[]}
        history={[]}
        nearbyTowns={[{ muniCode: "33203", name: "津山市", distanceKm: 32, count: 1, seasons: [2025] }]}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "津山市" }));
    expect(onPick).toHaveBeenCalledWith("33203");
  });

  it("近くの町もなく、町も選んでいなければ何も出さない", () => {
    const { container } = render(<TownCasesPanel {...base} muniCode={null} muniName={null} currentCases={[]} history={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("今季は件数に数える事例だけを新しい順に。否定・確認中・別シーズンは出さない。過去は 6 シーズンより古いものを混ぜない", () => {
    render(
      <TownCasesPanel
        {...base}
        muniCode="33203"
        muniName="津山市"
        currentCases={[
          nowCase({ id: "a", stages: { confirmed: { date: "2026-10-20", time: null } } } as Partial<Case>),
          nowCase({ id: "b", stages: { confirmed: { date: "2026-11-03", time: null } } } as Partial<Case>),
          nowCase({ id: "neg", negation: "negated", stages: { confirmed: { date: "2026-11-01", time: null } } } as Partial<Case>),
          nowCase({ id: "rev", confirmState: "reviewing", stages: { confirmed: { date: "2026-10-25", time: null } } } as Partial<Case>),
          nowCase({ id: "old", season: 2025, stages: { confirmed: { date: "2025-12-01", time: null } } } as Partial<Case>),
        ]}
        history={[hist({}), hist({ season: 2019, no: 9, date: "2019-12-01" })]}
      />,
    );
    const nowItems = [...document.querySelectorAll(".town-cases-list")[0]!.querySelectorAll("li b")].map((b) => b.textContent);
    expect(nowItems).toEqual(["2026 年 11 月 3 日　確定", "2026 年 10 月 20 日　確定"]);
    expect(document.querySelector(".town-cases")!.textContent).not.toContain("2019 年");
  });

  it("国の事例一覧を読めなかったら、読み込み中とは分けて『もう一度読む』を出す", () => {
    const onRetryHistory = vi.fn();
    render(<TownCasesPanel {...base} muniCode="33203" muniName="津山市" currentCases={[]} history={null} historyFailed onRetryHistory={onRetryHistory} />);
    expect(screen.getByText(/過去の記録をまだ読めていません。/)).toBeTruthy();
    expect(screen.queryByText("読み込んでいます")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "もう一度読む" }));
    expect(onRetryHistory).toHaveBeenCalled();
  });

  it("町を押すと題へフォーカスが移る。閉じると開いた元のボタンへ戻る。町を選んでいない人には『閉じる』", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    try {
      const towns = [{ muniCode: "33203", name: "津山市", distanceKm: 32, count: 1, seasons: [2025] }];
      const view = (muniCode: string | null, onClose = () => {}) => (
        <MemoryRouter>
          <TownCasesPanel {...base} muniCode={muniCode} muniName={muniCode ? "津山市" : null} currentCases={[]} history={[]} nearbyTowns={towns} onClose={onClose} />
        </MemoryRouter>
      );
      const { rerender } = rtlRender(view(null));
      screen.getByRole("button", { name: "津山市" }).focus();
      rerender(view("33203", () => rerender(view(null))));
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
      fireEvent.click(screen.getByRole("button", { name: "自分の町に戻る" }));
      act(() => vi.runAllTimers());
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "津山市" }));
    } finally {
      vi.useRealTimers();
    }
    cleanup();
    render(<TownCasesPanel {...base} hasTown={false} muniCode="33203" muniName="津山市" currentCases={[]} history={[]} />);
    expect(screen.getByRole("button", { name: "閉じる" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "自分の町に戻る" })).toBeNull();
  });
});

describe("distanceRingsAt（町の中心からの輪）", () => {
  it("点を囲む 10、30、60 km の 3 本。マス目の輪と同じ作り方", () => {
    const rings = distanceRingsAt([134.29, 35.18])!;
    expect(rings.features.map((f) => f.properties.km)).toEqual([10, 30, 60]);
    expect(distanceRingsAt(null)).toBeNull();
    expect(distanceRingsAt([Number.NaN, 35])).toBeNull();
    // マス目の輪は、マス目の中心からの点の輪と同じ
    expect(distanceRingsOf("52344080")!.features[0]!.properties.km).toBe(10);
  });
});
