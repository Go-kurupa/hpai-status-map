import { UNMEASURED_BACKSTAGE, UNMEASURED_USAGE, type BackstageEntry, type BackstageFile, type MeasuredUsage, type ReplayScenario } from "@hpai/shared/replay";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import backstageJson from "../../../../data/replay/backstage.json";
import scenarioJson from "../../../../data/replay/scenario.json";
import usageJson from "../../../../data/replay/measured-usage.json";
import BackstagePage, { detailText } from "./BackstagePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const scenario = scenarioJson as unknown as ReplayScenario;

// 画面の試験に使う、作った測定の結果（実測ではない。data/ には入れない）
const entry = (over: Partial<BackstageEntry> = {}): BackstageEntry => ({
  id: "t-confirmed",
  documentUrl: "https://example.test/confirmed",
  kind: "confirmed",
  primary: [
    { field: "municipality", value: "津山市", matchedWord: "津山市" },
    { field: "primaryDate", value: "2025-12-20 09:00", matchedWord: null },
  ],
  second: [{ field: "municipality", value: "津山市" }],
  checks: [
    { check: "quote_exists", pass: true, detail: "問題なし" },
    { check: "radius_sentence", pass: false, detail: "radiiKm: row0:radius_not_in_sentence（任意の項目。落として続行）" },
  ],
  verifyPass: true,
  droppedOptional: ["radiiKm"],
  compare: { match: true, mismatches: [] },
  tamperedDemo: { field: "radiiKm", before: "3km", after: "1km", rejectedBy: "radius_sentence" },
  ...over,
});
const MEASURED: BackstageFile = {
  status: "measured",
  measuredAt: "2026-11-06T10:00:00+09:00",
  entries: [
    entry(),
    entry({
      id: "t-suspected",
      documentUrl: "https://example.test/suspected",
      kind: "suspected",
      compare: { match: false, mismatches: ["municipality"] },
      tamperedDemo: { field: "municipality", before: "津山市", after: "米子市", rejectedBy: "compare" },
    }),
  ],
};
const MEASURED_USAGE: MeasuredUsage = {
  status: "measured",
  documents: 2,
  byModel: { "claude-opus-5-5": { inputTokens: 2000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  measuredAt: "2026-11-06T10:00:00+09:00",
};

function stub(over: { backstage?: unknown; usage?: unknown; failBackstage?: boolean; failScenario?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("replay/scenario.json")) return Promise.resolve(over.failScenario ? new Response("", { status: 404 }) : new Response(JSON.stringify(scenarioJson), { status: 200 }));
      if (u.endsWith("replay/backstage.json")) return Promise.resolve(over.failBackstage ? new Response("", { status: 404 }) : new Response(JSON.stringify(over.backstage ?? UNMEASURED_BACKSTAGE), { status: 200 }));
      if (u.endsWith("replay/measured-usage.json")) return Promise.resolve(new Response(JSON.stringify(over.usage ?? UNMEASURED_USAGE), { status: 200 }));
      return Promise.reject(new Error(`想定しない通信: ${u}`));
    }),
  );
  return calls;
}

async function show(over: Parameters<typeof stub>[0] = {}) {
  const calls = stub(over);
  const view = render(
    <MemoryRouter>
      <BackstagePage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /舞台裏/ });
  return { calls, view };
}

const section = (name: RegExp | string) => screen.getByRole("region", { name });

describe("舞台裏の画面（データがまだ測っていません）", () => {
  it("帯: 去年の再現の舞台裏であることと、『時点』はまだ測っていません", async () => {
    await show();
    const band = screen.getByRole("region", { name: "去年の再現の舞台裏" });
    expect(within(band).getByText(/去年の再現です/)).toBeTruthy();
    expect(within(band).getByText(/時点/).textContent).toContain("まだ測っていません");
    expect(within(band).getByText(/AI が下書きし、プログラムが確かめる/)).toBeTruthy();
  });

  it("実物を読んでいないことを正直に出す（作り話の数字や読み取り結果を出さない）", async () => {
    await show();
    expect(section("2 つの AI で読む").textContent).toContain("まだ測っていません");
    expect(section("検査").textContent).toContain("まだ測っていません");
    expect(section("入れ替えた値").textContent).toContain("まだ測っていません");
    expect(section("費用").textContent).toContain("まだ測っていません");
    expect(screen.queryByText(/トークン/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+ 円/);
  });

  it("必要な節がある: 二つの読み手、検査、入れ替えた値、県のホームページの確認の状況、入口を直すエージェント、試験の結果", async () => {
    await show();
    for (const name of ["2 つの AI で読む", "検査", "入れ替えた値", "県のホームページの確認の状況", "入口を直すエージェント", "試験の結果"]) {
      expect(section(name), name).toBeTruthy();
    }
  });

  it("県のホームページの確認の状況: 47 都道府県のうち N 県を確認、M 県は確認できていません（愛知県）。説明のための例", async () => {
    await show();
    const s = section("県のホームページの確認の状況");
    expect(s.textContent).toContain("47 都道府県のうち 46 県を確認、1 県は確認できていません（愛知県）");
    expect(s.textContent).toContain("説明のための例");
  });

  it("入口を直すエージェント: 提案だけで、運営者が承認する。まだ決まっていないこと", async () => {
    await show();
    const s = section("入口を直すエージェント");
    expect(s.textContent).toContain("提案");
    expect(s.textContent).toContain("承認");
    expect(s.textContent).toContain("未決");
  });

  it("試験の結果へのリンク", async () => {
    await show();
    const link = within(section("試験の結果")).getByRole("link", { name: /試験の結果/ });
    expect(link.getAttribute("href")).toBe("/results");
  });

  it("input と textarea がない。禁じた言い方がない", async () => {
    await show();
    expect(document.querySelector("input, textarea, select")).toBeNull();
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("scenario と backstage.json と measured-usage.json だけを読む（Claude も Firebase も呼ばない）", async () => {
    const { calls } = await show();
    expect(calls.sort()).toEqual(["/replay/backstage.json", "/replay/measured-usage.json", "/replay/scenario.json"].sort());
  });
});

describe("舞台裏の画面（測った後）", () => {
  it("『時点』に測った時刻。二つの読み手の値と、検査の行と、入れ替えた値が出る", async () => {
    await show({ backstage: MEASURED, usage: MEASURED_USAGE });
    expect(screen.getByRole("region", { name: "去年の再現の舞台裏" }).textContent).toContain("2026-11-06");
    expect(screen.getByRole("region", { name: "去年の再現の舞台裏" }).textContent).not.toContain("まだ測っていません");
    const readers = section("2 つの AI で読む");
    expect(readers.textContent).toContain("津山市");
    expect(readers.textContent).toContain("主の AI");
    expect(readers.textContent).toContain("確かめ役の AI");
    const checks = section("検査");
    expect(checks.textContent).toContain("半径が区域の文にある");
    expect(checks.textContent).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(checks.textContent).not.toMatch(/radiiKm|primaryDate|stageEvents|row\d/);
    const demo = section("入れ替えた値");
    expect(demo.textContent).toContain("1km");
    expect(demo.textContent).toContain("米子市");
    expect(demo.textContent).toContain("落としました");
    expect(demo.textContent).toContain("確認中に回します");
    expect(demo.textContent).not.toMatch(/quote_exists|compare|radius_sentence/);
    expect(demo.textContent).toContain("2 つの AI の結果が食い違い、確認中に回します。");
    expect(demo.textContent).toContain("検査（半径が区域の文にある）が落としました。");
    expect(within(demo).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("照合で止めた文書には、印と理由が検査の節に出る。印のない文書には出ない。禁じた言い方がない", async () => {
    const reason = "引用に日付がなく時刻だけだったので、プログラムは日付を確かめられず、確認中に回しました";
    const stopped = { ...MEASURED, entries: [entry({ verifyPass: false, verifyStopped: { fields: ["primaryDate"], reason } }), MEASURED.entries[1]!] };
    await show({ backstage: stopped, usage: MEASURED_USAGE });
    const checks = section("検査");
    const marks = within(checks).getAllByTestId("verify-stopped");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toContain("照合で止めました");
    expect(marks[0]!.textContent).toContain("日付");
    expect(marks[0]!.textContent).toContain(reason);
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("知らない項目は、落とした項目にも照合の停止にも名前を出さない", async () => {
    const e0 = entry({ droppedOptional: ["estimates"], verifyStopped: { fields: ["estimates"], reason: "理由です" } });
    await show({ backstage: { ...MEASURED, entries: [e0] }, usage: MEASURED_USAGE });
    const text = section("検査").textContent ?? "";
    expect(text).not.toContain("estimates");
    expect(text).not.toContain("任意の項目で落としたもの");
    expect(text).toContain("理由です。");
  });

  it("費用: 実測のトークン数と、推定費用は『推定』と分かる形", async () => {
    await show({ backstage: MEASURED, usage: MEASURED_USAGE });
    const cost = section("費用");
    expect(cost.textContent).toContain("2 本");
    expect(cost.textContent).toContain("claude-opus-5-5");
    expect(cost.textContent).toContain("2,000");
    expect(cost.textContent).toContain("推定");
  });

  it("測った項目に、出来事の名前と原文へのリンク（本文は出さない）", async () => {
    await show({ backstage: MEASURED, usage: MEASURED_USAGE });
    const link = within(section("2 つの AI で読む")).getAllByRole("link", { name: /原文/ })[0]!;
    expect(link.classList.contains("tap-link")).toBe(true); // 押せる高さ（44px 以上）
    expect(link.getAttribute("href")).toBe("https://example.test/confirmed");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("舞台裏の画面（実物の data/replay/）", () => {
  const real = backstageJson as unknown as BackstageFile;
  const realUsage = usageJson as unknown as MeasuredUsage;

  it("測り済み: 『時点』は測った日。『まだ測っていません』とは言わず、文書ごとの項目、入れ替えた値の例、費用が出る", async () => {
    expect(real.status).toBe("measured");
    await show({ backstage: real, usage: realUsage });
    const band = screen.getByRole("region", { name: "去年の再現の舞台裏" });
    expect(band.textContent).toContain(real.measuredAt!.slice(0, 10));
    expect(document.body.textContent).not.toContain("まだ測っていません");
    expect(within(section("2 つの AI で読む")).getAllByRole("link", { name: /原文/ })).toHaveLength(real.entries.length);
    expect(within(section("検査")).getAllByRole("heading", { level: 3 })).toHaveLength(real.entries.length);
    expect(within(section("入れ替えた値")).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(section("費用").textContent).toContain(`${realUsage.documents} 本`);
    expect(section("費用").textContent).toContain("推定");
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("照合で止めた文書（津山の疑いと確定）には印と理由が出て、それ以外には出ない", async () => {
    await show({ backstage: real, usage: realUsage });
    const stopped = real.entries.filter((e) => e.verifyStopped);
    expect(stopped.map((e) => e.id)).toEqual(["tsuyama-suspected", "tsuyama-confirmed"]);
    const marks = within(section("検査")).getAllByTestId("verify-stopped");
    expect(marks).toHaveLength(stopped.length);
    stopped.forEach((e, i) => {
      expect(marks[i]!.textContent).toContain("照合で止めました");
      expect(marks[i]!.textContent).toContain(e.verifyStopped!.reason);
    });
    // 止めた文書は『載せません』と出し、通った文書の数と合う
    expect(within(section("検査")).getAllByText(/必須の項目が通らなかったので、載せません/)).toHaveLength(stopped.length);
  });
});

describe("detailText（検査に落ちた理由を日本語にする）", () => {
  it("項目と識別子を日本語にし、rowN は捨て、（注）は残す", () => {
    expect(detailText("radiiKm: row0:radius_not_in_sentence（任意の項目。落として続行）")).toBe("区域の半径: 半径が区域の文の中にありません（任意の項目。落として続行）");
    expect(detailText("stageEvents: row0:date_not_in_quote（任意の項目。落として続行）")).toBe("段階の日付: 日付が引用の中にありません（任意の項目。落として続行）");
    expect(detailText("primaryDate: date_not_in_quote（必須の項目）")).toBe("日付: 日付が引用の中にありません（必須の項目）");
  });
  it("複数の部分は ' / ' でつなぎ、置き換えた結果が同じものは 1 回にまとめる", () => {
    expect(detailText("radiiKm: row0:radius_not_in_sentence（任意の項目。落として続行） / radiiKm: row1:radius_not_in_sentence（任意の項目。落として続行）")).toBe(
      "区域の半径: 半径が区域の文の中にありません（任意の項目。落として続行）",
    );
    expect(detailText("primaryDate: date_not_in_quote（必須の項目） / headCount: culled_count_not_flock_size（任意の項目。落として続行）")).toBe(
      "日付: 日付が引用の中にありません（必須の項目） / 羽数: 引用の数は処分の数で、飼養の羽数ではありません（任意の項目。落として続行）",
    );
  });
  it("知らない識別子は『検査に落ちました』。知らない項目は項目名を出さない", () => {
    expect(detailText("headCount: something_new（必須の項目）")).toBe("羽数: 検査に落ちました（必須の項目）");
    expect(detailText("unknownField: row2:something_new（任意の項目）")).toBe("検査に落ちました（任意の項目）");
  });
  it("項目の後ろに対象の接頭が付く形（estimates）も、英語を出さない", () => {
    expect(detailText("estimates: shipment:estimates_disagree（任意の項目。落として続行）")).toBe("検査に落ちました（任意の項目。落として続行）");
    expect(detailText("primaryDate: shipment:estimates_disagree（必須の項目）")).toBe("日付: 検査に落ちました（必須の項目）");
    expect(detailText("形に合わない foo_bar です")).toBe("検査に落ちました");
  });
  it("日本語だけの detail はそのまま", () => {
    expect(detailText("問題なし")).toBe("問題なし");
  });
  it("表の 17 個の識別子はすべて日本語に置き換わる", () => {
    const codes = [
      "after_announcement", "before_previous_stage", "conflicts_with_known_stage", "culled_count_not_flock_size", "date_not_in_quote", "kind_stage_mismatch",
      "missing_quote", "missing_value", "name_not_unique_for_filled_prefecture", "no_text_layer", "not_in_prefecture", "out_of_season_or_invalid",
      "prefecture_name_in_municipality", "quote_not_in_document", "radius_not_in_sentence", "stage_word_not_in_quote", "unknown_prefecture", "value_not_in_quote",
    ];
    for (const c of codes) {
      const t = detailText(`prefecture: ${c}（必須の項目）`);
      expect(t, c).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(t, c).not.toContain("検査に落ちました");
    }
  });
  it("実物の backstage.json の detail をすべて通しても、英語の識別子と内部の項目名が残らない", () => {
    const real = backstageJson as unknown as BackstageFile;
    let n = 0;
    for (const e of real.entries) {
      for (const c of e.checks) {
        const t = detailText(c.detail);
        n += 1;
        expect(t, c.detail).not.toMatch(/[a-z]+_[a-z_]+/);
        expect(t, c.detail).not.toMatch(/primaryDate|radiiKm|stageEvents|row\d/);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe("舞台裏の画面（実物の検査の一覧と、リンク）", () => {
  it("検査の一覧に英語の識別子と内部の項目名が出ない", async () => {
    await show({ backstage: backstageJson, usage: usageJson });
    const t = section("検査").textContent ?? "";
    expect(t).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(t).not.toMatch(/primaryDate|radiiKm|stageEvents|row\d/);
  });
  it("末尾に見本の農場で試すリンクがあり、リンクは .tap-link", async () => {
    await show();
    const sample = screen.getByRole("link", { name: "見本の農場で試す" });
    expect(sample.getAttribute("href")).toBe("/sample");
    for (const l of [sample, screen.getByRole("link", { name: "再現に戻る" }), screen.getByRole("link", { name: /試験の結果を見る/ })]) expect(l.classList.contains("tap-link")).toBe(true);
  });
});

describe("読み込みの失敗", () => {
  it("backstage.json を読み込めなくても throw せず、状況を出して、もう一度読むボタンがある", async () => {
    stub({ failBackstage: true });
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読み込めませんでした"));
    expect(screen.getByRole("button", { name: "もう一度読む" })).toBeTruthy();
  });

  it("scenario を読み込めなくても同じ", async () => {
    stub({ failScenario: true });
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読み込めませんでした"));
  });

  it("fetch がない環境（経路の試験など）でも throw しない", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読み込めませんでした"));
  });
});
