import type { BackstageEntry, BackstageFile, MeasuredUsage, ReplayScenario } from "@hpai/shared/replay";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import backstageJson from "../../../../data/replay/backstage.json";
import scenarioJson from "../../../../data/replay/scenario.json";
import usageJson from "../../../../data/replay/measured-usage.json";
import BackstagePage from "./BackstagePage";

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
      if (u.endsWith("replay/backstage.json")) return Promise.resolve(over.failBackstage ? new Response("", { status: 404 }) : new Response(JSON.stringify(over.backstage ?? backstageJson), { status: 200 }));
      if (u.endsWith("replay/measured-usage.json")) return Promise.resolve(new Response(JSON.stringify(over.usage ?? usageJson), { status: 200 }));
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

describe("舞台裏の画面（データが未計測）", () => {
  it("帯: 去年の再現の舞台裏であることと、『時点』は未計測", async () => {
    await show();
    const band = screen.getByRole("region", { name: "去年の再現の舞台裏" });
    expect(within(band).getByText(/去年の再現です/)).toBeTruthy();
    expect(within(band).getByText(/時点/).textContent).toContain("未計測");
    expect(within(band).getByText(/AI が下書きし、プログラムが確かめる/)).toBeTruthy();
  });

  it("実物を読んでいないことを正直に出す（作り話の数字や読み取り結果を出さない）", async () => {
    await show();
    expect(section("二つの読み手").textContent).toContain("未計測");
    expect(section("検査").textContent).toContain("未計測");
    expect(section("入れ替えた値").textContent).toContain("未計測");
    expect(section("費用").textContent).toContain("未計測");
    expect(screen.queryByText(/トークン/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+ 円/);
  });

  it("必要な節がある: 二つの読み手、検査、入れ替えた値、見回りの状況、入口を直すエージェント、試験の結果", async () => {
    await show();
    for (const name of ["二つの読み手", "検査", "入れ替えた値", "見回りの状況", "入口を直すエージェント", "試験の結果"]) {
      expect(section(name), name).toBeTruthy();
    }
  });

  it("見回りの状況: 47 都道府県のうち N 件を確認、M 件は確認できていません（愛知県）。説明のための例", async () => {
    await show();
    const s = section("見回りの状況");
    expect(s.textContent).toContain("47 都道府県のうち 46 件を確認、1 件は確認できていません（愛知県）");
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
    expect(screen.getByRole("region", { name: "去年の再現の舞台裏" }).textContent).not.toContain("未計測");
    const readers = section("二つの読み手");
    expect(readers.textContent).toContain("津山市");
    expect(readers.textContent).toContain("主の読み手");
    expect(readers.textContent).toContain("別の読み手");
    const checks = section("検査");
    expect(checks.textContent).toContain("radius_sentence");
    const demo = section("入れ替えた値");
    expect(demo.textContent).toContain("1km");
    expect(demo.textContent).toContain("米子市");
    expect(demo.textContent).toContain("落としました");
    expect(demo.textContent).toContain("確認中に回します");
    expect(within(demo).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
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
    const link = within(section("二つの読み手")).getAllByRole("link", { name: /原文/ })[0]!;
    expect(link.getAttribute("href")).toBe("https://example.test/confirmed");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("読み込みの失敗", () => {
  it("backstage.json を読めなくても throw せず、状況を出して、もう一度読むボタンがある", async () => {
    stub({ failBackstage: true });
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読めませんでした"));
    expect(screen.getByRole("button", { name: "もう一度読む" })).toBeTruthy();
  });

  it("scenario を読めなくても同じ", async () => {
    stub({ failScenario: true });
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読めませんでした"));
  });

  it("fetch がない環境（経路の試験など）でも throw しない", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    render(
      <MemoryRouter>
        <BackstagePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("読めませんでした"));
  });
});
