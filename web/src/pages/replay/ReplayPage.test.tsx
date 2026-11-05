import { createGeoStore } from "@hpai/shared/geo";
import { eventStage, type ReplayScenario } from "@hpai/shared/replay";
import { findForbiddenPhrases, findWordingViolations, FIXED_TEXT } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import historyJson from "../../../../data/history/cases.json";
import scenarioJson from "../../../../data/replay/scenario.json";
import { SPOT_KEY, TOWN_KEY } from "../../data/spot";
import type { MapViewProps } from "../map/MapView";

// 市町村の形の読み込みは fetch を使うので、jsdom では実データを fs から読む偽に替える
vi.mock("../../geo/loadGeo", () => {
  const store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) =>
      JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  return { loadWebGeoStore: () => Promise.resolve(store), loadJapanTopo: () => Promise.reject(new Error("unused")), loadPrefAnchors: () => Promise.reject(new Error("unused")) };
});

// MapView は maplibre（WebGL）を使うので差し替える。渡された props を控える
const seen: MapViewProps[] = [];
vi.mock("../map/MapView", () => ({
  default: (props: MapViewProps) => {
    seen.push(props);
    return <div data-testid="map" />;
  },
}));

import ReplayPage from "./ReplayPage";
import { eventLabel } from "./replayEngine";

const scenario = scenarioJson as unknown as ReplayScenario;
const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";
const lastProps = () => seen[seen.length - 1]!;

function stubFetch(opts: { failScenario?: boolean; failHistory?: () => boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("replay/scenario.json")) {
        return Promise.resolve(opts.failScenario ? new Response("", { status: 404 }) : new Response(JSON.stringify(scenarioJson), { status: 200 }));
      }
      if (String(url).endsWith("history/cases.json")) {
        return Promise.resolve(opts.failHistory?.() ? new Response("", { status: 500 }) : new Response(JSON.stringify(historyJson), { status: 200 }));
      }
      return Promise.reject(new Error(`想定しない通信: ${String(url)}`));
    }),
  );
  return calls;
}

async function show(opts: { failScenario?: boolean; failHistory?: () => boolean } = {}) {
  const calls = stubFetch(opts);
  render(
    <MemoryRouter>
      <ReplayPage />
    </MemoryRouter>,
  );
  return calls;
}

/**
 * 地図が出たうえで、画面の購読（passive effect）まで終わるのを待つ。
 * 地図の DOM が出た時点では effect がまだ走っていないことがあり、そのとき
 *   - 見回りの結果が未着で、時点の欄は「確認できていません」のまま（.watch-line は未着でも DOM にあるので、目印にならない）
 *   - 順番の購読（useSyncExternalStore）がなく、次へを押しても 1 行がすぐには変わらない
 * になる。見回りの結果は MapPage の effect が購読して届くので、これが届けば同じ commit の effect はすべて走っている。
 */
async function mapReady() {
  await screen.findByTestId("map");
  await waitFor(() => expect(screen.getByTestId("watch-line").textContent).toMatch(/47 都道府県/));
}

/** 出来事の一覧のボタン（『12 月 19 日 津山市 疑い』の形） */
const item = (re: RegExp) => {
  // 日付の一覧は畳んである（ui/Fold）。閉じていたら開いてから探す
  const fold = screen.getByRole("list", { name: "日付の一覧", hidden: true }).closest("details");
  if (fold) fold.open = true;
  return within(screen.getByRole("list", { name: "日付の一覧" })).getByRole("button", { name: re });
};

beforeEach(() => {
  seen.length = 0;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReplayPage", () => {
  it("最初は order 0。『去年の再現です』『仮の地点』『時点』と、4 事例だけ・見回りは例・メールは送らない、の説明がある", async () => {
    await show();
    await mapReady();
    expect(screen.getAllByText(FIXED_TEXT.replayBanner).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("仮の地点");
    expect(document.body.textContent).toContain("時点");
    expect(document.body.textContent).toMatch(/4 事例だけ/);
    expect(document.body.textContent).toMatch(/説明のための例/);
    expect(document.body.textContent).toMatch(/実際には送りません/);
    expect(screen.getByRole("button", { name: /はじまり/ }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "前へ" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("このときメールが届く")).toBeNull();
    expect(document.body.textContent).not.toContain(ZONE);
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("見出しは『去年の再現』。地図の『今季』の見出しは隠す（replay.css）。再現の見出しは隠さない", async () => {
    await show();
    await mapReady();
    const h1s = [...document.querySelectorAll("h1")];
    expect(h1s.filter((h) => !h.closest(".map-page")).map((h) => h.textContent)).toEqual(["去年の再現（2025 年シーズンの発生状況）"]);
    expect(document.querySelector(".replay-scope .map-page > h1")?.textContent).toContain("今季");
    // jsdom は CSS を当てないので、隠す規則の存在を確かめる
    const css = readFileSync(path.resolve(import.meta.dirname, "replay.css"), "utf8");
    expect(css).toMatch(/\.replay-scope \.map-page > h1\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/\.as-of/); // 時刻は隠さず、描かない
  });

  it("時刻の記載がない時点では、画面のどこにも時刻（23:59 など）の文字がない。日付だけ。はじまる前は何も描かない", async () => {
    await show();
    await mapReady();
    const asOfs = () => [...document.querySelectorAll(".as-of")].map((e) => e.textContent);
    const noFakeTime = () => expect(document.body.textContent).not.toMatch(/23:59|23時59|\d{1,2}:\d{2} 時点/);
    // はじまる前（order 0）
    noFakeTime();
    expect(asOfs()).toEqual([]);
    // 時刻の記載がない出来事（すべて）
    for (const e of scenario.events.filter((x) => x.time === null)) {
      fireEvent.click(item(new RegExp(`${Number(e.date.slice(5, 7))} 月 ${Number(e.date.slice(8))} 日.*${e.caseAfter.muniName}`)));
      await waitFor(() => expect(lastProps().view.total).toBeGreaterThan(0));
      noFakeTime();
      expect(asOfs()).toEqual([`${Number(e.date.slice(5, 7))} 月 ${Number(e.date.slice(8))} 日 時点`]);
    }
    // 時刻のある出来事は、その時刻を出す（津山の確定は 9:00）
    fireEvent.click(item(/12 月 20 日.*津山市.*確定/));
    await waitFor(() => expect(asOfs()).toEqual(["12 月 20 日 9:00 時点"]));
    expect((document.querySelector(".replay-scope") as HTMLElement).dataset.timeKnown).toBe("true");
  });

  it("読み込めなければ、そう書く（空の地図を出さない）", async () => {
    await show({ failScenario: true });
    expect(await screen.findByText(/再現のデータを読めませんでした/)).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("切り替えは『もし区域の近くの農場なら』（既定）と『自分の町で見る』。端末に地点がなければ後者を押せない", async () => {
    await show();
    await mapReady();
    const near = screen.getByRole("button", { name: "もし区域の近くの農場なら" });
    const own = screen.getByRole("button", { name: "自分の町で見る" });
    expect(near.getAttribute("aria-pressed")).toBe("true");
    expect((own as HTMLButtonElement).disabled).toBe(true);
  });

  it("12/19 に進めると、疑いが地図に出て、区域に入っている可能性（①）と『このときメールが届く』が出る。実際には送らないと書く", async () => {
    await show();
    await mapReady();
    fireEvent.click(item(/12 月 19 日.*津山市.*疑い/));
    expect(await screen.findByText(ZONE)).toBeTruthy();
    const mail = screen.getByRole("region", { name: "このときメールが届く" });
    expect(within(mail).getByText("津山市で疑いの発表がありました。県の連絡が正です")).toBeTruthy();
    expect(mail.textContent).toMatch(/実際には送りません/);
    expect(document.body.textContent).toMatch(/時刻の記載なし/);
    await waitFor(() => expect(lastProps().view.suspectedMuniCodes).toContain("33203"));
    expect(screen.getByRole("button", { name: /12 月 19 日.*津山市.*疑い/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("関係しない出来事（米子の確定）では、地図には出るが、この地点にメールは届かない", async () => {
    await show();
    await mapReady();
    fireEvent.click(item(/12 月 2 日.*米子市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("31202"));
    expect(screen.queryByRole("region", { name: "このときメールが届く" })).toBeNull();
    expect(document.body.textContent).toMatch(/メールは届きません/);
  });

  it("1/21（津山の移動制限の解除）で、区域の文が消える。前へ・次へで 1 つずつ動ける", async () => {
    await show();
    await mapReady();
    fireEvent.click(item(/1 月 21 日.*津山市.*移動制限の解除/));
    await waitFor(() => expect(screen.queryByText(ZONE)).toBeNull());
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    const lift = scenario.events.find((e) => e.caseAfter.muniCode === "33203" && eventStage(e) === "movement_lifted")!;
    expect((screen.getByRole("button", { name: "前へ" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "前へ" }));
    expect(screen.getByText(`${lift.order - 1} / ${scenario.events.length}`)).toBeTruthy();
  });

  it("次へで最後まで進め、最後は次へを押せない。はじまりに戻れる", async () => {
    await show();
    await mapReady();
    const next = screen.getByRole("button", { name: "次へ" });
    for (let i = 0; i < scenario.events.length; i++) fireEvent.click(next);
    await waitFor(() => expect(lastProps().view.total).toBe(4));
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /はじまり/ }));
    await waitFor(() => expect(lastProps().view.total).toBe(0));
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("端末に地点があれば『自分の町で見る』に切り替えられる。切り替えても hpai.spot.v1 と hpai.town.v1 は 1 バイトも変わらない", async () => {
    const mine = JSON.stringify({ meshCode: "53331228", muniCode: "31202", frequentMuniCodes: [] });
    localStorage.setItem(SPOT_KEY, mine);
    localStorage.setItem(TOWN_KEY, "31202");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    await show();
    await mapReady();
    const own = screen.getByRole("button", { name: "自分の町で見る" });
    expect((own as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(own);
    await waitFor(() => expect(lastProps().myMuniCode).toBe("31202"));
    expect(document.body.textContent).not.toContain("仮の地点");
    fireEvent.click(item(/12 月 2 日.*米子市.*確定/));
    expect(await screen.findByText(ZONE)).toBeTruthy();
    // この地点のメールの下書きは、自分の町では出さない（再現の下書きは仮の地点のもの）
    expect(screen.queryByRole("region", { name: "このときメールが届く" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "もし区域の近くの農場なら" }));
    await waitFor(() => expect(lastProps().myMuniCode).toBe("33622"));
    expect(localStorage.getItem(SPOT_KEY)).toBe(mine);
    expect(localStorage.getItem(TOWN_KEY)).toBe("31202");
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("仮の地点で再現を最後まで見ても、端末に何も書かない。町を選ぶ画面も出さない（場所は変えられない）", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await show();
    await mapReady();
    fireEvent.click(item(/12 月 20 日.*津山市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("33203"));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(screen.queryByRole("button", { name: "地図で場所を合わせる" })).toBeNull();
  });

  it("次へで今の出来事の 1 行（replay-now）が eventLabel の文で出て、aria-live=polite はそこにある。位置の文 N / 14 は残り、aria-live は外れる", async () => {
    await show();
    await mapReady();
    const now = () => document.querySelector(".replay-now") as HTMLElement;
    expect(now().textContent).toBe("はじまり（最初の発表の前）");
    expect(now().getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(now().textContent).toBe(eventLabel(scenario.events[0]!));
    expect(now().getAttribute("aria-live")).toBe("polite");
    const pos = screen.getByText(`1 / ${scenario.events.length}`);
    expect(pos.getAttribute("aria-live")).toBeNull();
  });

  it("メールの枠は日付の一覧より前にある。日付の一覧は『日付の一覧から選ぶ』の畳みの中", async () => {
    await show();
    await mapReady();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(item(/12 月 19 日.*津山市.*疑い/));
    const mail = await screen.findByRole("region", { name: "このときメールが届く" });
    const list = screen.getByRole("list", { name: "日付の一覧" });
    expect(mail.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const fold = list.closest("details")!;
    expect(fold.querySelector("summary")?.textContent).toBe("日付の一覧から選ぶ");
  });

  it("押せない案内の『地図』は / へのリンク。見本の農場で試すは /sample へのリンク", async () => {
    await show();
    await mapReady();
    expect(screen.getByRole("link", { name: "地図" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "見本の農場で試す" }).getAttribute("href")).toBe("/sample");
    expect(document.body.textContent).toContain("自分の町で見るには、地図で自分の場所を決めてください（この端末の中にだけ保存されます）。");
  });

  it("再現の帯の箇条書き（replay-notes）は畳まない（details の中にない）", async () => {
    await show();
    await mapReady();
    const notes = document.querySelector(".replay-notes")!;
    expect(notes).toBeTruthy();
    expect(notes.closest("details")).toBeNull();
  });

  it("通信は 再現のデータと過去の記録 だけ。Firestore や Claude には出ない", async () => {
    const calls = await show();
    await screen.findByTestId("map");
    fireEvent.click(item(/12 月 20 日.*津山市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("33203"));
    for (const u of calls) expect(u).toMatch(/replay\/scenario\.json$|history\/cases\.json$/);
  });
});

describe("ReplayPage: 距離の輪", () => {
  it("見本の仮の地点のマス目を地図に渡し、輪の断りを出す。札は今と同じく出さない", async () => {
    await show();
    await mapReady();
    expect(lastProps().farmMeshCode).toBe(scenario.defaultSpot.meshCode);
    expect(screen.getByText("輪は距離の目安で、発表の区域ではありません。")).toBeTruthy();
    expect(document.querySelector(".stat-row")).toBeNull();
  });
});

describe("ReplayPage: 全国の流れ", () => {
  const NATIONAL = "全国の流れ";
  const CASES = "12 月の 4 事例";
  const TOTAL = 24;
  const band = () => document.querySelector(".replay-band")!.textContent ?? "";
  const nowLine = () => document.querySelector(".replay-now")!.textContent ?? "";
  const card = (title: string) =>
    [...document.querySelectorAll(".stat")].find((c) => c.querySelector(".stat-title")?.textContent?.startsWith(title))?.textContent ?? null;
  const flowButton = (name: string) => screen.getByRole("button", { name });

  async function openNational() {
    await show();
    await mapReady();
    fireEvent.click(flowButton(NATIONAL));
    await screen.findByText(`0 / ${TOTAL}`);
    await mapReady();
    await waitFor(() => expect(lastProps().view.total).toBe(0));
  }

  it("既定は 4 事例で、札を出さない。全国の流れを押すまで切り替わらない", async () => {
    await show();
    await mapReady();
    expect(flowButton(CASES).getAttribute("aria-pressed")).toBe("true");
    expect(flowButton(NATIONAL).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(`0 / ${scenario.events.length}`)).toBeTruthy();
    expect(document.querySelector(".stat-row")).toBeNull();
  });

  it("切り替えると 4 事例の注記が外れ、帯と仮の地点と時点は残る。解除が入っていないことを書く", async () => {
    await openNational();
    expect(flowButton(NATIONAL).getAttribute("aria-pressed")).toBe("true");
    expect(band()).not.toMatch(/4 事例だけ/);
    expect(band()).toContain(FIXED_TEXT.replayBanner);
    expect(band()).toContain("仮の地点で見ています");
    expect(band()).toContain("再現の時点: はじまる前");
    expect(band()).toMatch(/説明のための例/);
    expect(band()).toContain(`${TOTAL} 件`);
    expect(band()).toMatch(/関連農場/);
    expect(band()).toMatch(/移動制限の解除の日は入っていません/);
    expect(band()).not.toMatch(/このときメールが届く/);
    expect(band()).toMatch(/実際には送りません/);
    expect(lastProps().farmMeshCode).toBe(scenario.defaultSpot.meshCode);
  });

  it("地図は輪が見える広さで始まる（全国の広さでは輪と町の塗りが見えない）。4 事例は全国の広さのまま", async () => {
    await show();
    await mapReady();
    expect(lastProps().focus).toBeNull();
    fireEvent.click(flowButton(NATIONAL));
    await screen.findByText(`0 / ${TOTAL}`);
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
    expect(lastProps().focus?.codes).toEqual([scenario.defaultSpot.muniCode]);
    fireEvent.click(flowButton(CASES));
    await waitFor(() => expect(lastProps().focus).toBeNull());
  });

  it("はじまりでは 0 件の札の前に riskAnywhere を置く。作っていない野鳥の札（0 件）と、空の時刻の札は出さない", async () => {
    await openNational();
    const stats = await waitFor(() => {
      const el = document.querySelector(".stat-row");
      expect(el).toBeTruthy();
      return el!;
    });
    const risk = screen.getAllByText(FIXED_TEXT.riskAnywhere).at(-1)!;
    expect(risk.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card("野鳥")).toBeNull();
    expect(card("時刻")).toBeNull();
    expect(document.querySelectorAll(".as-of")).toHaveLength(0);
  });

  it("進めると件数の札が増え、札の時点は再現の時計に従う。60km の外の発生には距離を書かない", async () => {
    await openNational();
    fireEvent.click(item(/12 月 2 日.*米子市/)); // 仮の地点から約 72km で、輪の外
    await waitFor(() => expect(card("発生した件数")).toContain("では 6 件"));
    await waitFor(() => expect(card("農場から約 60 km 以内")).toContain("今季 確認できた範囲では 0 件"));
    expect(card("直近 14 日の件数")).toContain("では 2 件"); // 日向市（11/22）と米子市
    expect(card("時刻")).toContain("12 月 2 日 時点");
    expect(nowLine()).toBe("12 月 2 日 米子市 確定");

    fireEvent.click(item(/12 月 16 日.*姫路市/)); // 約 40km で、輪の中
    await waitFor(() => expect(card("農場から約 60 km 以内")).toContain("今季 確認できた範囲では 1 件"));
    expect(card("発生した件数")).toContain("では 7 件");
    expect(card("直近 14 日の件数")).toContain("では 1 件"); // 米子市（12/2）は 14 日の外
    expect(card("時刻")).toContain("12 月 16 日 時点");
    await waitFor(() => expect(nowLine()).toBe("12 月 16 日 姫路市 確定。農場（仮の地点）から約 40 km"));
    expect(await screen.findByText("約 40 km 先で発生しました")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/23:59/);
  });

  it("半径が空の事例でも、10km 以内は ① になる。距離は帯の文と同じ丸め方で出す", async () => {
    await openNational();
    fireEvent.click(item(/12 月 20 日.*津山市/));
    expect(await screen.findByText(ZONE)).toBeTruthy();
    await waitFor(() => expect(nowLine()).toBe("12 月 20 日 津山市 確定。農場（仮の地点）から約 2 km"));
    await waitFor(() => expect(card("農場から約 60 km 以内")).toContain("今季 確認できた範囲では 2 件"));
  });

  it("メールの下書きも『届きません』の文も出さず、全国の流れの文を出す", async () => {
    await openNational();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    await screen.findByText(`1 / ${TOTAL}`);
    expect(screen.queryByRole("region", { name: "このときメールが届く" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/メールは届きません/);
    expect(screen.getByText("全国の流れでは、メールの下書きは出しません。")).toBeTruthy();
  });

  it("全ての出来事を進めても、禁句がなく、時点が出て、最後は 24 件になる", async () => {
    await openNational();
    const next = screen.getByRole("button", { name: "次へ" });
    for (let i = 1; i <= TOTAL; i++) {
      fireEvent.click(next);
      await screen.findByText(`${i} / ${TOTAL}`);
      await waitFor(() => expect(lastProps().view.total).toBe(i));
      expect(findWordingViolations(document.body.textContent ?? "")).toEqual([]);
      expect(card("時刻")).toMatch(/\d+ 月 \d+ 日 時点/);
      expect(document.body.textContent).not.toMatch(/23:59/);
    }
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(card("発生した件数")).toContain(`では ${TOTAL} 件`);
  });

  it("4 事例へ戻すと札と注記が戻り、4 事例の位置はそのまま", async () => {
    await show();
    await mapReady();
    fireEvent.click(item(/12 月 19 日.*津山市.*疑い/));
    fireEvent.click(flowButton(NATIONAL));
    await screen.findByText(`0 / ${TOTAL}`);
    fireEvent.click(flowButton(CASES));
    const pos = scenario.events.find((e) => e.date === "2025-12-19")!.order;
    await screen.findByText(`${pos} / ${scenario.events.length}`);
    expect(band()).toMatch(/4 事例だけ/);
    await waitFor(() => expect(lastProps().view.suspectedMuniCodes).toContain("33203"));
    expect(document.querySelector(".stat-row")).toBeNull();
  });

  it("過去の記録を読めなければ 4 事例のままそう書き、もう一度押すと読める", async () => {
    let fail = true;
    await show({ failHistory: () => fail });
    await screen.findByTestId("map");
    fireEvent.click(flowButton(NATIONAL));
    expect(await screen.findByText("全国の流れを読めませんでした。もう一度押してください。")).toBeTruthy();
    expect(flowButton(CASES).getAttribute("aria-pressed")).toBe("true");
    expect(band()).toMatch(/4 事例だけ/);
    fail = false;
    fireEvent.click(flowButton(NATIONAL));
    await screen.findByText(`0 / ${TOTAL}`);
    expect(screen.queryByText("全国の流れを読めませんでした。もう一度押してください。")).toBeNull();
  });

  it("端末の地点で見ると、距離は仮の地点と言わない。端末には書かない", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: scenario.defaultSpot.meshCode, muniCode: "33202", frequentMuniCodes: [] }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await openNational();
    fireEvent.click(screen.getByRole("button", { name: "自分の町で見る" }));
    fireEvent.click(item(/12 月 16 日.*姫路市/));
    await waitFor(() => expect(nowLine()).toBe("12 月 16 日 姫路市 確定。この端末の地点から約 40 km"));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("通信は 再現のデータと過去の記録 だけ", async () => {
    await show();
    await mapReady();
    fireEvent.click(flowButton(NATIONAL));
    await screen.findByText(`0 / ${TOTAL}`);
    fireEvent.click(item(/12 月 16 日.*姫路市/));
    await waitFor(() => expect(nowLine()).toContain("約 40 km"));
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    for (const u of calls) expect(u).toMatch(/replay\/scenario\.json$|history\/cases\.json$/);
  });
});
