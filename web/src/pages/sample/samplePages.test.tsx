// 近くで発生した場合の見え方（/sample と /sample/todo。2026-11-08 作者の決定で、記録を試す画面をなくした）。
// 去年 12 月の 4 事例の再現を、見本の農場の鶏舎の場所（仮の地点）で見る。地図と対策項目は ReplayFrame（recordStore）で包み、複製しない。
// 会員の状態（useAuthUser）と Firebase は一切読まない（読み込めば試験が落ちる）。通信は静的ファイルの 3 つだけ。
import { createGeoStore } from "@hpai/shared/geo";
import type { ReplayScenario, SampleFarmData } from "@hpai/shared/replay";
import { findForbiddenPhrases } from "@hpai/shared/wording";
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
import { CONTEXT_BAND } from "../../ui/AppShell";
import type { MapViewProps } from "../map/MapView";
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

// MapView は maplibre（WebGL）を使うので差し替える。渡された props を控える（地図の寄せ先を確かめる）
const seen = vi.hoisted(() => [] as MapViewProps[]);
vi.mock("../map/MapView", () => ({
  default: (props: MapViewProps) => {
    seen.push(props);
    return <div data-testid="map" />;
  },
}));

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

import { sampleStartOrder } from "./SampleFrame";
import SampleLayout from "./SampleLayout";
import SamplePage from "./SamplePage";
import SampleTodoPage from "./SampleTodoPage";

const scenario = scenarioJson as unknown as ReplayScenario;
const sample = sampleJson as unknown as SampleFarmData;
const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";

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
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

/** 実際の経路表（routes.tsx。画面の骨格と、/sample/record からの送りを含む） */
function mountRoutes(entry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

/** 地図が出て、見回りの結果（再現の時計）が届くまで待つ（ReplayPage の試験と同じ） */
async function mapReady() {
  await screen.findByTestId("map", undefined, { timeout: 10_000 });
  await waitFor(() => expect(screen.getByTestId("watch-line").textContent).toMatch(/47 都道府県/));
}

/** 日付の一覧のボタン（畳んであるので開いてから探す） */
const item = (re: RegExp) => {
  const fold = screen.getByRole("list", { name: "日付の一覧", hidden: true }).closest("details");
  if (fold) fold.open = true;
  return within(screen.getByRole("list", { name: "日付の一覧" })).getByRole("button", { name: re });
};

const text = () => document.body.textContent ?? "";
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function expectNoMemberLinks() {
  const hrefs = [...document.querySelectorAll(".app-main a[href], .replay-scope a[href]")].map((a) => a.getAttribute("href") ?? "");
  const bad = hrefs.filter((h) => /^\/(record|settings|login|join|todo$|operator|consult)|^\/sample\/record/.test(h));
  expect(bad).toEqual([]);
}

beforeEach(() => {
  seen.length = 0;
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

describe("開いたときの時刻", () => {
  it("仮の地点にメールが届く最初の出来事（12月19日 津山市 疑い、4 番目）。見本の農場の鶏舎の場所は再現の仮の地点と同じ", () => {
    const order = sampleStartOrder(scenario, sample);
    expect(order).toBe(4);
    const e = scenario.events[order - 1]!;
    expect(e.date).toBe("2025-12-19");
    expect(e.caseAfter.muniName).toBe("津山市");
    expect(e.noticePreview?.text).toContain("津山市で疑いの発表がありました");
    expect(scenario.events.slice(0, order - 1).some((x) => x.noticePreview)).toBe(false);
    expect(sample.farm.meshCode).toBe(scenario.defaultSpot.meshCode);
    expect(sample.farm.muniCode).toBe(scenario.defaultSpot.muniCode);
  });
});

describe("/sample（地図）", () => {
  it("12月19日 津山市 疑いの時刻で始まり、区域に入っている可能性と『このときメールが届く』が出る", async () => {
    mount("/sample");
    await mapReady();
    expect(document.querySelector(".replay-now")?.textContent).toBe("12 月 19 日 津山市 疑い");
    expect(document.querySelector(".replay-position")?.textContent).toBe(`4 / ${scenario.events.length}`);
    const mail = screen.getByRole("region", { name: "このときメールが届く" });
    expect(mail.textContent).toContain("津山市で疑いの発表がありました");
    expect(mail.textContent).toContain("再現では実際には送りません");
    await waitFor(() => expect(text()).toContain(ZONE));
    expect(text()).toContain("再現の時点: 12 月 19 日");
  });

  // 2026-11-08 PM: 全国の広さで始まると、見本の農場の近くの距離の輪が見えない。去年の再現の画面（/replay）の 4 事例は全国の広さのまま
  it("地図は最初から選択地域付近（見本の農場の地点のまわり、距離の輪が見える広さ）。『全国』ではない", async () => {
    mount("/sample");
    await mapReady();
    await waitFor(() => expect(seen.at(-1)!.focus?.kind).toBe("rings"));
    expect(seen.at(-1)!.focus?.codes).toEqual([sample.farm.muniCode]);
    const scope = screen.getByRole("group", { name: "地図の見る場所" });
    const pressed = within(scope)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).not.toBe("全国");
  });

  it("見出し（h1）は近くで発生した場合の見え方。地図の『今季』の見出しは再現と同じく隠す", async () => {
    mount("/sample");
    await mapReady();
    const h1s = [...document.querySelectorAll("h1")].filter((h) => !h.closest(".map-page"));
    expect(h1s.map((h) => h.textContent)).toEqual([SAMPLE_TEXT.heading]);
    expect(h1s[0]!.className).toBe("replay-heading");
  });

  it("前へ・次へと日付の一覧で、再現の画面と同じく時刻を動かせる", async () => {
    mount("/sample");
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    await waitFor(() => expect(document.querySelector(".replay-now")?.textContent).toBe("12 月 20 日 津山市 確定"));
    expect(screen.getByRole("region", { name: "このときメールが届く" }).textContent).toContain("津山市で確定の発表がありました");
    fireEvent.click(screen.getByRole("button", { name: "前へ" }));
    fireEvent.click(screen.getByRole("button", { name: "前へ" }));
    await waitFor(() => expect(document.querySelector(".replay-now")?.textContent).toBe("12 月 17 日 米子市 搬出制限の解除"));
    expect(screen.queryByRole("region", { name: "このときメールが届く" })).toBeNull();
    expect(text()).toContain("この出来事では、この地点にメールは届きません。");
    fireEvent.click(item(/はじまり/));
    await waitFor(() => expect(document.querySelector(".replay-position")?.textContent).toBe(`0 / ${scenario.events.length}`));
  });

  it("流れと見る場所の切り替え、舞台裏へのリンクは出さない（再現の画面だけのもの）", async () => {
    mount("/sample");
    await mapReady();
    expect(screen.queryByRole("group", { name: "再現の範囲" })).toBeNull();
    expect(screen.queryByRole("group", { name: "見る場所" })).toBeNull();
    expect(screen.queryByRole("button", { name: "全国の流れ" })).toBeNull();
    expect(screen.queryByRole("link", { name: /舞台裏/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "近くで発生した場合の見え方" })).toBeNull();
  });

  it("枠つきの帯（再現の帯、見本の点線の枠）と行き来のボタンはない。時点と『鶏舎の場所は説明のために置いた仮の地点です』が 1 回だけ", async () => {
    mount("/sample");
    await mapReady();
    expect(document.querySelector(".replay-band")).toBeNull();
    expect(document.querySelector(".sample-band, .sample-lead, .sample-badge, .sample-nav")).toBeNull();
    expect(text()).not.toContain("見本です（作り物のデータ）");
    expect(text()).not.toContain("記録を試す");
    const under = screen.getByRole("region", { name: "去年の再現" });
    expect(under.className).toBe("replay-under");
    expect([...under.children].map((e) => e.className)).toEqual(["replay-time", "replay-spot", "fold band-fold"]);
    expect(under.querySelector(".replay-spot")?.textContent).toBe(SAMPLE_TEXT.farmNote);
    expect(count(text(), SAMPLE_TEXT.farmNote)).toBe(1);
    // 再現の仮の地点の短い 1 行と、くわしくの中の仮の地点の説明は、見本の 1 行に替えている（仮の地点の説明を重ねない）
    expect(text()).not.toContain("仮の地点で見ています");
    expect(text()).not.toContain("津山市の範囲から 5km 以内");
  });

  it("残りの注記は 1 つの『くわしく』に畳み、閉じていても DOM にある（4 事例だけ、斜線は例、メールは送らない、時刻の記載なし）", async () => {
    mount("/sample");
    await mapReady();
    const fold = document.querySelector(".replay-under details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")?.textContent).toBe("くわしく");
    expect(fold.querySelectorAll(".replay-notes li")).toHaveLength(4);
    expect(fold.textContent).toMatch(/4 事例だけ/);
    expect(fold.textContent).toMatch(/実際には送りません/);
  });

  it("読み込めなければ、そう書く（空の画面を出さない）。やり直せる", async () => {
    stubFetch({ failSample: true });
    mount("/sample");
    expect(await screen.findByText(SAMPLE_TEXT.failed)).toBeTruthy();
    expect(screen.getByRole("button", { name: SAMPLE_TEXT.retry })).toBeTruthy();
    stubFetch();
    fireEvent.click(screen.getByRole("button", { name: SAMPLE_TEXT.retry }));
    await mapReady();
  });
});

describe("/sample/todo（対策項目）", () => {
  it("開いたとき（12月19日 津山市 疑い）は ①。3 つの分類が分かれ、解除の見込みは防疫措置の完了の前なので未定", async () => {
    mount("/sample/todo");
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    expect(text()).toContain("再現の時点: 12 月 19 日");
    await waitFor(() => expect(document.querySelectorAll(".class-block").length).toBe(3));
    const classes = [...document.querySelectorAll(".class-block")].map((e) => e.className);
    expect(classes.some((c) => c.includes("class-always"))).toBe(true);
    expect(classes.some((c) => c.includes("class-if_in_zone"))).toBe(true);
    expect(classes.some((c) => c.includes("class-good_to_check"))).toBe(true);
    await waitFor(() => expect(text()).toContain(ZONE));
    const lift = await screen.findByRole("region", { name: TODO_TEXT.liftHeading });
    expect(lift.textContent).toContain("津山市");
    await waitFor(() => expect(lift.textContent).toContain("未定です"));
  });

  it("声かけ文は雛形（Claude の下書きではない）で、津山市の名前が入っている", async () => {
    mount("/sample/todo");
    const box = (await screen.findByLabelText(WORKER_MESSAGE_TEXT.label)) as HTMLTextAreaElement;
    expect(box.value).toContain("津山市");
    expect(screen.getByText(WORKER_MESSAGE_TEXT.sourceTemplate)).toBeTruthy();
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.sourceClaude)).toBeNull();
  });

  it("記録へのリンク（自己点検、消毒の記録）を出さない。会員向けの経路と /sample/record へのリンクがない", async () => {
    mount("/sample/todo");
    await screen.findByRole("region", { name: TODO_TEXT.liftHeading });
    expect(screen.queryByRole("link", { name: TODO_TEXT.selfCheckLink })).toBeNull();
    expect(screen.queryByRole("link", { name: TODO_TEXT.disinfectionLink })).toBeNull();
    expectNoMemberLinks();
  });

  it("消毒の『やった』は押せて、記録は画面の中だけ（端末に保存しない）", async () => {
    mount("/sample/todo");
    await waitFor(() => expect(screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) }).length).toBeGreaterThan(0));
    const btn = screen.getAllByRole("button", { name: new RegExp(`^${TODO_TEXT.done}:`) })[0]!;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toBe(TODO_TEXT.doneSaved));
    expect(localStorage.length).toBe(0);
  });
});

describe("実際の経路表（routes.tsx）", () => {
  it("地図で 12月30日（防疫措置の完了）まで進めてからメニューの『対策項目』へ移ると、同じ時刻で解除の見込みが日付で出る。読み込みは 1 回だけ", async () => {
    const router = mountRoutes("/sample");
    await mapReady();
    fireEvent.click(item(/12 月 30 日.*津山市/));
    await waitFor(() => expect(document.querySelector(".replay-now")?.textContent).toMatch(/^12 月 30 日 津山市/));
    const nav = screen.getByRole("navigation", { name: "メニュー" });
    fireEvent.click(within(nav).getByRole("link", { name: "対策項目" }));
    await screen.findByRole("heading", { level: 1, name: TODO_TEXT.title });
    expect(router.state.location.pathname).toBe("/sample/todo");
    expect(text()).toContain("再現の時点: 12 月 30 日");
    const lift = await screen.findByRole("region", { name: TODO_TEXT.liftHeading });
    await waitFor(() => expect(lift.textContent).toContain("1月21日"));
    // メニューの「今季の発生」で地図へ戻っても、時刻はそのまま
    fireEvent.click(within(screen.getByRole("navigation", { name: "メニュー" })).getByRole("link", { name: "今季の発生" }));
    await mapReady();
    expect(router.state.location.pathname).toBe("/sample");
    expect(document.querySelector(".replay-now")?.textContent).toMatch(/^12 月 30 日 津山市/);
    expect(fetched.filter((u) => u.endsWith("sample-farm.json"))).toHaveLength(1);
    expect(fetched.filter((u) => u.endsWith("scenario.json"))).toHaveLength(1);
    expect(forbidden.firebase).not.toHaveBeenCalled();
  });

  it("上の帯は 1 本だけで『去年 12 月の再現です（近くで発生した場合の見え方）』。メニューは 1 本目と同じ並び・同じ名前で、見本だけの項目がない", async () => {
    mountRoutes("/sample");
    await mapReady();
    const band = document.querySelector(".app-context")!;
    expect(band.textContent).toContain(CONTEXT_BAND.sample.text);
    expect(document.querySelectorAll(".app-context, .replay-band, .sample-band")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "メニュー" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(labels).toEqual(["今季の発生", "過去の発生", "発生傾向", "分かっていること", "鶏を飼っていない方へ", "このサイトについて", "対策項目"]);
    expect(within(nav).getByRole("link", { name: "今季の発生" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "今季の発生" }).getAttribute("href")).toBe("/sample");
    expect(within(nav).getByRole("link", { name: "対策項目" }).getAttribute("href")).toBe("/sample/todo");
  });

  it.each(["/sample/record", "/sample/record/", "/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection"])(
    "%s は行き止まりにせず、/sample の地図へ送る",
    async (entry) => {
      const router = mountRoutes(entry);
      await mapReady();
      expect(router.state.location.pathname).toBe("/sample");
      expect(document.querySelector(".replay-now")?.textContent).toBe("12 月 19 日 津山市 疑い");
    },
  );
});

describe("見本の全体", () => {
  const pages = ["/sample", "/sample/todo"];

  it.each(pages)("%s: 時点があり、禁止語がなく、会員向けの経路へのリンクがない", async (entry) => {
    mount(entry);
    if (entry === "/sample") await mapReady();
    else await screen.findByRole("region", { name: TODO_TEXT.liftHeading });
    await new Promise((r) => setTimeout(r, 30)); // 読み込みの後の描き直しを待つ
    expect(text()).toContain("時点");
    expect(count(text(), SAMPLE_TEXT.farmNote)).toBe(1);
    expect(findForbiddenPhrases(text())).toEqual([]);
    expectNoMemberLinks();
  });

  it("会員の状態と Firebase を一度も読まない。通信は静的ファイルだけ。localStorage に書かない", async () => {
    for (const entry of pages) {
      mount(entry);
      await waitFor(() => expect(screen.getAllByText(SAMPLE_TEXT.farmNote).length).toBe(1));
      await new Promise((r) => setTimeout(r, 30));
      cleanup();
    }
    expect(forbidden.auth).not.toHaveBeenCalled();
    expect(forbidden.firebase).not.toHaveBeenCalled();
    expect(fetched.length).toBeGreaterThan(0);
    for (const u of fetched) expect(u).toMatch(/(replay\/scenario\.json|replay\/sample-farm\.json|history\/cases\.json)$/);
    expect(localStorage.length).toBe(0);
  });
});
