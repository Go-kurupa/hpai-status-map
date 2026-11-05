// X-08: 見本の農場の 3 つの画面（/sample、/sample/todo、/sample/record/*）。M の画面を ReplayFrame（recordStore）で包む。
// 会員の状態（useAuthUser）と Firebase は一切読まない（読めば試験が落ちる）。通信は静的ファイルの 3 つだけ。
import { createGeoStore } from "@hpai/shared/geo";
import { MORTALITY_TEXT } from "@hpai/shared/mortality";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import historyJson from "../../../../data/history/cases.json";
import sampleJson from "../../../../data/replay/sample-farm.json";
import scenarioJson from "../../../../data/replay/scenario.json";
import { routes } from "../../routes";
import { RECORD_TEXT } from "../record/recordTexts";
import { TODO_TEXT, WORKER_MESSAGE_TEXT } from "../todo/texts";
import { SAMPLE_TEXT } from "./sampleTexts";

vi.mock("../../geo/loadGeo", () => {
  const store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) =>
      JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  return { loadWebGeoStore: () => Promise.resolve(store), loadJapanTopo: () => Promise.reject(new Error("unused")), loadPrefAnchors: () => Promise.reject(new Error("unused")) };
});

// 見本は会員の状態も Firebase も読まない。読んだら投げて、試験を落とす
const forbidden = vi.hoisted(() => ({ auth: vi.fn(), firebase: vi.fn() }));
vi.mock("../auth/useAuthUser", () => ({
  useAuthUser: () => {
    forbidden.auth();
    throw new Error("見本は会員の状態を読みません");
  },
}));
vi.mock("../../firebase", () => ({
  getFirebase: () => {
    forbidden.firebase();
    return Promise.reject(new Error("見本は Firebase を読みません"));
  },
}));

import SampleLayout from "./SampleLayout";
import SamplePage from "./SamplePage";
import SampleRecordPage from "./SampleRecordPage";
import SampleTodoPage from "./SampleTodoPage";

let fetched: string[];
function stubFetch(opts: { failSample?: boolean } = {}) {
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      fetched.push(u);
      if (u.endsWith("replay/scenario.json")) return Promise.resolve(new Response(JSON.stringify(scenarioJson), { status: 200 }));
      if (u.endsWith("replay/sample-farm.json")) {
        return Promise.resolve(opts.failSample ? new Response("", { status: 404 }) : new Response(JSON.stringify(sampleJson), { status: 200 }));
      }
      if (u.endsWith("history/cases.json")) return Promise.resolve(new Response(JSON.stringify(historyJson), { status: 200 }));
      return Promise.reject(new Error(`想定しない通信: ${u}`));
    }),
  );
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function mount(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/sample" element={<SampleLayout />}>
          <Route index element={<SamplePage />} />
          <Route path="todo" element={<SampleTodoPage />} />
          <Route path="record" element={<SampleRecordPage />} />
          <Route path="record/deaths" element={<SampleRecordPage />} />
          <Route path="record/self-check" element={<SampleRecordPage />} />
          <Route path="record/disinfection" element={<SampleRecordPage />} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  forbidden.auth.mockClear();
  forbidden.firebase.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/sample（入口）", () => {
  it("『去年の再現です』の帯、『見本です（作り物のデータ）』、架空の説明、時点がある", async () => {
    mount("/sample");
    await screen.findByRole("heading", { level: 1, name: "見本の農場" });
    expect(screen.getAllByText(FIXED_TEXT.replayBanner).length).toBeGreaterThan(0);
    expect(screen.getAllByText(SAMPLE_TEXT.badge).length).toBeGreaterThan(0);
    expect(text()).toContain("架空の農場です。数字は作り物です");
    expect(text()).toContain("時点");
    expect(text()).toContain("2025年12月30日");
    expect(text()).toContain("鶏舎A");
    expect(text()).toContain("5000");
  });

  it("/sample/todo と /sample/record/deaths へのリンクがある", async () => {
    mount("/sample");
    await screen.findByRole("heading", { level: 1, name: "見本の農場" });
    expect(screen.getByRole("link", { name: /^やること$/ }).getAttribute("href")).toBe("/sample/todo");
    expect(screen.getByRole("link", { name: /記録/ }).getAttribute("href")).toBe("/sample/record/deaths");
  });

  it("見本の帯の『記録』は下のタブと同じ死亡数へ着く", async () => {
    mount("/sample/todo");
    const nav = await screen.findByRole("navigation", { name: SAMPLE_TEXT.navLabel });
    expect(within(nav).getByRole("link", { name: SAMPLE_TEXT.navRecord }).getAttribute("href")).toBe("/sample/record/deaths");
  });

  it("入口の末尾に『去年の再現へ』（/replay）と『鶏を飼っていない方へ』（/public）のリンクがある", async () => {
    mount("/sample");
    await screen.findByRole("heading", { level: 1, name: "見本の農場" });
    expect(screen.getByRole("link", { name: "去年の再現へ" }).getAttribute("href")).toBe("/replay");
    expect(screen.getByRole("link", { name: "鶏を飼っていない方へ" }).getAttribute("href")).toBe("/public");
  });

  it("見本の見出しと保存されない短い断りは再現の帯より前で、畳まない。再現の帯は題と時点だけ。その後に行き来の nav", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    const lead = document.querySelector(".sample-lead")!;
    expect(lead.children[0]!.className).toBe("sample-badge");
    expect(lead.children[0]!.textContent).toBe(SAMPLE_TEXT.badge);
    expect(lead.children[1]!.textContent).toBe("入れた記録は保存されません");
    expect(lead.children[1]!.closest("details")).toBeNull();
    const replayBand = document.querySelector(".replay-band")!;
    expect(lead.compareDocumentPosition(replayBand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...replayBand.children].map((e) => e.className)).toEqual(["replay-title", "replay-time"]);
    expect(replayBand.querySelector("details")).toBeNull();
    const nav = screen.getByRole("navigation", { name: SAMPLE_TEXT.navLabel });
    expect(replayBand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.closest("details")).toBeNull();
  });

  it("残りの説明は 1 つの『くわしく』に畳み、閉じていても DOM にある（保存されない全文、架空の文、時点、再現の帯の文と注記）", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    const folds = document.querySelectorAll(".sample-lead details");
    expect(folds).toHaveLength(1);
    const fold = folds[0] as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")?.textContent).toBe("くわしく");
    const inFold = fold.textContent ?? "";
    expect(inFold).toContain(SAMPLE_TEXT.notSent);
    expect(inFold).toContain(`${SAMPLE_TEXT.fictional}。${SAMPLE_TEXT.member}`);
    expect(inFold).toContain(SAMPLE_TEXT.asOf("2025年12月30日"));
    expect(inFold).toContain(FIXED_TEXT.replayBanner);
    expect(inFold).toContain("仮の地点で見ています");
    expect(inFold).toContain("特定の農場を指すものではありません");
    expect(inFold).toContain("津山市の範囲から 5km 以内");
  });

  it("読み込めなければ、そう書く（空の画面を出さない）。やり直せる", async () => {
    stubFetch({ failSample: true });
    mount("/sample");
    expect(await screen.findByText(/見本のデータを読めませんでした/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "もう一度読む" })).toBeTruthy();
    expect(screen.queryByText(FIXED_TEXT.replayBanner)).toBeNull();
  });
});

describe("/sample/todo（帯）", () => {
  it("再現の帯の箇条書き（.replay-notes）は『くわしく』に畳み、4 文が DOM にある", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    const notes = document.querySelector(".replay-notes")!;
    expect(notes.closest("details")?.closest(".sample-lead")).toBeTruthy();
    expect(notes.querySelectorAll("li").length).toBe(4);
  });
});

describe("/sample/todo", () => {
  it("『架空の農場です。数字は作り物です』と『去年の再現です』。① で 3 つの分類が分かれ、移動制限の見込みは 1 月 21 日", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    expect(text()).toContain("架空の農場です。数字は作り物です");
    expect(screen.getAllByText(FIXED_TEXT.replayBanner).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll(".class-block").length).toBe(3));
    const classes = [...document.querySelectorAll(".class-block")].map((e) => e.className);
    expect(classes.some((c) => c.includes("class-always"))).toBe(true);
    expect(classes.some((c) => c.includes("class-if_in_zone"))).toBe(true);
    expect(classes.some((c) => c.includes("class-good_to_check"))).toBe(true);
    const lift = await screen.findByRole("region", { name: TODO_TEXT.liftHeading });
    expect(lift.textContent).toContain("1月21日");
  });

  it("声かけ文は雛形（Claude の下書きではない）で、津山市の名前が入っている", async () => {
    mount("/sample/todo");
    const box = (await screen.findByLabelText(WORKER_MESSAGE_TEXT.label)) as HTMLTextAreaElement;
    expect(box.value).toContain("津山市");
    expect(screen.getByText(WORKER_MESSAGE_TEXT.sourceTemplate)).toBeTruthy();
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.sourceClaude)).toBeNull();
  });

  it("自己点検へのリンクは /sample/record の下に向かい、/record や /settings へのリンクがない", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    const link = await screen.findByRole("link", { name: TODO_TEXT.selfCheckLink });
    expect(link.getAttribute("href")).toBe("/sample/record/self-check");
    expectNoMemberLinks();
  });

  it("消毒の『やった』が押せて、記録は画面の中だけ（保存は見本の口へ）", async () => {
    mount("/sample/todo");
    await waitFor(() => expect(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) }).length).toBeGreaterThan(0));
    const btn = screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) })[0]!;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toBe(TODO_TEXT.doneSaved));
    expect(localStorage.length).toBe(0);
  });
});

function expectNoMemberLinks() {
  const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
  const bad = hrefs.filter((h) => /^\/(record|settings|login|join|todo$|operator)/.test(h));
  expect(bad).toEqual([]);
}

describe("/sample/record", () => {
  it("『去年の再現です』の帯と、4 つの行き先が /sample/record の下にある。『最後の記録』が出る。メールは止まっていない", async () => {
    mount("/sample/record");
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.exportTitle });
    expect(screen.getAllByText(FIXED_TEXT.replayBanner).length).toBeGreaterThan(0);
    expect(text()).toContain("架空の農場です。数字は作り物です");
    const nav = screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection", "/sample/record"]);
    await screen.findByText(/最後の記録: 2025年12月30日/);
    expect(text()).not.toContain(RECORD_TEXT.mailStopped);
    // 削除は見本に出さない
    expect(screen.queryByText(RECORD_TEXT.deleteHeading)).toBeNull();
    expect(screen.queryByRole("button", { name: RECORD_TEXT.deleteButton })).toBeNull();
  });

  it("タブを押すと /record へ移動せず、/sample/record/… の中で切り替わる", async () => {
    mount("/sample/record");
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.exportTitle });
    const nav = () => screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel });
    fireEvent.click(within(nav()).getByRole("link", { name: RECORD_TEXT.tabDeaths }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.deathsTitle });
    expect(where()).toBe("/sample/record/deaths");
    fireEvent.click(within(nav()).getByRole("link", { name: RECORD_TEXT.tabSelfCheck }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.selfTitle });
    expect(where()).toBe("/sample/record/self-check");
    fireEvent.click(within(nav()).getByRole("link", { name: RECORD_TEXT.tabDisinfection }));
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.panelTitle });
    expect(where()).toBe("/sample/record/disinfection");
    fireEvent.click(within(nav()).getByRole("link", { name: RECORD_TEXT.tabExport }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.exportTitle });
    expect(where()).toBe("/sample/record");
    expectNoMemberLinks();
  });

  it("鶏舎 A に 10 羽を入れると、基準に当たる可能性と見本の連絡先が出る。C では『まだ計算できません』", async () => {
    mount("/sample/record/deaths");
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.deathsTitle });
    const house = (await screen.findByLabelText(RECORD_TEXT.houseLabel)) as HTMLSelectElement;
    expect([...house.options].map((o) => o.textContent)).toEqual(["鶏舎A", "鶏舎B", "鶏舎C"]);
    expect(house.value).toBe("house-a");

    fireEvent.change(screen.getByLabelText(RECORD_TEXT.deathsLabel), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(result.textContent).toContain(MORTALITY_TEXT.hit);
    expect(result.textContent).toContain("直ちに家保へ通報してください（基準 項目 32）");
    expect(result.textContent).toContain(`${RECORD_TEXT.hitContact}: 見本の家保（作り物） 00-0000-0000`);
    expect(findForbiddenPhrases(result.textContent ?? "")).toEqual([]);

    fireEvent.change(house, { target: { value: "house-c" } });
    fireEvent.change(screen.getByLabelText(RECORD_TEXT.deathsLabel), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    const resultC = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(resultC.textContent).toContain(MORTALITY_TEXT.insufficient);
    expect(resultC.textContent).toContain("まだ計算できません");
    expect(resultC.textContent).not.toContain("直ちに家保へ");
    expectNoMemberLinks();
  });

  it("鶏舎 B では当たらない（設備の故障の日は除いて計算）", async () => {
    mount("/sample/record/deaths");
    const house = (await screen.findByLabelText(RECORD_TEXT.houseLabel)) as HTMLSelectElement;
    fireEvent.change(house, { target: { value: "house-b" } });
    fireEvent.change(screen.getByLabelText(RECORD_TEXT.deathsLabel), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(result.textContent).toContain(RECORD_TEXT.notHit);
    expect(result.textContent).not.toContain("直ちに家保へ");
    expect(result.textContent).toContain(RECORD_TEXT.excludedDays(1));
  });

  it("週の報告文をコピーできる（見本の農場名が入る）", async () => {
    mount("/sample/record/deaths");
    const box = (await screen.findByLabelText("週の報告文の下書き")) as HTMLTextAreaElement;
    expect(box.value).toContain("架空の見本農場");
    fireEvent.click(within(box.closest(".copy-box") as HTMLElement).getByRole("button", { name: RECORD_TEXT.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(box.value));
    await screen.findByText(RECORD_TEXT.copied);
  });

  it("自己点検の報告文をコピーできる（期限は設定済みで、設定への案内がない）。見本の記録が入っている", async () => {
    mount("/sample/record/self-check");
    const box = (await screen.findByLabelText(RECORD_TEXT.selfReportLabel)) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("19 衛生管理区域に立ち入る車両の消毒等: ×"));
    expect(box.value).toContain("農場名: 架空の見本農場");
    expect(box.value).toContain("対象の月: 2025年12月");
    expect(text()).not.toContain(RECORD_TEXT.selfDueMissing);
    expect(screen.queryByRole("button", { name: /送信|送る/ })).toBeNull();
    fireEvent.click(within(box.closest(".copy-box") as HTMLElement).getByRole("button", { name: RECORD_TEXT.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(box.value));
    expectNoMemberLinks();
  });

  it("記録した死亡数は、タブを移っても残る。ページを読み込み直す（新しい口）と元に戻る", async () => {
    const first = mount("/sample/record/deaths");
    await screen.findByLabelText(RECORD_TEXT.houseLabel);
    fireEvent.change(screen.getByLabelText(RECORD_TEXT.deathsLabel), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    const nav = screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel });
    fireEvent.click(within(nav).getByRole("link", { name: RECORD_TEXT.tabSelfCheck }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.selfTitle });
    fireEvent.click(within(screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel })).getByRole("link", { name: RECORD_TEXT.tabDeaths }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.deathsTitle });
    await waitFor(() => expect(text()).toContain("7 羽（飼養 5000 羽）"));
    first.unmount(); // ページの読み込み直しに当たる

    mount("/sample/record/deaths");
    await screen.findByLabelText(RECORD_TEXT.houseLabel);
    await waitFor(() => expect(text()).toContain("10 羽（飼養 5000 羽）"));
    expect(text()).not.toContain("7 羽（飼養 5000 羽）");
  });

  it("入口・やること・記録の間を移っても、見本の記録は残る（やること → 記録の消毒、入口を挟んでも）。読み込みは 1 回だけ", async () => {
    mount("/sample/todo");
    await waitFor(() => expect(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) }).length).toBeGreaterThan(0));
    const btn = screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) })[0]!;
    const label = btn.getAttribute("aria-label")!.replace(`${TODO_TEXT.done}: `, "");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toBe(TODO_TEXT.doneSaved));

    // 入口へ戻って、また記録へ
    fireEvent.click(within(screen.getByRole("navigation", { name: SAMPLE_TEXT.navLabel })).getByRole("link", { name: SAMPLE_TEXT.navEntry }));
    await screen.findByRole("heading", { level: 1, name: SAMPLE_TEXT.title });
    expect(screen.queryByRole("navigation", { name: SAMPLE_TEXT.navLabel })).toBeNull(); // 入口では行き来の帯を出さない
    fireEvent.click(screen.getByRole("link", { name: /^記録/ }));
    await screen.findByRole("heading", { level: 1, name: RECORD_TEXT.deathsTitle });
    fireEvent.click(within(screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel })).getByRole("link", { name: RECORD_TEXT.tabDisinfection }));
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.panelTitle });
    const recent = await screen.findByRole("region", { name: TODO_TEXT.panelRecent });
    await waitFor(() => expect(recent.textContent).toContain("12月30日"));
    expect(recent.textContent).toContain(label.slice(0, 10));
    // 同じ日の同じ項目は『今日は記録しました』のまま（やること側の「やった」の記録を引き継いでいる）
    expect(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}: ${label.slice(0, 10)}`) })[0]!.textContent).toBe(TODO_TEXT.doneSaved);
    expect(fetched.filter((u) => u.endsWith("sample-farm.json"))).toHaveLength(1);
    expect(fetched.filter((u) => u.endsWith("scenario.json"))).toHaveLength(1);
  });

  it("実際の経路表（routes.tsx）でも、やること → 記録で見本の記録が残る", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/sample/todo"] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) })[0]!);
    await waitFor(() => expect(screen.getAllByText(TODO_TEXT.doneSaved).length).toBeGreaterThan(0));
    await router.navigate("/sample/record/disinfection");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.panelTitle });
    const recent = await screen.findByRole("region", { name: TODO_TEXT.panelRecent });
    await waitFor(() => expect(recent.textContent).toContain("12月30日"));
    expect(forbidden.firebase).not.toHaveBeenCalled();
    expect(fetched.filter((u) => u.endsWith("sample-farm.json"))).toHaveLength(1);
  });
});

describe("見本の全体", () => {
  const pages = ["/sample", "/sample/todo", "/sample/record", "/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection"];

  it.each(pages)("%s: 『見本です（作り物のデータ）』と帯があり、禁止語がなく、会員向けの経路へのリンクがない", async (entry) => {
    mount(entry);
    await waitFor(() => expect(screen.getAllByText(SAMPLE_TEXT.badge).length).toBeGreaterThan(0));
    await waitFor(() => expect(document.querySelectorAll("h1").length).toBe(1));
    await new Promise((r) => setTimeout(r, 30)); // 読み込みの後の描き直しを待つ
    expect(screen.getAllByText(FIXED_TEXT.replayBanner).length).toBeGreaterThan(0);
    expect(findForbiddenPhrases(text())).toEqual([]);
    expectNoMemberLinks();
  });

  it("会員の状態と Firebase を一度も読まない。通信は静的ファイルだけ。localStorage に書かない", async () => {
    for (const entry of pages) {
      mount(entry);
      await waitFor(() => expect(screen.getAllByText(SAMPLE_TEXT.badge).length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 30));
      cleanup();
    }
    expect(forbidden.auth).not.toHaveBeenCalled();
    expect(forbidden.firebase).not.toHaveBeenCalled();
    expect(fetched.length).toBeGreaterThan(0);
    for (const u of fetched) expect(u).toMatch(/(replay\/scenario\.json|replay\/sample-farm\.json|history\/cases\.json)$/);
    expect(localStorage.length).toBe(0);
  });

  it("記録の画面の説明のうち『同じ農場の会員へメールで知らせます』は見本では送らない、と書いてある", async () => {
    mount("/sample/record/deaths");
    await screen.findByLabelText(RECORD_TEXT.houseLabel);
    expect(text()).toContain("メールは送りません");
  });
});
