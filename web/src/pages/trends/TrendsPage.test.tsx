import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrendsPage from "./TrendsPage";
import type { MigrationSummary } from "./migrationTypes";
import { parseTrendSummary, type TrendSummary } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 画面の試験に使う、作った集計（実測ではない。data/ には入れない）
const SUMMARY: TrendSummary = {
  generatedAt: "2026-11-08T10:00:00+09:00",
  seasons: [
    {
      season: 2025,
      surveyed: 24,
      items: [
        { key: "external_clothing", label: "外部事業者の専用の衣服や靴", issueCount: 13, notMentionedCount: 5 },
        { key: "rodent_signs", label: "ねずみの痕跡", issueCount: 14, notMentionedCount: 4 },
        { key: "wall_net_damage", label: "壁やネットの破損", issueCount: 6, notMentionedCount: 10 },
      ],
    },
  ],
  sourceUrls: ["https://www.maff.go.jp/j/syouan/douei/tori/r7_hpai_kokunai.html"],
};

// 渡り鳥の枠は別のファイルを読む。この画面の試験では、形の正しい作り物を返して、現地調査の集計の試験と混ざらないようにする
const MIGRATION: MigrationSummary = {
  generatedAt: "2026-11-04T18:30:00+09:00",
  currentSeason: 2026,
  baselineSeasons: [2021, 2022, 2023, 2024, 2025],
  sourceUrl: "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html",
  sites: [],
  arrivals: [],
};

type Reply = unknown | "missing" | "html" | "error";
function stub(r: Reply) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (String(url).endsWith("migration/summary.json")) return Promise.resolve(new Response(JSON.stringify(MIGRATION), { status: 200, headers: { "content-type": "application/json" } }));
      if (!String(url).endsWith("trends/summary.json")) return Promise.reject(new Error(`想定しない通信: ${url}`));
      if (r === "missing") return Promise.resolve(new Response("", { status: 404 }));
      if (r === "html") return Promise.resolve(new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
      if (r === "error") return Promise.resolve(new Response("", { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }));
    }),
  );
}
const show = () =>
  render(
    <MemoryRouter>
      <TrendsPage />
    </MemoryRouter>,
  );

describe("戻る道と表の見た目", () => {
  it("表は .data-table で .table-scroll に入り、件数のセルは .num", async () => {
    stub(SUMMARY);
    show();
    const table = await screen.findByRole("table");
    expect(table.classList.contains("data-table")).toBe(true);
    expect(table.parentElement!.classList.contains("table-scroll")).toBe(true);
    for (const td of Array.from(table.querySelectorAll("tbody td"))) expect(td.classList.contains("num")).toBe(true);
  });

  it.each(["missing", "error", "ready"] as const)("%s の分岐の末尾に、地図に戻ると試験の結果を見るがあり、.tap-link", async (r) => {
    stub(r === "ready" ? SUMMARY : r);
    const { container } = show();
    await screen.findByRole(r === "ready" ? "table" : r === "error" ? "alert" : "heading", r === "missing" ? { name: /発生傾向/ } : undefined);
    const back = within(container).getAllByRole("link", { name: "地図に戻る" });
    const results = within(container).getAllByRole("link", { name: "試験の結果を見る" });
    expect(back).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(back[0]!.getAttribute("href")).toBe("/");
    expect(results[0]!.getAttribute("href")).toBe("/results");
    expect(back[0]!.classList.contains("tap-link")).toBe(true);
    expect(results[0]!.classList.contains("tap-link")).toBe(true);
  });

  it("読み込み中にはリンクを足さない", () => {
    stub(SUMMARY);
    const { container } = show();
    expect(within(container).queryByRole("link", { name: "地図に戻る" })).toBeNull();
  });
});

describe("渡りの経路図の枠", () => {
  it.each(["missing", "error", "ready"] as const)("%s の分岐に、渡り鳥の飛来の枠と並べて出す", async (r) => {
    stub(r === "ready" ? SUMMARY : r);
    show();
    const title = await screen.findByRole("heading", { name: "渡りの経路（環境省の図）" });
    const section = title.closest("section")!;
    expect(within(section).getAllByRole("img")).toHaveLength(5);
    await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" });
    expect(section.closest("section.migration")).toBeNull();
  });

  it("読み込み中には出さない", () => {
    stub(SUMMARY);
    show();
    expect(screen.queryByRole("heading", { name: "渡りの経路（環境省の図）" })).toBeNull();
  });
});

describe("発生傾向（/trends）", () => {
  it("集計があれば、発生傾向であること、人が全件を確かめていないこと、時点を出す", async () => {
    stub(SUMMARY);
    show();
    expect(await screen.findByText(/全国の発生傾向です/u)).toBeTruthy();
    expect(screen.getByText(/自由記述を Claude が項目に揃えた結果で、全件を人が確かめたものではありません/u)).toBeTruthy();
    expect(screen.getByText(/国の報告書の集計（半数以上の農場）より少なく出ます。数え方が違います/u)).toBeTruthy();
    expect(screen.getByText(/2026-11-08 10:00 時点/u)).toBeTruthy();
  });

  it("3 つの項目は報告書の言い方のままで、数と出典を出す", async () => {
    stub(SUMMARY);
    show();
    const table = await screen.findByRole("table");
    for (const label of ["外部事業者の専用の衣服や靴", "ねずみの痕跡", "壁やネットの破損"]) expect(within(table).getByText(label)).toBeTruthy();
    const row = within(table).getByText("ねずみの痕跡").closest("tr")!;
    expect(row.textContent).toContain("14");
    expect(row.textContent).toContain("4");
    expect(screen.getByText(/24 件/u)).toBeTruthy();
    const link = screen.getByRole("link", { name: /r7_hpai_kokunai|国内における|農林水産省/u });
    expect(link.getAttribute("href")).toBe(SUMMARY.sourceUrls[0]);
  });

  it("禁句がない", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("table");
    expect(findWordingViolations(container.textContent ?? "")).toEqual([]);
  });

  it.each(["missing", "html"] as const)("集計がまだないとき（%s）は「準備中です」のまま", async (r) => {
    stub(r);
    const { container } = show();
    expect(await screen.findByText(/準備中です/u)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(findWordingViolations(container.textContent ?? "")).toEqual([]);
  });

  it("読み込めなかったときは、準備中と分けて知らせる", async () => {
    stub("error");
    show();
    expect(await screen.findByText(/読み込めませんでした/u)).toBeTruthy();
  });

  it("形の違う集計は読み込めなかった扱い（市町村や事例のキーを持つものも拒む）", () => {
    expect(parseTrendSummary(SUMMARY)).toEqual(SUMMARY);
    expect(parseTrendSummary({ ...SUMMARY, seasons: "x" })).toBeNull();
    expect(parseTrendSummary({ ...SUMMARY, seasons: [{ ...SUMMARY.seasons[0], muniName: "試験町" }] })).toBeNull();
    expect(parseTrendSummary({ ...SUMMARY, seasons: [{ ...SUMMARY.seasons[0], items: [{ ...SUMMARY.seasons[0]!.items[0], key: "other" }] }] })).toBeNull();
  });
});
