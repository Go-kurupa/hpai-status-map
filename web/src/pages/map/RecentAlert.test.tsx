import type { Case, WildBird } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { RecentAlert, recentAlertItems } from "./RecentAlert";

const TODAY = "2026-11-20";
afterEach(cleanup);

function mk(o: Partial<Case> & { id: string }): Case {
  return {
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: "採卵鶏",
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2026-11-18", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-18T12:00:00+09:00",
    ...o,
  };
}
function bird(o: Partial<WildBird> & { id: string }): WildBird {
  return {
    season: 2026,
    date: "2026-11-15",
    prefCode: "46",
    muniCode: "46208",
    muniName: "出水市",
    species: "ナベヅル",
    test: "hpai_confirmed",
    focusZone: { from: null, to: null },
    sourceUrl: "https://example.invalid/b",
    ...o,
  };
}

describe("recentAlertItems", () => {
  it("今日を含む 14 日の養鶏場などと野鳥を、新しい順に並べる", () => {
    const items = recentAlertItems({
      cases: [
        mk({ id: "a", stages: { suspected: { date: "2026-11-19", time: null } } }),
        mk({ id: "b" }),
        // 14 日目（11/7）は入り、15 日目（11/6）は入らない
        mk({ id: "c", stages: { confirmed: { date: "2026-11-07", time: null } } }),
        mk({ id: "d", stages: { confirmed: { date: "2026-11-06", time: null } } }),
      ],
      birds: [bird({ id: "x" }), bird({ id: "y", date: "2026-11-19", test: "screening_positive", prefCode: "01", muniName: null })],
      current: 2026,
      today: TODAY,
    });
    expect(items.map((i) => [i.date, i.kind, i.stage, i.place])).toEqual([
      ["2026-11-19", "farm", "suspected", "岡山県 津山市"],
      ["2026-11-19", "bird", "screening", "北海道"],
      ["2026-11-18", "farm", "confirmed", "岡山県 津山市"],
      ["2026-11-15", "bird", "confirmed", "鹿児島県 出水市"],
      ["2026-11-07", "farm", "confirmed", "岡山県 津山市"],
    ]);
  });

  it("否定・否定の候補・確認中・日付のない事例・前のシーズン・未来の日付・野鳥の陰性は並べない", () => {
    const items = recentAlertItems({
      cases: [
        mk({ id: "n", negation: "negated" }),
        mk({ id: "c", negation: "candidate" }),
        mk({ id: "r", confirmState: "reviewing", muniName: null, muniCode: null }),
        mk({ id: "u", stages: {} }),
        mk({ id: "s", season: 2025 }),
        mk({ id: "f", stages: { confirmed: { date: "2026-11-21", time: null } } }),
      ],
      birds: [
        bird({ id: "neg", test: "negative" }),
        bird({ id: "old", season: 2025 }),
        // 野鳥も 15 日目（11/6）と未来の日付は入れない
        bird({ id: "d15", date: "2026-11-06" }),
        bird({ id: "fut", date: "2026-11-21" }),
      ],
      current: 2026,
      today: TODAY,
    });
    expect(items).toEqual([]);
  });
});

const show = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const items = (n: number) =>
  recentAlertItems({
    cases: Array.from({ length: n }, (_, i) => mk({ id: `k${i}`, stages: { confirmed: { date: `2026-11-${String(19 - i).padStart(2, "0")}`, time: null } } })),
    birds: [],
    current: 2026,
    today: TODAY,
  });

describe("RecentAlert", () => {
  it("見出しに期間の日付を書き、1 件 1 行で日付・場所・段階を出す", () => {
    show(<RecentAlert items={recentAlertItems({ cases: [mk({ id: "a" })], birds: [bird({ id: "x", test: "screening_positive" })], current: 2026, today: TODAY })} today={TODAY} limit={5} uncheckedNote={null} />);
    const box = screen.getByRole("region", { name: /直近 14 日の発生/ });
    expect(box.textContent).toContain("直近 14 日の発生（11 月 7 日〜11 月 20 日）");
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["11 月 18 日岡山県 津山市養鶏場など（確定）", "11 月 15 日鹿児島県 出水市野鳥（検査中）"]);
    expect(findForbiddenPhrases(box.textContent ?? "")).toEqual([]);
  });

  it("1 件もないときは何も出さない（「発生はありません」と書かない）", () => {
    const { container } = show(<RecentAlert items={[]} today={TODAY} limit={5} uncheckedNote="北海道は確認できていません。" />);
    expect(container.innerHTML).toBe("");
  });

  it("多いときは limit 行までにし、残りは一覧の画面へのリンクにする", () => {
    show(<RecentAlert items={items(7)} today={TODAY} limit={3} uncheckedNote={null} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "ほか 4 件を一覧で見る" }).getAttribute("href")).toBe("/season");
  });

  it("確認できていない県があれば、枠の中に書き添える", () => {
    show(<RecentAlert items={items(1)} today={TODAY} limit={5} uncheckedNote="北海道、青森県は確認できていません。" />);
    expect(screen.getByRole("region", { name: /直近 14 日の発生/ }).textContent).toContain("北海道、青森県は確認できていません。");
  });

  it("スマホ（compact）は件数だけの 1 行に畳む。押すと期間と全部の行が開く（2026-11-07 作者の決定 案 A）", () => {
    show(<RecentAlert items={items(4)} today={TODAY} limit={3} uncheckedNote={null} compact />);
    const toggle = screen.getByRole("button", { name: /直近 14 日の発生 4 件/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("region", { name: /直近 14 日の発生/ }).textContent).toBe("直近 14 日の発生 4 件▸");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "ほか 1 件を一覧で見る" })).toBeTruthy();
    expect(screen.getByText("11 月 7 日〜11 月 20 日")).toBeTruthy();
  });

  it("確認できていない県があるときは、畳んだ行に件数を出さない（件数を全部と読ませない）。開くと書き添えが出る", () => {
    show(<RecentAlert items={items(2)} today={TODAY} limit={3} uncheckedNote="北海道は確認できていません。" compact />);
    const toggle = screen.getByRole("button", { name: /直近 14 日の発生/ });
    expect(toggle.textContent).not.toMatch(/件/);
    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: /直近 14 日の発生/ }).textContent).toContain("北海道は確認できていません。");
  });
});
