import type { MeasuredUsage } from "@hpai/shared/replay";
import type { EvalSummary } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import usageJson from "../../../../data/replay/measured-usage.json";
import { formatMetric, METRIC_LABEL } from "./formatMetric";
import ResultsPage from "./ResultsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 画面の試験に使う、作った結果（実測ではない。data/ には入れない）
const SUMMARY: EvalSummary = {
  measuredAt: "2026-11-05T17:30:00+09:00",
  metrics: [
    { name: "documents", value: 54, denominator: null, unit: "文書", note: "試みた全文書" },
    { name: "primary_muni_errors", value: 0, denominator: 54, unit: "文書", note: "読めた文書のうち、市町村の読み違い" },
    { name: "primary_stage_errors", value: 0, denominator: 54, unit: "文書", note: null },
    { name: "primary_date_errors", value: 0, denominator: 54, unit: "文書", note: null },
    { name: "tamper_rejected", value: 17, denominator: 17, unit: "件", note: "わざと入れ替えた結果のうち、載らずに落ちた数" },
    { name: "detection_prev_season", value: 24, denominator: 24, unit: "件", note: "前季の確認の発表が cases.json と一致" },
  ],
  unmeasured: ["detection_title_classification"],
  costPerDocumentUsd: 0.0412,
};
const MEASURED_USAGE: MeasuredUsage = {
  status: "measured",
  documents: 10,
  byModel: {
    "claude-opus-5-5": { inputTokens: 100000, outputTokens: 10000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  measuredAt: "2026-11-06T10:00:00+09:00",
};

type Reply = unknown | "missing" | "html" | "error" | "network";
function stub(over: { summary?: Reply; usage?: Reply } = {}) {
  const calls: string[] = [];
  const reply = (r: Reply): Promise<Response> => {
    if (r === "missing") return Promise.resolve(new Response("", { status: 404 }));
    if (r === "html") return Promise.resolve(new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    if (r === "error") return Promise.resolve(new Response("", { status: 500 }));
    if (r === "network") return Promise.reject(new Error("offline"));
    return Promise.resolve(new Response(JSON.stringify(r), { status: 200 }));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("evals/summary.json")) return reply("summary" in over ? over.summary : "missing");
      if (u.endsWith("replay/measured-usage.json")) return reply("usage" in over ? over.usage : usageJson);
      return Promise.reject(new Error(`想定しない通信: ${u}`));
    }),
  );
  return calls;
}

async function show(over: Parameters<typeof stub>[0] = {}) {
  const calls = stub(over);
  render(
    <MemoryRouter>
      <ResultsPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /試験の結果/ });
  return calls;
}
const region = (name: RegExp | string) => screen.getByRole("region", { name });

describe("formatMetric", () => {
  it("分母つきは 24/24。単位をつける", () => {
    expect(formatMetric({ name: "detection_prev_season", value: 24, denominator: 24, unit: "件", note: null })).toBe("24/24 件");
  });
  it("分母なしは値と単位だけ。0 は 0 のまま（丸めない）", () => {
    expect(formatMetric({ name: "documents", value: 54, denominator: null, unit: "文書", note: null })).toBe("54 文書");
    expect(formatMetric({ name: "primary_muni_errors", value: 0, denominator: 30, unit: "文書", note: null })).toBe("0/30 文書");
    expect(formatMetric({ name: "documents", value: 0.5, denominator: null, unit: "", note: null })).toBe("0.5");
  });
  it("すべての指標に日本語の名前がある", () => {
    for (const n of ["documents", "primary_muni_errors", "primary_stage_errors", "primary_date_errors", "tamper_rejected", "detection_prev_season", "detection_title_classification"] as const) {
      expect(METRIC_LABEL[n], n).toBeTruthy();
    }
  });
});

describe("/results（まだ何も測っていない）", () => {
  it("試験はまだ実行していません、再現の費用は未計測と出す。静的ファイルだけを読む", async () => {
    const calls = await show();
    expect(region(/読み取りの試験/).textContent).toContain("試験はまだ実行していません");
    expect(region(/読み取りの試験/).textContent).toContain("未実測");
    expect(region(/再現 1 回分/).textContent).toContain("未計測");
    // 未実測でも『時点』と状態を出す（全画面に時点、§15）
    expect(region(/読み取りの試験/).textContent).toContain("時点: 試験はまだ実行していません");
    expect(region(/読み取りの試験/).textContent!.split("試験はまだ実行していません").length - 1).toBe(1); // 重ねて書かない
    expect(region(/再現 1 回分/).textContent).toContain("時点: 未計測");
    expect(region(/再現 1 回分/).textContent!.split("未計測").length - 1).toBe(1);
    expect(calls.sort()).toEqual(["/evals/summary.json", "/replay/measured-usage.json"]);
  });

  it("実測の節に円もドルも数字の結果もない。円は『見積もり（推定）』の節にだけある", async () => {
    await show();
    expect(region(/読み取りの試験/).textContent).not.toMatch(/\d/);
    expect(region(/再現 1 回分/).textContent).not.toMatch(/円|ドル|\$/);
    const calc = region(/計算/);
    expect(calc.textContent).toContain("見積もり（推定）");
    expect(calc.textContent).toContain("実測ではありません");
    expect(calc.textContent).toContain("2,160 円"); // 24 事例
    expect(calc.textContent).toContain("7,560 円"); // 84 事例
    expect(calc.textContent).toContain("3,000 円");
  });

  it("SPA の置き換えで HTML が返っても、結果があるとは扱わない", async () => {
    await show({ summary: "html" });
    expect(region(/読み取りの試験/).textContent).toContain("試験はまだ実行していません");
  });

  it("禁じた言い方がない（削減、時間短縮、安全、安心）。入力欄がない", async () => {
    await show();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/削減|時間短縮/);
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(document.querySelector("input, textarea, select")).toBeNull();
  });

  it("運営者の画面・内部の理由・会員のデータの語を出さない", async () => {
    await show();
    expect(document.body.textContent).not.toMatch(/運営者|会員|農場名|メールアドレス|invites|farms/);
  });
});

describe("/results（試験の結果がある）", () => {
  it("時点を出し、分母つきの結果と note を並べる。unmeasured と無い指標は『未実測』", async () => {
    await show({ summary: SUMMARY });
    const s = region(/読み取りの試験/);
    expect(s.textContent).toContain("2026-11-05 17:30");
    expect(within(s).getByText("24/24 件")).toBeTruthy();
    expect(s.textContent).toContain("前季の確認の発表が cases.json と一致");
    expect(within(s).getAllByText("0/54 文書", { selector: "td" })).toHaveLength(3);
    const row = (label: string) => within(s).getByRole("row", { name: new RegExp(label) });
    expect(row("国の題の分類").textContent).toContain("未実測"); // unmeasured
    expect(row("羽数の読み違い").textContent).toContain("未実測"); // metrics に無い
    expect(s.textContent).not.toContain("試験はまだ実行していません");
  });

  it("unmeasured と metrics の両方にある指標は未実測が勝つ（0 と書かない）", async () => {
    await show({ summary: { ...SUMMARY, unmeasured: ["primary_muni_errors"] } });
    const row = within(region(/読み取りの試験/)).getByRole("row", { name: /市町村/ });
    expect(row.textContent).toContain("未実測");
    expect(row.textContent).not.toContain("0/54");
  });

  it("ファイルはあるが形が違う summary は、結果とは扱わず、『まだ実行していません』とも言わない（読めなかった）", async () => {
    stub({ summary: { measuredAt: "2026-11-05T17:30:00+09:00", metrics: "x" } });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読めませんでした/);
    expect(document.body.textContent).not.toContain("試験はまだ実行していません");
  });

  it("1 文書あたりの費用は『計算』の節に出し、実測の節には出さない", async () => {
    await show({ summary: SUMMARY });
    expect(region(/計算/).textContent).toContain("0.0412");
    expect(region(/読み取りの試験/).textContent).not.toContain("0.0412");
  });
});

describe("/results（再現 1 回分を測った）", () => {
  it("モデルごとのトークン数（実測）と時点を出す", async () => {
    await show({ usage: MEASURED_USAGE });
    const s = region(/再現 1 回分/);
    expect(s.textContent).toContain("claude-opus-5-5");
    expect(s.textContent).toContain("100,000");
    expect(s.textContent).toContain("10,000");
    expect(s.textContent).toContain("2026-11-06 10:00");
    expect(s.textContent).not.toContain("未計測");
  });

  it("1 シーズンの計算にその 1 文書あたりの費用を使い、『計算』と分けて書く", async () => {
    await show({ usage: MEASURED_USAGE });
    // 100000×4 + 10000×20 = 600000 → 0.6 ドル / 10 文書 = 0.06 ドル。24 事例 × 12 × 0.06 × 150 = 2592 円（見積もりの 2,160 円とは別の値）
    const calc = region(/計算/);
    expect(calc.textContent).toContain("再現の実測から");
    expect(calc.textContent).toContain("2,592 円");
    expect(calc.textContent).toContain("見積もり（推定）"); // 仮定の行は実測の行と分けて残る
  });
});

describe("/results（読めなかった）", () => {
  it("通信に失敗したら読めなかったと言い、もう一度読むボタンで読み直す", async () => {
    stub({ summary: "network" });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読めませんでした/);
    expect(screen.queryByText("試験はまだ実行していません")).toBeNull(); // 読めなかったことを「まだ実行していない」と混ぜない
    expect(document.body.textContent).toContain("時点: 読み込めませんでした"); // 読めなかったときも『時点』の欄を出す
    stub({ summary: SUMMARY });
    fireEvent.click(screen.getByRole("button", { name: /もう一度/ }));
    await waitFor(() => expect(screen.getByText("24/24 件")).toBeTruthy());
  });

  it("JSON として壊れた中身（HTML ではない）も読めなかった扱い", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(String(url));
        if (String(url).endsWith("evals/summary.json")) return Promise.resolve(new Response("{ broken", { status: 200, headers: { "content-type": "application/json" } }));
        return Promise.resolve(new Response(JSON.stringify(usageJson), { status: 200 }));
      }),
    );
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読めませんでした/);
    expect(document.body.textContent).not.toContain("試験はまだ実行していません");
  });

  it("サーバーの 500 も読めなかった扱い", async () => {
    stub({ summary: "error" });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読めませんでした/);
  });
});

describe("見積もり（推定）と実測の分離、前提の開示（レビュー I-1、I-2、I-3）", () => {
  const estimateBox = () => within(region(/計算/)).getByRole("heading", { name: /見積もり（推定）。実測ではありません/ }).parentElement!;

  it("見積もりは実測の表とは別の表。見出しと表の題に『見積もり（推定）。実測ではありません』がある", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    const tables = within(region(/計算/)).getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(tables[0]!).getByText(/実測の 1 文書あたり費用から計算/)).toBeTruthy(); // 題
    expect(within(tables[1]!).getByText("見積もり（推定）。実測ではありません")).toBeTruthy(); // 題
    expect(tables[0]!.textContent).not.toContain("主の読み手だけ"); // 実測の表に仮定だけの見積もりの行が混ざらない
    expect(tables[0]!.textContent).not.toContain("Haiku にも同じ量");
    expect(estimateBox().contains(tables[1]!)).toBe(true);
  });

  it("実測の行の円の額は、仮定の文書数を使うことを行の中に書く。方式不明も書く", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    const tables = within(region(/計算/)).getAllByRole("table");
    for (const row of within(tables[0]!).getAllByRole("row").slice(1)) expect(row.textContent, row.textContent ?? "").toContain("12 文書の仮定を使う");
    expect(tables[0]!.textContent).toContain("実行方式は記録なし");
  });

  it("円の額が出る行（表の行と段落）は、実測由来の行も含めて、行の中に『推定』がある", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    const calc = region(/計算/);
    for (const row of Array.from(calc.querySelectorAll("tbody tr"))) {
      if (/円|\$/.test(row.textContent ?? "")) expect(row.textContent, row.textContent ?? "").toContain("推定");
    }
    for (const p of Array.from(calc.querySelectorAll("p")).filter((x) => /円|\$\d/.test(x.textContent ?? "") && !(x.textContent ?? "").includes("運用の上限"))) {
      expect(p.textContent, p.textContent ?? "").toContain("推定");
    }
  });

  it("何も測っていなくても、見積もりの表は見出し付きで 1 つだけ出る（実測の表は出ない）", async () => {
    await show();
    expect(within(region(/計算/)).getAllByRole("table")).toHaveLength(1);
    expect(within(region(/計算/)).queryByRole("heading", { name: /実測の使用量から計算/ })).toBeNull();
  });

  it("主の読み手だけの行は別の読み手（Haiku）を含まないと画面に書き、Haiku を足した行も出す。増分は未計測", async () => {
    await show();
    const box = estimateBox();
    expect(box.textContent).toContain("別の読み手（Haiku）の費用を含みません");
    expect(box.textContent).toContain("増分は未計測");
    expect(within(box).getByRole("row", { name: /主の読み手だけ.*別の読み手を含まない/ }).textContent).toContain("（別の読み手を除く）");
    const withSecond = within(box).getByRole("row", { name: /Haiku.*足した/ });
    // 0.05 + 0.00125（Haiku 5.5 の単価で同じ 5,000/1,500）= 0.05125 ドル → 24 事例 × 12 × 150 = 2,214 円
    expect(withSecond.textContent).toContain("$0.05125");
    expect(withSecond.textContent).toContain("2,214 円");
  });

  it("単価は通常の API のもので、Batch ならこの約半分になりうると書く", async () => {
    await show();
    expect(region(/計算/).textContent).toContain("通常の API");
    expect(region(/計算/).textContent).toContain("Batch");
    expect(region(/計算/).textContent).toContain("約半分");
  });
});

describe("リンク", () => {
  it("地図と舞台裏へのリンクがある", async () => {
    await show();
    expect(screen.getByRole("link", { name: /地図/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /舞台裏/ }).getAttribute("href")).toBe("/replay/backstage");
  });
});
