import { UNMEASURED_USAGE, type MeasuredUsage } from "@hpai/shared/replay";
import type { EvalSummary } from "@hpai/shared/types";
import { formatJaDate } from "@hpai/shared/jaDate";
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
    { name: "primary_muni_errors", value: 0, denominator: 54, unit: "文書", note: "読み込めた文書のうち、市町村の読み違い" },
    { name: "primary_stage_errors", value: 0, denominator: 54, unit: "文書", note: null },
    { name: "primary_date_errors", value: 0, denominator: 54, unit: "文書", note: null },
    { name: "tamper_rejected", value: 17, denominator: 17, unit: "件", note: "わざと入れ替えた結果のうち、載らずに落ちた数" },
    { name: "detection_prev_season", value: 24, denominator: 24, unit: "件", note: "前季の確認の発表が 国の事例の一覧と一致" },
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
      if (u.endsWith("replay/measured-usage.json")) return reply("usage" in over ? over.usage : UNMEASURED_USAGE); // 既定は測る前の形（実物の data/ は測り済みなので、それは下の『実物のデータ』で縛る）
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
  it("試験はまだ実行していません、再現の費用はまだ測っていませんと出す。静的ファイルだけを読む", async () => {
    const calls = await show();
    expect(region(/読み取りの試験/).textContent).toContain("試験はまだ実行していません");
    expect(region(/読み取りの試験/).textContent).toContain("まだ測っていません");
    expect(region(/再現 1 回分/).textContent).toContain("まだ測っていません");
    // まだ測っていませんでも『時点』と状態を出す（全画面に時点、§15）
    expect(region(/読み取りの試験/).textContent).toContain("時点: 試験はまだ実行していません");
    expect(region(/読み取りの試験/).textContent!.split("試験はまだ実行していません").length - 1).toBe(1); // 重ねて書かない
    expect(region(/再現 1 回分/).textContent).toContain("時点: まだ測っていません");
    expect(region(/再現 1 回分/).textContent!.split("まだ測っていません").length - 1).toBe(1);
    expect(calls.sort()).toEqual(["/evals/summary.json", "/replay/measured-usage.json"]);
  });

  it("実測の節に円もドルも数字の結果もない。円は『計算』の節にだけあり、仮定した見積もりと書く", async () => {
    await show();
    expect(region(/読み取りの試験/).textContent).not.toMatch(/\d/);
    expect(region(/再現 1 回分/).textContent).not.toMatch(/円|ドル|\$/);
    const calc = region(/計算/);
    expect(calc.textContent).toContain("円の額は、1 事例 12 文書と仮定した見積もりです");
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
  it("時点を出し、分母つきの結果と note を並べる。unmeasured と無い指標は『まだ測っていません』", async () => {
    await show({ summary: SUMMARY });
    const s = region(/読み取りの試験/);
    expect(s.textContent).toContain("時点: 2026年11月5日 17:30");
    expect(within(s).getByText("24/24 件")).toBeTruthy();
    expect(s.textContent).toContain("前季の確認の発表が 国の事例の一覧と一致");
    expect(within(s).getAllByText("0/54 文書", { selector: "td" })).toHaveLength(3);
    const row = (label: string) => within(s).getByRole("row", { name: new RegExp(label) });
    expect(row("国の題の分類").textContent).toContain("まだ測っていません"); // unmeasured
    expect(row("羽数の読み違い").textContent).toContain("まだ測っていません"); // metrics に無い
    expect(s.textContent).not.toContain("試験はまだ実行していません");
  });

  it("unmeasured と metrics の両方にある指標はまだ測っていませんが勝つ（0 と書かない）", async () => {
    await show({ summary: { ...SUMMARY, unmeasured: ["primary_muni_errors"] } });
    const row = within(region(/読み取りの試験/)).getByRole("row", { name: /市町村/ });
    expect(row.textContent).toContain("まだ測っていません");
    expect(row.textContent).not.toContain("0/54");
  });

  it("ファイルはあるが形が違う summary は、結果とは扱わず、『まだ実行していません』とも言わない（読み込めなかった）", async () => {
    stub({ summary: { measuredAt: "2026-11-05T17:30:00+09:00", metrics: "x" } });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読み込めませんでした/);
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
    expect(s.textContent).toContain("時点: 2026年11月6日 10:00");
    expect(s.textContent).not.toContain("まだ測っていません");
  });

  it("1 シーズンの計算にその 1 文書あたりの費用を使い、『計算』と分けて書く", async () => {
    await show({ usage: MEASURED_USAGE });
    // 100000×4 + 10000×20 = 600000 → 0.6 ドル / 10 文書 = 0.06 ドル。24 事例 × 12 × 0.06 × 150 = 2592 円（見積もりの 2,160 円とは別の値）
    const calc = region(/計算/);
    expect(calc.textContent).toContain("再現の実測から");
    expect(calc.textContent).toContain("2,592 円");
    expect(calc.textContent).toContain("仮定から出した見積もり"); // 仮定の表は実測の表と分けて残る
  });
});

describe("/results（実物の data/replay/measured-usage.json）", () => {
  it("測り済み: 文書数、モデルごとのトークン数、時点を出し、『まだ測っていません』とは言わない。静的ファイルだけを読む", async () => {
    const real = usageJson as unknown as MeasuredUsage;
    expect(real.status).toBe("measured");
    const calls = await show({ usage: real });
    const s = region(/再現 1 回分/);
    expect(s.textContent).not.toContain("まだ測っていません");
    expect(s.textContent).toContain(`読んだ文書: ${real.documents} 本`);
    for (const [model, t] of Object.entries(real.byModel)) {
      expect(s.textContent, model).toContain(model);
      expect(s.textContent, model).toContain(t.inputTokens.toLocaleString("en-US"));
      expect(s.textContent, model).toContain(t.outputTokens.toLocaleString("en-US"));
    }
    expect(s.textContent).toContain(`${real.measuredAt!.slice(0, 4)}年${formatJaDate(real.measuredAt!.slice(0, 10))}`);
    expect(calls.sort()).toEqual(["/evals/summary.json", "/replay/measured-usage.json"]);
  });

  it("測り済みなら『計算』の節に、実測から計算した表が出る（見積もりの表と合わせて 2 つ）", async () => {
    await show({ usage: usageJson });
    expect(within(region(/計算/)).getAllByRole("table")).toHaveLength(2);
    expect(within(region(/計算/)).getByRole("heading", { name: /実測の使用量から計算/ })).toBeTruthy();
  });
});

describe("/results（読み込めなかった）", () => {
  it("通信に失敗したら読み込めなかったと言い、もう一度読むボタンで読み直す", async () => {
    stub({ summary: "network" });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読み込めませんでした/);
    expect(screen.queryByText("試験はまだ実行していません")).toBeNull(); // 読み込めなかったことを「まだ実行していない」と混ぜない
    expect(document.body.textContent).toContain("時点: 読み込めませんでした"); // 読み込めなかったときも『時点』の欄を出す
    stub({ summary: SUMMARY });
    fireEvent.click(screen.getByRole("button", { name: /もう一度/ }));
    await waitFor(() => expect(screen.getByText("24/24 件")).toBeTruthy());
  });

  it("JSON として壊れた中身（HTML ではない）も読み込めなかった扱い", async () => {
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
    await screen.findByText(/読み込めませんでした/);
    expect(document.body.textContent).not.toContain("試験はまだ実行していません");
  });

  it("サーバーの 500 も読み込めなかった扱い", async () => {
    stub({ summary: "error" });
    render(
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/読み込めませんでした/);
  });
});

// 断りは節の冒頭と各表の上の文に 1 回ずつ。表の行の見出しは短い名前にし、「推定」「仮定」を行ごとに繰り返さない
// （2026-11-08 レビューの提案。前のレビュー I-1〜I-3 の「行ごとに推定と書く」決まりを、冒頭の 1 回へ移した）
describe("見積もりと実測の分離、前提の開示（断りは 1 回）", () => {
  const estimateBox = () => within(region(/計算/)).getByRole("heading", { name: "仮定から出した見積もり" }).parentElement!;
  const lead = () => region(/計算/).querySelector("p")!;

  it("見積もりは実測の表とは別の表。表の名前は、すぐ上の見出し（caption を重ねない）", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    const tables = within(region(/計算/)).getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(region(/計算/)).getByRole("table", { name: "実測の使用量から計算した費用" })).toBe(tables[0]);
    expect(within(region(/計算/)).getByRole("table", { name: "仮定から出した見積もり" })).toBe(tables[1]);
    for (const t of tables) expect(t.querySelector("caption")).toBeNull();
    expect(tables[0]!.textContent).not.toContain("主の AI だけ"); // 実測の表に仮定だけの見積もりの行が混ざらない
    expect(tables[0]!.textContent).not.toContain("確かめ役の AI も含む");
    expect(estimateBox().contains(tables[1]!)).toBe(true);
  });

  it("節の冒頭に、円の額は 1 事例 12 文書の仮定による見積もりと 1 回だけ書く。実測があるときだけ、実測は 1 文書あたりの額だけと書く", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    expect(lead().textContent).toContain("円の額は、1 事例 12 文書と仮定した見積もりです。");
    expect(lead().textContent).toContain("実測の使用量から出したのは、1 文書あたりの額だけです。");
    const calc = region(/計算/).textContent!;
    expect(calc.split("12 文書と仮定").length - 1).toBe(1);
    expect(calc).not.toContain("推定");
    cleanup();
    await show();
    expect(lead().textContent).toContain("円の額は、1 事例 12 文書と仮定した見積もりです。");
    expect(lead().textContent).not.toContain("実測"); // 何も測っていないときに「実測」と言わない
  });

  it("行の見出しは短い名前で、『推定』『仮定』『見積もり』を繰り返さない。試験の行の実行方式は、表の上の文に書く", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    const heads = Array.from(region(/計算/).querySelectorAll("tbody th")).map((h) => h.textContent);
    expect(heads).toEqual(["再現の実測から", "読み取りの試験から", "主の AI だけ", "確かめ役の AI も含む"]);
    for (const h of heads) expect(h).not.toMatch(/推定|仮定|見積もり|足/);
    const measuredBox = within(region(/計算/)).getByRole("heading", { name: "実測の使用量から計算した費用" }).parentElement!;
    expect(measuredBox.textContent).toContain("実行方式（通常の API か Batch か）は記録がありません");
  });

  it("試験の結果がなければ、実行方式の文は出さない", async () => {
    await show({ usage: MEASURED_USAGE });
    expect(region(/計算/).textContent).not.toContain("実行方式");
  });

  it("何も測っていなくても、見積もりの表は見出し付きで 1 つだけ出る（実測の表は出ない）", async () => {
    await show();
    expect(within(region(/計算/)).getAllByRole("table")).toHaveLength(1);
    expect(within(region(/計算/)).queryByRole("heading", { name: /実測の使用量から計算/ })).toBeNull();
  });

  it("主の AI だけの行は確かめ役の AI（Haiku）を含まないと表の上に書き、Haiku も含む行も出す。増え方はまだ測っていない", async () => {
    await show();
    const box = estimateBox();
    expect(box.textContent).toContain("「主の AI だけ」は、確かめ役の AI（Haiku）の費用を含みません");
    expect(box.textContent).toContain("Haiku にも同じ量を読ませたと仮定して合わせた数です。実際の増え方はまだ測っていません。");
    expect(box.textContent).toContain("1 文書あたりの額も仮定の数です");
    expect(box.textContent).not.toMatch(/足し|増分/);
    expect(within(box).getByRole("row", { name: /主の AI だけ/ }).textContent).toContain("1 か月に");
    const withSecond = within(box).getByRole("row", { name: /確かめ役の AI も含む/ });
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

describe("見出しの段と時点の書き方", () => {
  it("単独の /results: 題は h1、節は h2、計算の中の見出しは h3", async () => {
    await show({ usage: MEASURED_USAGE, summary: SUMMARY });
    expect(screen.getByRole("heading", { level: 2, name: "1 シーズンの費用（計算）" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "実測の使用量から計算した費用" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "仮定から出した見積もり" })).toBeTruthy();
  });

  it("時点の日付が形の違う文字やありえない日付でも、画面を止めずにそのまま出す", async () => {
    await show({ summary: { ...SUMMARY, measuredAt: "2026-13-45T10:00:00+09:00" } });
    expect(region(/読み取りの試験/).textContent).toContain("時点: 2026-13-45T10:00:00+09:00");
  });
});

describe("リンク", () => {
  it("地図と舞台裏へのリンクがある", async () => {
    await show();
    expect(screen.getByRole("link", { name: /地図/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /舞台裏/ }).getAttribute("href")).toBe("/replay/backstage");
  });

  it("末尾に発生傾向へのリンクがあり、3 本とも .tap-link", async () => {
    await show();
    const trends = screen.getByRole("link", { name: "発生傾向" });
    expect(trends.getAttribute("href")).toBe("/trends");
    for (const l of [trends, screen.getByRole("link", { name: /地図/ }), screen.getByRole("link", { name: /舞台裏/ })]) expect(l.classList.contains("tap-link")).toBe(true);
  });
});

describe("表の見た目（.data-table と .table-scroll）", () => {
  it("試験の表と費用の表は .data-table で、.table-scroll に入る。数値のセルにだけ .num を付け、文のセルには付けない", async () => {
    await show({ summary: SUMMARY, usage: MEASURED_USAGE });
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThanOrEqual(3);
    for (const t of tables) {
      expect(t.classList.contains("data-table")).toBe(true);
      expect(t.parentElement!.classList.contains("table-scroll")).toBe(true);
    }
    // 試験の表: 結果は .num、補足は .num でない
    const row = within(region(/読み取りの試験/)).getByRole("row", { name: /市町村/ });
    const cells = row.querySelectorAll("td");
    expect(cells[0]!.classList.contains("num")).toBe(true);
    expect(cells[1]!.classList.contains("num")).toBe(false);
    // 費用の表: 金額は .num、『1 か月に N 事例まで』は .num でない
    const cost = within(region(/計算/)).getAllByRole("table")[0]!;
    const cr = cost.querySelectorAll("tbody tr")[0]!.querySelectorAll("td");
    for (let i = 0; i < cr.length - 1; i++) expect(cr[i]!.classList.contains("num"), cr[i]!.textContent ?? "").toBe(true);
    expect(cr[cr.length - 1]!.classList.contains("num")).toBe(false);
    expect(cr[cr.length - 1]!.textContent).toContain("事例まで");
  });
});

describe("文の列がある表は狭い幅で積む", () => {
  it("2 つの表に data-table-stack が付き、表の役割が明示されている", async () => {
    await show({ summary: SUMMARY });
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
    for (const t of tables) {
      expect(t.classList.contains("data-table-stack")).toBe(true);
      expect(t.getAttribute("role")).toBe("table");
      expect(t.querySelector("tbody tr")!.getAttribute("role")).toBe("row");
    }
  });

  it("値の欄は data-label に見出しと同じ文を持ち、積んだときも何の値か分かる", async () => {
    await show({ summary: SUMMARY });
    const costTables = screen.getAllByRole("table").filter((t) => t.querySelector("thead")!.textContent!.includes("1 文書"));
    expect(costTables.length).toBeGreaterThanOrEqual(1);
    for (const t of costTables) {
      const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent);
      const cells = [...t.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")];
      expect(cells.length).toBeGreaterThan(0);
      cells.forEach((c, i) => expect(c.getAttribute("data-label")).toBe(heads[i + 1]));
    }
  });
});
