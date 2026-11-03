import { createGeoStore } from "@hpai/shared/geo";
import { eventStage, type ReplayScenario } from "@hpai/shared/replay";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
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

const scenario = scenarioJson as unknown as ReplayScenario;
const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";
const lastProps = () => seen[seen.length - 1]!;

function stubFetch(opts: { failScenario?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("replay/scenario.json")) {
        return Promise.resolve(opts.failScenario ? new Response("", { status: 404 }) : new Response(JSON.stringify(scenarioJson), { status: 200 }));
      }
      if (String(url).endsWith("history/cases.json")) return Promise.resolve(new Response(JSON.stringify(historyJson), { status: 200 }));
      return Promise.reject(new Error(`想定しない通信: ${String(url)}`));
    }),
  );
  return calls;
}

async function show(opts: { failScenario?: boolean } = {}) {
  const calls = stubFetch(opts);
  render(
    <MemoryRouter>
      <ReplayPage />
    </MemoryRouter>,
  );
  return calls;
}

/** 出来事の一覧のボタン（『12 月 19 日 津山市 疑い』の形） */
const item = (re: RegExp) => within(screen.getByRole("list", { name: "日付の一覧" })).getByRole("button", { name: re });

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
    await screen.findByTestId("map");
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

  it("読み込めなければ、そう書く（空の地図を出さない）", async () => {
    await show({ failScenario: true });
    expect(await screen.findByText(/再現のデータを読めませんでした/)).toBeTruthy();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("切り替えは『もし区域の近くの農場なら』（既定）と『自分の町で見る』。端末に地点がなければ後者を押せない", async () => {
    await show();
    await screen.findByTestId("map");
    const near = screen.getByRole("button", { name: "もし区域の近くの農場なら" });
    const own = screen.getByRole("button", { name: "自分の町で見る" });
    expect(near.getAttribute("aria-pressed")).toBe("true");
    expect((own as HTMLButtonElement).disabled).toBe(true);
  });

  it("12/19 に進めると、疑いが地図に出て、区域に入っている可能性（①）と『このときメールが届く』が出る。実際には送らないと書く", async () => {
    await show();
    await screen.findByTestId("map");
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
    await screen.findByTestId("map");
    fireEvent.click(item(/12 月 2 日.*米子市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("31202"));
    expect(screen.queryByRole("region", { name: "このときメールが届く" })).toBeNull();
    expect(document.body.textContent).toMatch(/メールは届きません/);
  });

  it("1/21（津山の移動制限の解除）で、区域の文が消える。前へ・次へで 1 つずつ動ける", async () => {
    await show();
    await screen.findByTestId("map");
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
    await screen.findByTestId("map");
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
    await screen.findByTestId("map");
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
    await screen.findByTestId("map");
    fireEvent.click(item(/12 月 20 日.*津山市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("33203"));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(screen.queryByRole("button", { name: "地図で場所を合わせる" })).toBeNull();
  });

  it("通信は 再現のデータと過去の記録 だけ。Firestore や Claude には出ない", async () => {
    const calls = await show();
    await screen.findByTestId("map");
    fireEvent.click(item(/12 月 20 日.*津山市.*確定/));
    await waitFor(() => expect(lastProps().view.confirmedMuniCodes).toContain("33203"));
    for (const u of calls) expect(u).toMatch(/replay\/scenario\.json$|history\/cases\.json$/);
  });
});
