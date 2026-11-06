import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MigrationSection from "./MigrationSection";
import { parseMigrationSummary, type MigrationSummary } from "./migrationTypes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 画面の試験に使う、作った集計（実測ではない。data/ には入れない）
const SUMMARY: MigrationSummary = {
  generatedAt: "2026-11-04T18:30:00+09:00",
  currentSeason: 2026,
  baselineSeasons: [2021, 2022, 2023, 2024, 2025],
  sourceUrl: "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html",
  sites: [
    {
      id: 110,
      name: "試験沼",
      latestDate: "2026-10-14",
      latestTotal: 41_860,
      fetchedAt: "2026-11-04",
      unreported: 0,
      baseline: {
        n: 5,
        median: 36_459,
        min: 12_801,
        max: 63_962,
        seasons: [2021, 2022, 2023, 2024, 2025].map((season, i) => ({ season, date: `${season}-10-1${i}`, total: [12_801, 26_124, 36_459, 49_778, 63_962][i]! })),
      },
    },
    {
      id: 20,
      name: "試験湖",
      latestDate: "2026-10-20",
      latestTotal: 9,
      fetchedAt: "2026-11-04",
      unreported: 0,
      baseline: {
        n: 3,
        median: 300,
        min: 200,
        max: 400,
        seasons: [2021, 2023, 2025].map((season, i) => ({ season, date: `${season}-10-2${i}`, total: [200, 300, 400][i]! })),
      },
    },
    { id: 30, name: "試験池", latestDate: "2026-10-12", latestTotal: 500, fetchedAt: "2026-11-04",
      unreported: 2, baseline: null },
  ],
  arrivals: [
    {
      siteId: 110,
      siteName: "試験沼",
      species: "マガン",
      threshold: 1000,
      currentDate: "2026-09-30",
      latestSurveyDate: "2026-10-14",
      past: [
        { season: 2024, date: "2024-09-29", atFirstSurvey: false },
        { season: 2025, date: "2025-10-02", atFirstSurvey: false },
      ],
    },
    {
      siteId: 20,
      siteName: "試験湖",
      species: "オオハクチョウ",
      threshold: 100,
      currentDate: null,
      latestSurveyDate: "2026-10-14",
      past: [
        { season: 2024, date: "2024-10-28", atFirstSurvey: true },
        { season: 2025, date: null, atFirstSurvey: false },
      ],
    },
  ],
};

type Reply = unknown | "missing" | "html" | "error";
function stub(r: Reply) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (!String(url).endsWith("migration/summary.json")) return Promise.reject(new Error(`想定しない通信: ${url}`));
      if (r === "missing") return Promise.resolve(new Response("", { status: 404 }));
      if (r === "html") return Promise.resolve(new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
      if (r === "error") return Promise.resolve(new Response("", { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }));
    }),
  );
}
const show = () => render(<MigrationSection />);

describe("渡り鳥の飛来（季節の参考）", () => {
  it("必ず添える断り（警報ではない・揺れる・感染の情報なし・公開の遅れ・予測しない）と、時点が出る", async () => {
    stub(SUMMARY);
    const { container } = show();
    expect(await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("農場の危険度や警報ではありません");
    expect(text).toContain("年によって大きく揺れます");
    expect(text).toContain("感染の情報は含みません");
    expect(text).toContain("数日から 2 週間ほどかかります");
    expect(text).toContain("予測するものではありません");
    // 時点: 地点ごとの調査日のうち最も新しい日と、取得日
    expect(text).toContain("最も新しい調査日: 2026 年 10 月 20 日");
    expect(text).toContain("データの取得日 2026 年 11 月 4 日");
  });

  it("出典、加工の事実と主体を出す。出典はリンク", async () => {
    stub(SUMMARY);
    const { container } = show();
    const link = await screen.findByRole("link", { name: /環境省「渡り鳥の飛来状況」/u });
    expect(link.getAttribute("href")).toBe(SUMMARY.sourceUrl);
    expect(container.textContent).toContain("この作品が地点ごとの Excel ファイルから水鳥の合計を求め");
    expect(container.textContent).toContain("編集・加工の主体: この作品の作者");
    expect(container.textContent).toContain("環境省が作成したものではありません");
  });

  it("地点ごとに、今季の最新の数と、過去の同じ時期の幅・中央値を並べる。比べられない地点はそのとおり言う", async () => {
    stub(SUMMARY);
    show();
    await screen.findByRole("heading", { name: "試験沼" });
    const numa = screen.getByRole("heading", { name: "試験沼" }).closest("li")!;
    expect(numa.textContent).toContain("10 月 14 日の調査");
    expect(numa.textContent).toContain("41,860 羽");
    expect(numa.textContent).toContain("12,801 〜 63,962 羽（中央値 36,459 羽）");
    // 「幅の内」「幅より下」のような、多い・少ないに読める分類はしない
    expect(numa.textContent).not.toMatch(/幅の内|幅より|多い|少ない/u);
    const lake = screen.getByRole("heading", { name: "試験湖" }).closest("li")!;
    expect(lake.textContent).toContain("9 羽");
    expect(lake.textContent).not.toMatch(/幅の内|幅より|多い|少ない/u);
    expect(lake.textContent).toContain("調査の近い回がそろった 3 シーズンだけです");
    const pond = screen.getByRole("heading", { name: "試験池" }).closest("li")!;
    expect(pond.textContent).toContain("比べられる回がそろいませんでした");
    expect(pond.textContent).not.toContain("中央値");
  });

  it("報告が未着の回がある地点には、その地点の最新の調査日と未着の回数を出す。ない地点には出さない", async () => {
    stub(SUMMARY);
    show();
    await screen.findByRole("heading", { name: "試験池" });
    const pond = screen.getByRole("heading", { name: "試験池" }).closest("li")!;
    expect(pond.textContent).toContain("この地点は10 月 12 日の調査が最新です（報告が未着の回が 2 回あります）");
    const numa = screen.getByRole("heading", { name: "試験沼" }).closest("li")!;
    expect(numa.textContent).not.toContain("未着");
  });

  it("地点が 0 件なら、日付の行を出さず「載せられる地点がありません」と言う（0 年 0 月 0 日を出さない）", async () => {
    stub({ ...SUMMARY, sites: [], arrivals: [] });
    const { container } = show();
    expect(await screen.findByText("載せられる地点がありません。")).toBeTruthy();
    expect(container.textContent).not.toContain("最も新しい調査日");
    expect(container.textContent).not.toMatch(/0 年|NaN|undefined/u);
    expect(findWordingViolations(container.textContent ?? "")).toEqual([]);
  });

  it("水鳥の数の定義（種の羽数 + 種まで分からなかった羽数）を冒頭で言う", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("heading", { name: "試験沼" });
    expect(container.textContent).toContain("種まで分からなかった「カモ類」などの羽数を足したものです");
  });

  it("載せていない地点があること（中央値 100 羽未満、出水・高尾野）を画面で断る", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("heading", { name: "試験沼" });
    expect(container.textContent).toContain("中央値が 100 羽未満の地点は載せていません");
    expect(container.textContent).toContain("出水・高尾野");
    expect(container.textContent).toContain("載っていない地点は「調べていない」「いない」という意味ではありません");
  });

  it("飛来の早さ: 今季の初回、まだのとき、最初の回で既に超えた年の注意、届かなかった年", async () => {
    stub(SUMMARY);
    show();
    const heading = await screen.findByRole("heading", { name: /試験沼のマガン（1 回の調査で 1,000 羽以上）/u });
    const li = heading.closest("li")!;
    expect(li.textContent).toContain("9 月 30 日の調査で初めて記録");
    expect(li.textContent).toContain("9 月 29 日 〜 10 月 2 日");
    const swan = screen.getByRole("heading", { name: /試験湖のオオハクチョウ/u }).closest("li")!;
    expect(within(swan).getByText(/まだ記録がありません（10 月 14 日の調査まで）/u)).toBeTruthy();
    expect(swan.textContent).toContain("最初の調査の回で既に超えていたため、実際はもっと早かった可能性があります");
    expect(swan.textContent).toContain("過去 2 シーズンのうち 1 シーズンで記録があり");
  });

  it("禁句と、「多いから危ない」「少ないから安全」と読める言い方がない", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" });
    const text = container.textContent ?? "";
    expect(findWordingViolations(text)).toEqual([]);
    for (const bad of ["多いから", "少ないから", "危ない", "安全", "安心", "警戒してください", "注意してください", "警報です", "増えるおそれ", "来る見込み"]) {
      expect(text, bad).not.toContain(bad);
    }
    // 倍率で「大きく増えた」と見せない
    expect(text).not.toMatch(/\d+(\.\d+)? ?倍/u);
  });

  it("表を使わない（幅 360px で横にはみ出さない）", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" });
    expect(container.querySelector("table")).toBeNull();
  });

  it("飛来の早さが 0 件なら、その見出しも出さない", async () => {
    stub({ ...SUMMARY, arrivals: [] });
    show();
    await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" });
    expect(screen.queryByRole("heading", { name: "飛来の早さ" })).toBeNull();
  });

  it.each(["missing", "html"] as const)("集計がまだないとき（%s）は、まだ作られていないと言う（数は出さない）", async (r) => {
    stub(r);
    const { container } = show();
    expect(await screen.findByText(/まだ作られていません/u)).toBeTruthy();
    expect(container.textContent).not.toContain("羽");
    expect(findWordingViolations(container.textContent ?? "")).toEqual([]);
  });

  it("読めなかったときは、まだ作られていないのとは分けて知らせる", async () => {
    stub("error");
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/読み込めませんでした/u)).toBeTruthy();
  });

  it("形の違う集計は読めなかった扱い（知らないキーや、おかしな数も拒む）", () => {
    expect(parseMigrationSummary(SUMMARY)).toEqual(SUMMARY);
    expect(parseMigrationSummary({ ...SUMMARY, farm: "x" })).toBeNull();
    expect(parseMigrationSummary({ ...SUMMARY, sites: "x" })).toBeNull();
    expect(parseMigrationSummary({ ...SUMMARY, sites: [{ ...SUMMARY.sites[0], ratio: 1.2 }] })).toBeNull();
    expect(parseMigrationSummary({ ...SUMMARY, sites: [{ ...SUMMARY.sites[0], latestTotal: -1 }] })).toBeNull();
    expect(parseMigrationSummary({ ...SUMMARY, sites: [{ ...SUMMARY.sites[0], latestDate: "2026-13-40" }] })).toBeNull();
    // 最小 > 中央値 のような矛盾
    expect(parseMigrationSummary({ ...SUMMARY, sites: [{ ...SUMMARY.sites[0], baseline: { ...SUMMARY.sites[0]!.baseline, min: 99_999 } }] })).toBeNull();
    expect(parseMigrationSummary({ ...SUMMARY, arrivals: [{ ...SUMMARY.arrivals[0], threshold: 0 }] })).toBeNull();
  });
});

describe("図（設計書 2026-11-06-trends-redesign §4.5）", () => {
  it("比べられる地点だけに範囲の図を付け、飛来の早さの時間軸を出す。図は読み上げから外し、数は文に残す", async () => {
    stub(SUMMARY);
    const { container } = show();
    await screen.findByRole("heading", { name: "渡り鳥の飛来（季節の参考）" });
    const withBaseline = SUMMARY.sites.filter((s) => s.baseline !== null).length;
    const strips = container.querySelectorAll("svg.migration-range");
    expect(strips).toHaveLength(withBaseline);
    for (const s of Array.from(strips)) expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".migration-timeline")).not.toBeNull();
    // 1 つ目の断りは折りたたみの外に出す
    expect(container.querySelector(".migration-caveat")!.textContent).toContain("農場の危険度や警報ではありません");
  });
});
