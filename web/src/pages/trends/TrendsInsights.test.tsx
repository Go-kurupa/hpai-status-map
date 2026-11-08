// /trends の深掘り（設計書 2026-11-06-trends-redesign、案 C、要点に割合）。作った集計で調べる（実測ではない）。
import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrendsPage from "./TrendsPage";
import { wari } from "./TrendsInsights";
import type { InsightCounts, TrendInsights } from "./insightsTypes";
import type { MigrationSummary } from "./migrationTypes";
import type { TrendSummary } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const c = (key: InsightCounts["key"], issue: number, noIssue: number, notMentioned: number): InsightCounts => ({ key, issue, noIssue, notMentioned });
const INSIGHTS: TrendInsights = {
  generatedAt: "2026-11-07T09:00:00+09:00",
  total: { season: 0, surveyed: 40, items: [c("external_clothing", 10, 20, 10), c("rodent_signs", 30, 8, 2), c("wall_net_damage", 25, 5, 10)] },
  seasons: [
    { season: 2025, surveyed: 10, items: [c("external_clothing", 3, 5, 2), c("rodent_signs", 9, 1, 0), c("wall_net_damage", 6, 2, 2)] },
    { season: 2024, surveyed: 30, items: [c("external_clothing", 7, 15, 8), c("rodent_signs", 21, 7, 2), c("wall_net_damage", 19, 3, 8)] },
  ],
  phrases: [
    { key: "rodent_signs", base: 30, words: [{ label: "ふん", count: 14 }, { label: "かじり跡", count: 9 }], unmatched: 3 },
    { key: "wall_net_damage", base: 25, words: [{ label: "金網・ネット", count: 17 }], unmatched: 2 },
  ],
  rodentSource: { survey: 22, interview: 7, unclear: 1 },
  groups: [
    {
      dimension: "use",
      rows: [
        { label: "採卵鶏", total: 30, issue: { external_clothing: 8, rodent_signs: 24, wall_net_damage: 20 } },
        { label: "肉用鶏", total: 6, issue: { external_clothing: { suppressed: true }, rodent_signs: { suppressed: true }, wall_net_damage: { suppressed: true } } },
        { label: "その他", total: 4, issue: { external_clothing: { suppressed: true }, rodent_signs: { suppressed: true }, wall_net_damage: { suppressed: true } } },
      ],
    },
  ],
  reportQuotes: [
    { season: 2025, about: "general", text: "全国どこでもの文。", reportTitle: "報告書", reportUrl: "https://www.maff.go.jp/a.pdf" },
    { season: 2025, about: "rodent_signs", text: "ねずみの文。", reportTitle: "報告書", reportUrl: "https://www.maff.go.jp/a.pdf" },
  ],
};
const SUMMARY: TrendSummary = {
  generatedAt: "2026-11-04T17:00:00+09:00",
  seasons: [{ season: 2025, surveyed: 10, items: [{ key: "external_clothing", label: "外部事業者の専用の衣服や靴", issueCount: 3, notMentionedCount: 2 }, { key: "rodent_signs", label: "ねずみの痕跡", issueCount: 9, notMentionedCount: 0 }, { key: "wall_net_damage", label: "壁やネットの破損", issueCount: 6, notMentionedCount: 2 }] }],
  sourceUrls: ["https://www.maff.go.jp/j/syouan/douei/tori/r7_hpai_kokunai.html"],
};
const MIGRATION: MigrationSummary = { generatedAt: "2026-11-04T18:30:00+09:00", currentSeason: 2026, baselineSeasons: [2021, 2022, 2023, 2024, 2025], sourceUrl: "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html", sites: [], arrivals: [] };

function stub(insights: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      const ok = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } }));
      if (u.endsWith("migration/summary.json")) return ok(MIGRATION);
      if (u.endsWith("trends/summary.json")) return ok(SUMMARY);
      if (u.endsWith("trends/insights.json")) return insights === "missing" ? Promise.resolve(new Response("", { status: 404 })) : ok(insights);
      return Promise.reject(new Error(`想定しない通信: ${u}`));
    }),
  );
}
const narrow = (on: boolean) => vi.stubGlobal("matchMedia", () => ({ matches: on, addEventListener: () => {}, removeEventListener: () => {} }));
const show = () =>
  render(
    <MemoryRouter>
      <TrendsPage />
    </MemoryRouter>,
  );

describe("割合の言い方", () => {
  it("1 割きざみに丸め、端は言い換える", () => {
    expect(wari(189, 246)).toBe("約 8 割");
    expect(wari(62, 246)).toBe("約 3 割");
    expect(wari(1, 246)).toBe("1 割未満");
    expect(wari(239, 246)).toBe("9 割以上");
    expect(wari(5, 5)).toBe("すべて");
  });
});

describe("要点（案 C の左上）", () => {
  it("件数と割合、断り、国の報告書の文を出し、禁句がない", async () => {
    narrow(false);
    stub(INSIGHTS);
    const { container } = show();
    const points = (await screen.findByRole("heading", { name: /要点/u })).closest("section")!;
    expect(points.textContent).toMatch(/40 件のうち、ねずみの痕跡があったと書かれていたのは 30 件（約 8 割）/u);
    expect(points.textContent).toMatch(/不備ありが 10 件（約 3 割）、不備なしと書かれていたのが 20 件（約 5 割）/u);
    expect(points.textContent).toMatch(/発生していない農場との比べはありません/u);
    expect(points.textContent).toMatch(/全国どこでもの文/u);
    expect(findWordingViolations(container.textContent ?? "")).toEqual([]);
  });
});

describe("項目の帯と詳しい欄", () => {
  it("PC の幅では、押した項目の詳しい欄を右に出す（はじめはねずみ）", async () => {
    narrow(false);
    stub(INSIGHTS);
    show();
    const side = await screen.findByRole("complementary", { name: "くわしく" });
    expect(within(side).getByRole("heading", { name: "ねずみの痕跡" })).toBeTruthy();
    expect(side.textContent).toMatch(/調査のときに見つかった 22 件、農場の人の話（「時々見かける」など）7 件/u);
    expect(side.textContent).toMatch(/ねずみの文/u);
    fireEvent.click(screen.getByRole("button", { name: /壁やネットの破損/u }));
    expect(within(side).getByRole("heading", { name: "壁やネットの破損" })).toBeTruthy();
    expect(side.textContent).toMatch(/金網・ネット/u);
    expect(side.textContent).toMatch(/伏せています ／ 6 件/u);
  });

  it("シーズンを押すと、帯の数がそのシーズンに変わる", async () => {
    narrow(false);
    stub(INSIGHTS);
    show();
    const rodent = await screen.findByRole("button", { name: /ねずみの痕跡/u });
    expect(rodent.textContent).toMatch(/あった 30 件 ／ なかった 8 件 ／ 触れていない 2 件（40 件中）/u);
    fireEvent.click(screen.getByRole("button", { name: "2025/26" }));
    expect(screen.getByRole("button", { name: "2025/26" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /ねずみの痕跡/u }).textContent).toMatch(/あった 9 件 ／ なかった 1 件 ／ 触れていない 0 件（10 件中）/u);
  });

  it("スマホの幅では、押した帯のすぐ下に開き、もう一度押すと閉じる", async () => {
    narrow(true);
    stub(INSIGHTS);
    show();
    await screen.findByRole("heading", { name: /要点/u });
    expect(screen.queryByRole("complementary", { name: "くわしく" })).toBeNull();
    const wall = screen.getByRole("button", { name: /壁やネットの破損/u });
    fireEvent.click(wall);
    const li = wall.closest("li")!;
    expect(within(li).getByRole("heading", { name: "壁やネットの破損" })).toBeTruthy();
    expect(wall.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(wall);
    expect(within(li).queryByRole("heading", { name: "壁やネットの破損" })).toBeNull();
  });
});

describe("戻り", () => {
  it.each([["無い", "missing"], ["形が違う", { ...INSIGHTS, extra: 1 }]])("深掘りの集計が%sときは、今の表に戻る", async (_, v) => {
    narrow(false);
    stub(v);
    show();
    await screen.findByRole("heading", { name: "2025/26 シーズン" });
    expect(screen.queryByRole("heading", { name: /要点/u })).toBeNull();
  });
});

describe("発生農場はどう気づいたか（段階 2）", () => {
  const NOTICING = {
    read: 40,
    fields: [
      { key: "first_sign" as const, label: "最初に気づいた異変", values: [{ key: "mass_death", label: "まとまった死亡・急な大量死", count: 20 }, { key: "death_increase", label: "死亡の増加", count: 15 }, { key: "not_mentioned", label: "記載なし", count: 3 }], unverified: 2 },
      { key: "other_disease_suspected" as const, label: "最初は別の病気を疑った", values: [{ key: "yes", label: "はい", count: 6 }, { key: "no", label: "いいえ", count: 4 }, { key: "not_mentioned", label: "記載なし", count: 30 }], unverified: 0 },
    ],
  };

  it("抽出の集計があれば枠を出し、数えなかった件数と死亡数の記録の 1 文を添える（見本の農場へのリンクは置かない。2026-11-08 から提出フォームでだけ案内する）", async () => {
    narrow(false);
    stub({ ...INSIGHTS, noticing: NOTICING });
    show();
    const sec = (await screen.findByRole("heading", { name: "発生農場はどう気づいたか" })).closest("section")!;
    expect(sec.textContent).toMatch(/まとまった死亡・急な大量死\s*20 件/u);
    expect(sec.textContent).toContain("根拠の文を原文で確かめられなかった 2 件は数えていません");
    expect(sec.textContent).toContain("通報の早さや遅さを評価するものではありません");
    expect(sec.textContent).toContain("日々の死亡数を記録しておくと、普段との違いに気づきやすくなります。");
    expect(sec.querySelector('a[href^="/sample"]')).toBeNull();
    expect(findWordingViolations(sec.textContent ?? "")).toEqual([]);
  });

  it("無ければ枠を出さない。件数の和が読み込めた数と合わないものは集計ごと拒む（今の表に戻る）", async () => {
    narrow(false);
    stub(INSIGHTS);
    show();
    await screen.findByRole("heading", { name: /要点/u });
    expect(screen.queryByRole("heading", { name: "発生農場はどう気づいたか" })).toBeNull();
    cleanup();
    const bad = { ...NOTICING, fields: [{ ...NOTICING.fields[0]!, unverified: 3 }] };
    stub({ ...INSIGHTS, noticing: bad });
    show();
    await screen.findByRole("heading", { name: "2025/26 シーズン" });
  });
});
