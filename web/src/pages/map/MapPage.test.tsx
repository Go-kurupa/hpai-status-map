import type { Case, HistoryCase, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createGeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { PREFS } from "@hpai/shared/pref";
import historyJson from "../../../../data/history/cases.json";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SPOT_KEY, TOWN_KEY } from "../../data/spot";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource, RecordStore } from "../../data/types";
import type { MapViewProps } from "./MapView";
import { TEXT } from "./texts";

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

// MapView は maplibre（WebGL）を使うので、jsdom では差し替える。渡された props を控える
const seen: MapViewProps[] = [];
let mapThrows = false;
vi.mock("./MapView", () => ({
  default: (props: MapViewProps) => {
    if (mapThrows) throw new Error("chunk failed");
    seen.push(props);
    return <div data-testid="map" />;
  },
}));

import MapPage from "./MapPage";

const history = historyJson as HistoryCase[];
const NOW = new Date("2026-11-04T09:00:00+09:00"); // 今季は 2026

interface Rig {
  ds: DataSource;
  deliverCases(rows: Case[]): void;
  deliverWatch(rows: WatchStatus[]): void;
  historyDeferred: { resolve(h: HistoryCase[]): void; reject(e: Error): void };
}

function rig(opts: { history?: "now" | "deferred" } = {}): Rig {
  let casesCb: ((c: Case[]) => void) | null = null;
  let watchCb: ((w: WatchStatus[]) => void) | null = null;
  const hd = { resolve: (_h: HistoryCase[]) => {}, reject: (_e: Error) => {} };
  const ds: DataSource = {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => {
      casesCb = cb;
      return () => {};
    },
    subscribeWildBirds: (_s: Season, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWatchStatus: (cb) => {
      watchCb = cb;
      return () => {};
    },
    loadHistory: () =>
      opts.history === "deferred"
        ? new Promise<HistoryCase[]>((res, rej) => {
            hd.resolve = res;
            hd.reject = rej;
          })
        : Promise.resolve(history),
  };
  return {
    ds,
    deliverCases: (rows) => act(() => casesCb!(rows)),
    deliverWatch: (rows) => act(() => watchCb!(rows)),
    historyDeferred: hd,
  };
}

function show(r: Rig, o: { store?: RecordStore } = {}) {
  const page = (
    <SpotProvider>
      <MapPage />
    </SpotProvider>
  );
  return render(
    <MemoryRouter>
      <DataSourceProvider value={r.ds}>{o.store ? <RecordStoreProvider value={o.store}>{page}</RecordStoreProvider> : page}</DataSourceProvider>
    </MemoryRouter>,
  );
}

const okWatch = (): WatchStatus[] =>
  PREFS.map((p) => ({
    prefCode: p.code,
    checkedAt: "2026-11-04T08:30:00+09:00",
    ok: true,
    lastOkAt: "2026-11-04T08:30:00+09:00",
    failingSince: null,
  }));

const lastProps = () => seen[seen.length - 1]!;

beforeEach(() => {
  mapThrows = false;
  seen.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("MapPage", () => {
  it("今季の事例がまだ届かないうちは『0 件』と書かず、riskAnywhere も出さない。県はすべて確認できていない扱い", async () => {
    show(rig());
    await screen.findByTestId("map");
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    // 過去のシーズンとの比べの表には、過去の実績としての「0 件」（その時期までに発生がなかったシーズン）が出る。ほかの所を見る
    const outsideCompare = [...document.querySelectorAll(".map-page > *")].filter((e) => !e.matches(".season-compare")).map((e) => e.textContent).join("");
    expect(outsideCompare).not.toMatch(/(^|[^0-9])0 件/);
    expect(document.body.textContent).toContain("まだ読めていません");
    expect(lastProps().view.loaded).toBe(false);
    expect(lastProps().failedPrefCodes).toHaveLength(47);
  });

  it("見回りの結果が未着（47 県とも未確認）の間は、今季の棒に件数を見出しとして出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const btn = screen.getByRole("button", { name: /今季/ });
    expect(btn.textContent).toContain("まだ確認できていません");
    expect(btn.textContent).not.toContain("0 件");
  });

  it("今季 0 件で町が未選択なら、riskAnywhere は「0 件」の札のすぐ前にある", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const risk = await screen.findByText(FIXED_TEXT.riskAnywhere);
    expect(risk.nextElementSibling?.className).toBe("stat-row");
    expect(risk.nextElementSibling?.textContent).toContain("0 件");
  });

  it("今季 0 件が届いたら riskAnywhere を出す。禁句はない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(await screen.findByText(FIXED_TEXT.riskAnywhere)).toBeTruthy();
    expect(lastProps().failedPrefCodes).toEqual([]);
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
    expect(screen.queryByText(FIXED_TEXT.pastDisclaimer)).toBeNull();
  });

  it("見回りに失敗した県があるときは県名を書き、0 件でも『発生なし』に見せない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch().map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w)));
    expect(lastProps().failedPrefCodes).toEqual(["33"]);
    expect(screen.getByTestId("watch-line").textContent).toContain("47 都道府県のうち 46 件を確認、1 件は確認できていません（岡山県）");
    expect(document.body.textContent).not.toMatch(/発生なし/);
    // いちばん目立つ今季の件数は「確認できた範囲では 0 件（1 県は確認できていません）」
    expect(screen.getByRole("button", { name: /今季/ }).textContent).toContain("確認できた範囲では 0 件（1 県は確認できていません）");
  });

  it("見回りの結果が全県確認できているときは注記を付けない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(screen.getByRole("button", { name: /今季/ }).textContent).toMatch(/^今季2026〜2027 年0 件$/);
  });

  it("過去のシーズンを選んでも、野鳥の配列は同じ参照のまま（地図の source を替えない）", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const before = lastProps().wildBirds;
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(lastProps().view.isCurrent).toBe(false);
    expect(lastProps().wildBirds).toBe(before);
  });

  it("昨季を押すと『24 件』、pastDisclaimer が出て、riskAnywhere は出ない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const bar = await screen.findByRole("button", { name: /昨季.*24 件/ });
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(FIXED_TEXT.pastDisclaimer)).toBeTruthy();
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(lastProps().view.total).toBe(24);
    expect(lastProps().view.confirmedMuniCodes).toContain("33203");
    expect(lastProps().failedPrefCodes).toEqual([]);
  });

  it("過去のシーズンでも『時点』を出す（国の事例一覧の確認日）", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(screen.getByText("時点: 過去の記録（国の事例一覧、確認日 2026-11-02）")).toBeTruthy();
    expect(screen.getByText(/2025年6月〜2026年5月の記録/)).toBeTruthy();
  });

  it("過去の記録が届かないうちの昨季は『まだ読めていません』で、0 件にしない", async () => {
    const r = rig({ history: "deferred" });
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const bar = screen.getByRole("button", { name: /昨季/ });
    expect(bar.textContent).toContain("まだ読めていません");
    fireEvent.click(bar);
    expect(lastProps().view.loaded).toBe(false);
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
  });

  it("地図の下に固定のリンクが 8 つある", async () => {
    show(rig());
    await screen.findByTestId("map");
    const nav = screen.getByRole("navigation", { name: "ほかのページ" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/public", "/known", "/trends", "/replay", "/sample", "/poster", "/results", "/privacy"]);
  });
});

// ── W-03: 自分の町の 1 文 ──
const tsuyamaCase = (o: Partial<Case> = {}): Case => ({
  id: "c1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: null,
  housing: null,
  headCount: 1000,
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
  ...o,
});
const tones = () => [...document.querySelectorAll("[data-tone]")].map((e) => e.getAttribute("data-tone"));

describe("MapPage: 自分の町の 1 文", () => {
  it("町を選んでいなければ、町を選ぶ案内を出す。地図に自分の町の縁はない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    expect(screen.getByText(TEXT.pickPrompt)).toBeTruthy();
    expect(lastProps().myMuniCode).toBeNull();
    expect(lastProps().nearMuniCodes).toEqual([]);
  });

  it("端末に町があり、今季の事例がまだ届かないうちは『読み込んでいます』で、段階の文も色もない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    show(rig());
    await screen.findByTestId("map");
    expect(screen.getByText(/読み込んでいます。読めるまで/)).toBeTruthy();
    expect(tones()).toEqual([]);
    expect(screen.queryByText("全国の動きをお知らせしています")).toBeNull();
  });

  it("真庭市（33214）の隣の津山市の事例で『隣町で発生しました』。過去は『昨季に隣町で発生しました（記録）』。縁は 33214 と 33203", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(await screen.findByText(/昨季に隣町で発生しました（記録）/)).toBeTruthy();
    expect(tones()).toEqual(["lv2"]);
    expect(lastProps().myMuniCode).toBe("33214");
    expect(lastProps().nearMuniCodes).toEqual(["33203"]);
    expect(screen.getByRole("link", { name: /この町のくわしい状況/ }).getAttribute("href")).toBe("/area/33214");
  });

  it("シーズンを変えても、自分の町の色は今季の段階のまま（過去の棒を押しても lv2）", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    await screen.findByText("隣町で発生しました");
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(lastProps().view.isCurrent).toBe(false);
    expect(tones()).toEqual(["lv2"]);
    expect(screen.getByText("隣町で発生しました")).toBeTruthy();
    // ページが pastDisclaimer を出しているので、町の過去の行では重ねない
    expect(screen.getAllByText(FIXED_TEXT.pastDisclaimer)).toHaveLength(1);
  });

  it("今季 0 件なら『全国の動きをお知らせしています』。riskAnywhere は画面に 1 つだけ", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(await screen.findByText("全国の動きをお知らせしています")).toBeTruthy();
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
  });

  it("端末に地点があれば距離まで見る。津山市の中の地点と津山市の事例で『区域に入っている可能性があります』", async () => {
    const c = (indexJson as unknown as Record<string, { center: [number, number] }>)["33203"]!.center;
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(c[1], c[0]), muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    expect(await screen.findByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeTruthy();
    expect(tones()).toEqual(["lv1"]);
    expect(lastProps().myMuniCode).toBe("33203");
  });

  it("県と市町村を選んで『この町にする』と、端末に町だけを保存し、1 文が出る", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    fireEvent.click(screen.getByRole("button", { name: "町を選ぶ" }));
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "33" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "33214" } });
    fireEvent.click(screen.getByRole("button", { name: "この町にする" }));
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(localStorage.getItem(TOWN_KEY)).toBe("33214");
    expect(localStorage.getItem(SPOT_KEY)).toBeNull();
    expect(lastProps().focus?.kind).toBe("muni");
    expect(lastProps().focus?.codes).toEqual(["33214"]);
  });

  it("地図の町のタップで選べるのは、選ぶ画面を開いているあいだだけ", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    expect(lastProps().onSelectMuni).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "町を選ぶ" }));
    expect(lastProps().pickMode).toBe(true);
    expect(lastProps().onSelectMuni).toBeTypeOf("function");
    act(() => lastProps().onSelectMuni!("33214"));
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(localStorage.getItem(TOWN_KEY)).toBe("33214");
    expect(lastProps().onSelectMuni).toBeUndefined();
    expect(lastProps().pickMode).toBeFalsy();
  });

  it("別の町を選ぶと、前のくわしい場所を消して、そう伝える", async () => {
    const c = (indexJson as unknown as Record<string, { center: [number, number] }>)["33203"]!.center;
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(c[1], c[0]), muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    fireEvent.click(await screen.findByRole("button", { name: "町を変える" }));
    act(() => lastProps().onSelectMuni!("33214"));
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(localStorage.getItem(SPOT_KEY)).toBeNull();
    expect(screen.getByText(/くわしい場所は消しました/)).toBeTruthy();
  });

  it("地図の画面が地点を使うと getFarm を 1 度だけ呼ぶ。会員の農場があれば端末内より先", async () => {
    const getFarm = vi.fn(() =>
      Promise.resolve({ id: "f1", meshCode: latLngToMesh3(35.1, 134.0), muniCode: "33203", prefCode: "33", frequentMuniCodes: [] }),
    );
    const store = { mode: "firestore", getFarm } as unknown as RecordStore;
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r, { store });
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    await waitFor(() => expect(lastProps().myMuniCode).toBe("33203"));
    expect(getFarm).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/登録した農場の場所で見ています/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "地図で場所を合わせる" })).toBeNull();
  });

  it("画面の全文に、禁じた語がない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    r.deliverWatch(okWatch());
    await screen.findByText("隣町で発生しました");
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("MapPage: 町の選択の並び（T09）", () => {
  const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  const childNames = (es: Element[]) => es.map((e) => e.tagName.toLowerCase() + (e.className ? "." + e.className : ""));

  it("町を選んでいないとき、地図より上は 見出し、時点、確認の行、守る文、数字、町を選ぶ案内の順。切り替えは出さず、全国で始める", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await screen.findByText(FIXED_TEXT.riskAnywhere);
    const page = document.querySelector(".map-page")!;
    const box = document.querySelector(".map-box")!;
    const above = [...page.children].filter((e) => before(e, box));
    expect(childNames(above)).toEqual(["h1", "p.as-of", "p.state-ok watch-line", "p.map-notice map-risk", "div.stat-row", "section.town-banner"]);
    const banner = document.querySelector(".town-banner")!;
    expect(banner.querySelector(".town-prompt-text")!.textContent).toBe(TEXT.pickPrompt);
    const pick = within(banner as HTMLElement).getByRole("button", { name: TEXT.pickTown });
    expect(pick.className).toContain("btn-primary");
    // 案内の文とボタンが 1 つの行の枠に入る。登録なしの切り替えは出さない
    expect(banner.querySelector(".town-prompt")!.contains(pick)).toBe(true);
    expect(screen.queryByRole("group", { name: TEXT.mapScopeAria })).toBeNull();
    expect(screen.queryByRole("button", { name: "全国" })).toBeNull();
    expect(lastProps().focus).toBeNull();
  });

  it("町を選んであると、切り替えは数字の後、地図の前に 1 つだけ。『町を変える』は断りより後", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const box = document.querySelector(".map-box")!;
    const scope = screen.getByRole("group", { name: TEXT.mapScopeAria });
    expect(before(document.querySelector(".stat-row")!, scope)).toBe(true);
    expect(before(scope, box)).toBe(true);
    expect(screen.getAllByRole("button", { name: "全国" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: TEXT.myTown })).toBeNull();
    const change = screen.getByRole("button", { name: TEXT.changeTown });
    expect(before(document.querySelector(".map-disclaimer")!, change)).toBe(true);
  });

  it("切り替えは最初『自分の近く』で、押すと地図が動き、押された状態が移る", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const near = screen.getByRole("button", { name: TEXT.mapNear });
    const japan = screen.getByRole("button", { name: "全国" });
    await waitFor(() => expect(lastProps().focus?.kind).toBe("muni"));
    expect(lastProps().focus?.codes).toEqual(["33214"]);
    expect(near.getAttribute("aria-pressed")).toBe("true");
    expect(japan.getAttribute("aria-pressed")).toBe("false");
    const nonce = lastProps().focus!.nonce;
    fireEvent.click(japan);
    expect(lastProps().focus?.kind).toBe("japan");
    expect(japan.getAttribute("aria-pressed")).toBe("true");
    expect(near.getAttribute("aria-pressed")).toBe("false");
    expect(lastProps().focus!.nonce).toBeGreaterThan(nonce);
    fireEvent.click(near);
    expect(lastProps().focus?.kind).toBe("muni");
    expect(near.getAttribute("aria-pressed")).toBe("true");
  });

  it("地点があれば、最初も『自分の近く』も輪の全体が入る広さ", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
    expect(lastProps().focus?.codes).toEqual(["33203"]);
    fireEvent.click(screen.getByRole("button", { name: "全国" }));
    fireEvent.click(screen.getByRole("button", { name: TEXT.mapNear }));
    expect(lastProps().focus?.kind).toBe("rings");
  });

  it("段階 ①② の文は数字の後で地図の前、③④ の文は地図の後。どちらも 1 つ", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    const box = document.querySelector(".map-box")!;
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase()]);
    await screen.findByText("隣町で発生しました");
    const row = document.querySelector(".stat-row")!;
    let banner = document.querySelector(".town-banner")!;
    expect(before(row, banner)).toBe(true);
    expect(before(banner, box)).toBe(true);
    r.deliverCases([]);
    await screen.findByText(TEXT.national);
    banner = document.querySelector(".town-banner")!;
    expect(document.querySelectorAll(".town-banner")).toHaveLength(1);
    expect(before(box, banner)).toBe(true);
  });

  it("町の県が見回りで確認できていない文（色なし）は、地図の前に置く", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch().map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w)));
    r.deliverCases([]);
    await screen.findByText(TEXT.prefUnwatched);
    expect(before(document.querySelector(".town-banner")!, document.querySelector(".map-box")!)).toBe(true);
  });

  it("町だけを選んだ段階 ② の文が地図の前にあっても、直近 14 日が 0 件なら、数字より前に守る文が 1 つだけある", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase({ stages: { confirmed: { date: "2026-10-01", time: null } } })]);
    await screen.findByText("隣町で発生しました");
    const row = document.querySelector(".stat-row")!;
    expect(before(row, document.querySelector(".town-banner")!)).toBe(true);
    expect(before(document.querySelector(".town-banner")!, document.querySelector(".map-box")!)).toBe(true);
    expect(row.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere);
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
  });

  it("段階 ④ の文が地図の下に動いても、0 件の数字より前に守る文が 1 つだけある", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([]);
    await screen.findByText(TEXT.national);
    const row = document.querySelector(".stat-row")!;
    await waitFor(() => expect(row.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere));
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
    expect(before(row, document.querySelector(".map-box")!)).toBe(true);
    expect(before(document.querySelector(".map-box")!, document.querySelector(".town-banner")!)).toBe(true);
  });

  it("左の色帯の待ちの枠（town-now-wait）は画面にない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    show(rig());
    await screen.findByTestId("map");
    expect(document.querySelector(".town-now-wait")).toBeNull();
    expect(document.querySelector(".town-banner .state-wait")).not.toBeNull();
  });
});

// ── W-06: 確認状況と一覧 ──
const failed = (codes: string[]): WatchStatus[] =>
  okWatch().map((w) => (codes.includes(w.prefCode) ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w));
const bannerText = () => document.querySelector(".town-banner")?.textContent ?? "";

describe("MapPage: 確認状況", () => {
  it("見回りの結果が届く前は、件数の文ではなく『まだ読めていません』。届いたら 47 県の文", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    expect(screen.getByTestId("watch-line").textContent).toContain("まだ読めていません");
    expect(screen.getByTestId("watch-line").textContent).not.toMatch(/件を確認/);
    r.deliverWatch(okWatch());
    expect(screen.getByTestId("watch-line").textContent).toContain("47 都道府県のうち 47 件を確認、0 件は確認できていません");
  });

  it("上の時刻は checkedAt の最大（8:30）で、now（9:00）ではない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    expect(document.querySelector(".as-of")?.textContent).toBe("11 月 4 日 8:30 時点");
  });

  it("過去のシーズンを選ぶと、今の見回りの行は出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["33"]));
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(screen.queryByTestId("watch-line")).toBeNull();
  });

  it("凡例は 疑い、確定、野鳥の検査中、野鳥の確定、確認できていない県", async () => {
    show(rig());
    await screen.findByTestId("map");
    const items = within(screen.getByRole("list", { name: "地図の見方" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["疑い", "確定", "野鳥の検査中", "野鳥の確定", "確認できていない県"]);
  });
});

describe("MapPage: 自分の町の県が未確認（W-06 追加の範囲 1）", () => {
  it("事例が届いていて④でも、町の県（岡山県）の見回りが失敗なら『この県は確認できていません』。全国の動きだけにしない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["33"]));
    await waitFor(() => expect(bannerText()).toContain(TEXT.prefUnwatched));
    expect(bannerText()).not.toContain(TEXT.national);
    expect(tones()).not.toContain("lv4");
    // 0 件の数字より前に守る文がある（町の文からは札の前へ移す）
    expect(document.querySelector(".stat-row")!.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere);
  });

  it("見回りの結果が未着のときも同じ（結果が届くまで、確認できた扱いにしない）", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(bannerText()).toContain(TEXT.prefUnwatched));
    expect(bannerText()).not.toContain(TEXT.national);
  });

  it("隣町で発生（②）でも、町の県が未確認なら詳細に添える。段階の文と色は変えない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    r.deliverWatch(failed(["33"]));
    await screen.findByText("隣町で発生しました");
    expect(bannerText()).toContain(TEXT.prefUnwatched);
    expect(tones()).toContain("lv2");
  });

  it("別の県（東京都）だけが未確認なら、町の 1 文には足さない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["13"]));
    await screen.findByText(TEXT.national);
    expect(bannerText()).not.toContain(TEXT.prefUnwatched);
  });
});

describe("MapPage: 索引にない市町村の地点（W-06 追加の範囲 2）", () => {
  it("過去の行を『発生はありません』にせず、読めなかった扱い。1 文も町を選び直す趣旨", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(35.07, 134.0), muniCode: "99999", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(screen.getByText(TEXT.pastFailed)).toBeTruthy());
    expect(document.body.textContent).not.toContain("発生はありません");
    expect(screen.getByText(TEXT.unknownTown)).toBeTruthy();
    expect(tones()).not.toContain("lv4");
  });
});

describe("MapPage: 一覧", () => {
  const listBtn = () => screen.getByRole("button", { name: /一覧/ });

  it("閉じると 1 行。押すと aria-expanded true。昨季を選ぶと 24 行で、出典は maff.go.jp", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(listBtn().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    fireEvent.click(listBtn());
    expect(listBtn().getAttribute("aria-expanded")).toBe("true");
    const rows = within(screen.getByRole("list", { name: "発生の一覧" })).getAllByRole("listitem");
    expect(rows).toHaveLength(24);
    const hosts = rows.map((li) => new URL(li.querySelector("a")!.getAttribute("href")!).hostname);
    expect(hosts.every((h) => h.endsWith("maff.go.jp"))).toBe(true);
    // 3 つの注記
    for (const t of ["疑いは、県の発表を見つけられた県だけ出ます", "環境省の野鳥監視重点区域は", "監視強化区域は"]) {
      expect(document.body.textContent).toContain(t);
    }
  });

  it("今季の一覧には、数に入れていない確認中の事例も県名と『確認中』で出る。今季の棒の件数には入らない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([
      tsuyamaCase(),
      tsuyamaCase({ id: "rev-1", prefCode: "31", muniCode: null, muniName: null, headCount: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.invalid/r"] }),
    ]);
    r.deliverWatch(okWatch());
    fireEvent.click(listBtn());
    const items = within(await screen.findByRole("list", { name: "発生の一覧" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items.map((li) => li.textContent).join("|")).toMatch(/鳥取県　確認中/);
    expect(screen.getByRole("button", { name: /今季/ }).textContent).toContain("1 件");
  });

  it("今季の事例が届く前の一覧は『まだ読めていません』。0 件にしない", async () => {
    show(rig());
    await screen.findByTestId("map");
    expect(listBtn().textContent).toContain("まだ読めていません");
    expect(listBtn().textContent).not.toMatch(/0 件/);
  });

  it("画面の全文に、禁じた語がない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    r.deliverWatch(failed(["33", "13"]));
    fireEvent.click(listBtn());
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("MapPage: レビュー指摘の修正（1 回目）", () => {
  it("自分の県（岡山県）は確認できていて、隣の県（鳥取県）だけ未確認: 真庭市の④は『隣の県（鳥取県）は確認できていません』", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["31"]));
    await waitFor(() => expect(bannerText()).toContain("隣の県（鳥取県）"));
    expect(bannerText()).not.toContain(TEXT.national);
    expect(bannerText()).not.toContain(TEXT.prefUnwatched);
    // 0 件の数字より前に守る文がある（町の文からは札の前へ移す）
    expect(document.querySelector(".stat-row")!.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere);
  });

  it("隣の県が確認できていれば出ない（別の県だけ未確認）", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["13"]));
    await screen.findByText(TEXT.national);
    expect(bannerText()).not.toContain("隣の県");
  });

  it("一覧が空で見回りに失敗した県があるとき、閉じた行に『確認できた範囲では』", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["33"]));
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("確認できた範囲では 0 件");
    fireEvent.click(btn);
    expect(document.body.textContent).toContain("（1 県は確認できていません）");
    expect(document.body.textContent).not.toContain("この期間に、一覧にできる発生の報告はありません");
  });

  it("見回りの結果が未着の間は、空の一覧を『0 件』にしない（まだ確認できていません）", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const btn = screen.getByRole("button", { name: /一覧/ });
    expect(btn.textContent).toContain("まだ確認できていません");
    expect(btn.textContent).not.toMatch(/0 件/);
  });

  it("過去のシーズンの一覧には、今の見回りの失敗を持ち込まない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["33"]));
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(screen.getByRole("button", { name: /一覧/ }).textContent).toContain("24 件");
    expect(screen.getByRole("button", { name: /一覧/ }).textContent).not.toContain("確認できた範囲");
  });

  it("全県が失敗のとき、上の時刻は『時点』ではなく『最後に確認を試した』", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(PREFS.map((p) => p.code)));
    const t = document.querySelector(".as-of")?.textContent ?? "";
    expect(t).toContain("最後に確認を試した");
    expect(t).not.toContain("時点");
  });
});

describe("MapPage: 並びと出典", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  const scrollMock = () => Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("守る文は地図の直後にあり、場所を合わせる区画より前。.map-status は画面にない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const box = document.querySelector(".map-box")!;
    const disclaimer = screen.getByText(/色がない場所は/);
    const picker = screen.getByRole("region", { name: TEXT.spotTitle });
    expect(follows(box, disclaimer)).toBe(true);
    expect(follows(disclaimer, picker)).toBe(true);
    expect(disclaimer.className).toBe("map-disclaimer");
    expect(screen.getByTestId("watch-line").className).toContain("state-ok");
    expect(document.querySelector(".map-status")).toBeNull();
  });

  it("今季がまだ読めない間は state-unknown の全文が出て、.map-status はない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    expect(screen.getByTestId("watch-line").className).toContain("state-unknown");
    const p = screen.getByText("今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。");
    expect(p.className).toBe("state-unknown");
    expect(document.querySelector(".map-status")).toBeNull();
  });

  it("確認中の発表がある県の文は全文で、state-wait。WatchLine より後、.map-attribution より前", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([
      tsuyamaCase({ id: "rev-1", prefCode: "31", muniCode: null, muniName: null, headCount: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.invalid/r"] }),
    ]);
    r.deliverWatch(okWatch());
    const p = await screen.findByText("確認中の発表がある県: 鳥取県。件数にはまだ入れていません。");
    expect(p.className).toBe("state-wait");
    expect(follows(screen.getByTestId("watch-line"), p)).toBe(true);
    expect(follows(p, document.querySelector(".map-attribution")!)).toBe(true);
    expect(document.querySelector(".map-status")).toBeNull();
  });

  it("出典は地図の外の .map-attribution に 3 つ出る", async () => {
    show(rig());
    await screen.findByTestId("map");
    const a = document.querySelector(".map-attribution")!;
    expect(a).toBeTruthy();
    expect(a.closest(".map-box")).toBeNull();
    expect(a.textContent).toMatch(/地理院タイル/);
    expect(a.textContent).toMatch(/Vector Map Level 0/);
    expect(a.textContent).toMatch(/国土数値情報/);
    expect(a.querySelectorAll("span")).toHaveLength(3);
  });

  it("『地図で場所を合わせる』を押すと地図の上端へ動く。棒を押すと見出しへ動く", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    expect(scrollMock()).toHaveBeenCalledWith({ block: "start" });
    scrollMock().mockClear();
    fireEvent.click(screen.getByRole("button", { name: /昨季/ }));
    expect(scrollMock()).toHaveBeenCalled();
  });

  it("地図の部品が読み込めなければ mapLoadFailed を出し、守る文は残る", async () => {
    mapThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    show(rig());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(TEXT.mapLoadFailed);
    expect(alert.className).toBe("map-error");
    expect(screen.getByText(/色がない場所は/)).toBeTruthy();
    spy.mockRestore();
  });
});

describe("MapPage: 読めないとき（T10）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("事例が読めないまま 14,999ms では案内を出さず、15,000ms で出る。『読めるまで』の文は残る", () => {
    const r = rig();
    show(r);
    tick(14_999);
    expect(document.body.textContent).not.toContain(TEXT.slowLoad);
    tick(1);
    expect(document.body.textContent).toContain(TEXT.slowLoad);
    expect(document.body.textContent).toContain("今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。");
  });

  it("15 秒たった後でも、事例が読めると案内が消える", () => {
    const r = rig();
    show(r);
    tick(15_000);
    expect(document.body.textContent).toContain(TEXT.slowLoad);
    r.deliverCases([]);
    expect(document.body.textContent).not.toContain(TEXT.slowLoad);
  });

  it("町を選んでいるとき、町の帯の読み込み中の文にも案内が付く", () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    tick(15_000);
    const wait = document.querySelector(".town-banner .state-wait")!;
    expect(wait.textContent).toContain(TEXT.loading);
    expect(wait.textContent).toContain(TEXT.slowLoad);
  });
});

describe("MapPage: 平面の札（T12）", () => {
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const stats = () => [...document.querySelectorAll(".stat")];
  const titles = () => stats().map((e) => e.querySelector(".stat-title")?.textContent);

  it("今季を見ているとき 5 枚（地点がなければ約 60km の札と登録した町の札はない）。数字の札は確認中の県と見回りの行より後で、地図より前。守る文は地図の直後。残りの札は一覧より後。watch-line は 1 つ", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([
      tsuyamaCase({ id: "rev-1", prefCode: "31", muniCode: null, muniName: null, headCount: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.invalid/r"] }),
    ]);
    r.deliverWatch(okWatch());
    expect(stats()).toHaveLength(5);
    expect(titles()).toEqual(["発生した件数", "直近 14 日の件数", "時刻", "過去 6 シーズンの 11 月 4 日まで", "野鳥の陽性（今季）"]);
    const row = document.querySelector(".stat-row")!;
    expect(row.querySelectorAll(".stat")).toHaveLength(3);
    const box = document.querySelector(".map-box")!;
    expect(follows(row, box)).toBe(true);
    expect(box.nextElementSibling).toBe(document.querySelector(".map-disclaimer"));
    const rest = document.querySelector(".stat-rest")!;
    expect(rest.querySelectorAll(".stat")).toHaveLength(2);
    expect(follows(document.querySelector(".case-list")!, rest)).toBe(true);
    expect(follows(rest, document.querySelector(".season-bar")!)).toBe(true);
    expect(follows(screen.getByTestId("watch-line"), row)).toBe(true);
    expect(follows(screen.getByText(/確認中の発表がある県/), row)).toBe(true);
    expect(follows(row, document.querySelector(".map-attribution")!)).toBe(true);
    expect(screen.getAllByTestId("watch-line")).toHaveLength(1);
    expect(row.querySelector("[role=status]")).toBeNull();
    expect(row.querySelector(".stat-headline")!.textContent).toBe(TEXT.statHeadline);
    expect(stats()[2]!.textContent).toContain("11 月 4 日 8:30 時点");
  });

  it("過去のシーズンでは 0 枚", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(stats()).toHaveLength(5);
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(stats()).toHaveLength(0);
  });

  it("再現では 0 枚", async () => {
    const r = rig();
    r.ds.mode = "replay";
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(stats()).toHaveLength(0);
  });

  it("47 県とも未確認なら 1 枚目は『まだ確認できていません』で、件数を見出しにしない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const value = stats()[0]!.querySelector(".stat-value")!.textContent!;
    expect(value).toBe("まだ確認できていません");
    expect(value).not.toMatch(/[0-9]+ 件/);
  });

  it("一部の県が未確認なら『確認できた範囲では N 件（M 県は確認できていません）』", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["33"]));
    expect(stats()[0]!.querySelector(".stat-value")!.textContent).toBe("確認できた範囲では 0 件（1 県は確認できていません）");
    expect(stats()[0]!.classList.contains("stat-wide")).toBe(true);
  });

  it("全県確認の札は横に並び、stat-wide を付けない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed([]));
    expect(stats()[0]!.querySelector(".stat-value")!.textContent).toBe("0 件");
    expect(stats()[0]!.classList.contains("stat-wide")).toBe(false);
  });

  it("未確認の県があるときの数字は、大きな数字にせず文の大きさの class にする。全県確認なら数字だけを大きくする", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch().map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w)));
    const partial = stats()[0]!.querySelector(".stat-value")!;
    expect(partial.textContent).toBe("確認できた範囲では 0 件（1 県は確認できていません）");
    expect(partial.classList.contains("is-sentence")).toBe(true);
    expect(partial.querySelector("b")).toBeNull();
    r.deliverWatch(okWatch());
    const all = stats()[0]!.querySelector(".stat-value")!;
    expect(all.textContent).toBe("0 件");
    expect(all.classList.contains("is-sentence")).toBe(false);
    expect(all.querySelector("b")!.textContent).toBe("0");
  });

  it("地点があるときは約 60km の札が数字の札の先頭。町が分からない発表の断りと読めない断りは札に残す", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase({ muniCode: null, muniName: null })]);
    await waitFor(() => expect(titles()[0]).toBe("農場から約 60 km 以内"));
    expect(document.querySelector(".stat-row")!.querySelector(".stat")).toBe(stats()[0]);
    expect(stats()[0]!.textContent).toContain(TEXT.statBandUnplaced(1));
    expect(stats()[0]!.textContent).toContain(TEXT.statBandRelated);
  });

  it("全県確認で 0 件でも、件数のあるときと .stat-value の class は同じ", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const zero = stats()[0]!.querySelector(".stat-value")!;
    expect(zero.textContent).toBe("0 件");
    const zeroClass = zero.className;
    r.deliverCases([tsuyamaCase()]);
    const one = stats()[0]!.querySelector(".stat-value")!;
    expect(one.textContent).toBe("1 件");
    expect(one.className).toBe(zeroClass);
  });
});

describe("map.css（比べの表の幅と PC 幅の 2 列）", () => {
  const mapCss = readFileSync(path.resolve(import.meta.dirname, "map.css"), "utf8");

  it("比べの表は行の見出しを 5em まで詰め、2 つの件数の列を同じ幅にする", () => {
    expect(mapCss).toMatch(/\.compare-table(?:\.data-table)? th\[scope="row"\]\s*\{[^}]*min-width:\s*5em/);
    expect(mapCss).toMatch(/\.compare-table td\.num\s*\{[^}]*width:\s*(\d+)%/);
  });

  it("64rem 以上で .map-page を 2 列の grid にし、地図を左、状況を右に置く", () => {
    const m = mapCss.match(/@media \(min-width:\s*64rem\)\s*\{([\s\S]*?)\n\}\n/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/\.map-page\s*\{[^}]*display:\s*grid/);
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*2fr\)/);
    expect(body).toMatch(/column-gap:\s*24px/);
    expect(body).toMatch(/\.map-box\s*\{[^}]*grid-column:\s*1/);
    expect(body).toMatch(/\.map-page\s*>\s*\.map-box ~ \*\s*\{[^}]*grid-column:\s*2/);
    // 十字合わせ中は 2 列を解く
    expect(body).toMatch(/\.map-page:has\(>\s*\.spot-picker\[data-active="true"\]\)\s*\{[^}]*display:\s*flex/);
    // 再現の h1 隠しは壊さない
    expect(readFileSync(path.resolve(import.meta.dirname, "../replay/replay.css"), "utf8")).toMatch(/\.replay-scope \.map-page > h1\s*\{\s*display:\s*none/);
  });

  it("64rem 以上で地図は右の列に伸ばされない。町の文は右の列に置く", () => {
    const body = mapCss.match(/@media \(min-width:\s*64rem\)\s*\{([\s\S]*?)\n\}\n/)![1]!;
    expect(body).toMatch(/\.map-page\s*>\s*\.map-box\s*\{[^}]*align-self:\s*start/);
    expect(body).not.toMatch(/\.map-box\s*\.map-canvas\s*\{[^}]*min-height/);
    expect(body).toMatch(/\.map-page\s*>\s*\.town-banner\s*\{[^}]*grid-column:\s*2/);
  });

  it("40rem から 64rem の間は今の 1 列のまま（2 列の規則は 64rem 以上だけ）", () => {
    expect(mapCss.replace(/@media \(min-width:\s*64rem\)\s*\{[\s\S]*?\n\}\n/, "")).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*3fr\)/);
  });

  it("画面の本文は 1200px までで中央に寄せる", () => {
    expect(mapCss).toMatch(/\.map-page\s*\{[^}]*max-width:\s*1200px[^}]*margin-inline:\s*auto/);
  });
});

describe("MapPage: 距離の輪と毎朝の札", () => {
  const FARM_MESH = latLngToMesh3(35.07, 134.0); // 津山市のあたり（試験の地点）
  const setSpot = (mesh = FARM_MESH) => localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: mesh, muniCode: "33203", frequentMuniCodes: [] }));
  const card = (title: string | RegExp) =>
    [...document.querySelectorAll(".stat")].find((e) => {
      const t = e.querySelector(".stat-title")?.textContent ?? "";
      return typeof title === "string" ? t === title : title.test(t);
    });
  const recentValue = () => card("直近 14 日の件数")!.querySelector(".stat-value")!.textContent;
  const bandCard = () => card(/約 60 km 以内/);
  const onDate = (date: string) => ({ confirmed: { date, time: null } });
  const failedWatch = (codes: string[]) => okWatch().map((w) => (codes.includes(w.prefCode) ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w));

  describe("輪と断り", () => {
    it("地点がなければ、輪の地点を渡さず、断りも約 60km の札も出さない", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(lastProps().farmMeshCode).toBeNull();
      expect(screen.queryByText(TEXT.ringNote)).toBeNull();
      expect(bandCard()).toBeUndefined();
    });

    it("町だけを選んだときも輪は出さない（地点がない）", async () => {
      localStorage.setItem(TOWN_KEY, "33203");
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      expect(lastProps().farmMeshCode).toBeNull();
      expect(screen.queryByText(TEXT.ringNote)).toBeNull();
    });

    it("地点があれば、マス目を地図に渡し、断りを色がない場所の断りのすぐ後に出す", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      expect(lastProps().farmMeshCode).toBe(FARM_MESH);
      const note = screen.getByText("輪は距離の目安で、発表の区域ではありません。");
      expect(note.previousElementSibling?.className).toBe("map-disclaimer");
    });

    it("過去のシーズンを選んでも輪と断りは残る。再現でも地点があれば出る", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
      expect(lastProps().farmMeshCode).toBe(FARM_MESH);
      expect(screen.getByText(TEXT.ringNote)).toBeTruthy();
      cleanup();

      const replay = rig();
      replay.ds.mode = "replay";
      show(replay);
      await screen.findByTestId("map");
      expect(lastProps().farmMeshCode).toBe(FARM_MESH);
      expect(screen.getByText(TEXT.ringNote)).toBeTruthy();
    });
  });

  describe("直近 14 日", () => {
    it("読み込み中は『まだ読めていません』で 0 件にしない", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      expect(recentValue()).toBe("まだ読めていません");
    });

    it("47 県とも未確認なら件数を見出しにしない", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      expect(recentValue()).toBe("まだ確認できていません");
    });

    it("一部の県が未確認なら断りを付け、広い札にする", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([tsuyamaCase({ stages: onDate("2026-11-02") }), tsuyamaCase({ id: "old", stages: onDate("2026-10-01") })]);
      r.deliverWatch(failedWatch(["33"]));
      expect(recentValue()).toBe("確認できた範囲では 1 件（1 県は確認できていません）");
      expect(card("直近 14 日の件数")!.classList.contains("stat-wide")).toBe(true);
    });

    it("全県を確認できていれば件数だけ。広い札にしない", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([tsuyamaCase({ stages: onDate("2026-11-02") })]);
      r.deliverWatch(okWatch());
      expect(recentValue()).toBe("1 件");
      expect(card("直近 14 日の件数")!.classList.contains("stat-wide")).toBe(false);
    });

    it("今季に発生があっても直近 14 日が 0 件なら、riskAnywhere を札のすぐ前に出す", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([tsuyamaCase({ stages: onDate("2026-10-01") })]);
      r.deliverWatch(okWatch());
      expect(recentValue()).toBe("0 件");
      const risk = await screen.findByText(FIXED_TEXT.riskAnywhere);
      expect(risk.nextElementSibling?.className).toBe("stat-row");
    });

    it("札にも発生があるときは札の前に riskAnywhere を足さない（棒の断りとして 1 つだけ出す）", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([tsuyamaCase({ stages: onDate("2026-11-02") })]);
      r.deliverWatch(okWatch());
      expect(recentValue()).toBe("1 件");
      expect(document.querySelector(".map-risk")).toBeNull();
      const risk = screen.getAllByText(FIXED_TEXT.riskAnywhere);
      expect(risk).toHaveLength(1);
      expect(risk[0]!.closest(".season-charts")).not.toBeNull();
    });
  });

  describe("過去のシーズンの同じ日まで", () => {
    const pastCard = () => card(/過去 \d+ シーズンの/);

    it("件数の幅を出し、多い少ないを書かない", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      const value = pastCard()!.querySelector(".stat-value")!.textContent!;
      expect(value).toMatch(/^\d+(〜\d+)? 件$/);
      expect(pastCard()!.textContent).not.toMatch(/多い|少ない/);
    });

    it("過去の記録の読み込み中と失敗で、0 件にしない", async () => {
      const r = rig({ history: "deferred" });
      show(r);
      await screen.findByTestId("map");
      expect(pastCard()!.querySelector(".stat-value")!.textContent).toBe("まだ読めていません");
      await act(async () => {
        r.historyDeferred.reject(new Error("読めない"));
      });
      expect(pastCard()!.querySelector(".stat-value")!.textContent).toBe("読めませんでした");
    });
  });

  describe("約 60km 以内", () => {
    it("読み込み中は 0 件にしない。今季と過去 6 シーズンを、地点から数えて出す", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      expect(bandCard()!.textContent).toContain("今季 まだ読めていません");
      r.deliverWatch(okWatch());
      r.deliverCases([
        tsuyamaCase({ id: "near", stages: onDate("2026-11-02") }),
        tsuyamaCase({ id: "far", prefCode: "01", muniCode: "01100", muniName: "札幌市", stages: onDate("2026-11-02") }),
        tsuyamaCase({ id: "rev", confirmState: "reviewing" }),
      ]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 1 件"));
      await waitFor(() => expect(bandCard()!.textContent).toMatch(/過去 6 シーズン \d+ 件/));
      expect(bandCard()!.textContent).toContain(TEXT.statBandRelated);
      expect(bandCard()!.classList.contains("stat-wide")).toBe(true);
    });

    it("一部の県が未確認なら今季に断りを付け、47 県とも未確認なら件数を見出しにしない", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 まだ確認できていません"));
      r.deliverWatch(failedWatch(["33"]));
      expect(bandCard()!.textContent).toContain("今季 確認できた範囲では 0 件（1 県は確認できていません）");
    });

    it("過去の記録を読めなければ、過去は『読めませんでした』で今季は出す", async () => {
      setSpot();
      const r = rig({ history: "deferred" });
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 1 件"));
      expect(bandCard()!.textContent).toContain("過去 6 シーズン まだ読めていません");
      await act(async () => {
        r.historyDeferred.reject(new Error("読めない"));
      });
      expect(bandCard()!.textContent).toContain("過去 6 シーズン 読めませんでした");
      expect(bandCard()!.textContent).toContain(TEXT.statFailedNote);
    });

    it("知らない町の事例があり距離を計算できなければ『読めませんでした』で、0 件にしない", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ muniCode: "33999" })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 読めませんでした"));
      expect(bandCard()!.textContent).toContain(TEXT.statFailedNote);
    });

    it("町が分からない発表は距離に入れず、その数を札に書く", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ muniCode: null, muniName: null, stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 0 件"));
      expect(bandCard()!.textContent).toContain("町が分からない発表が 1 件あり、距離に入れていません。");
    });

    it("約 60km の今季が 0 件で、町の 1 文に riskAnywhere がなければ、札のすぐ前に出す", async () => {
      localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: FARM_MESH, muniCode: "33203", frequentMuniCodes: ["01100"] }));
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ prefCode: "01", muniCode: "01100", muniName: "札幌市", stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 0 件"));
      expect(recentValue()).toBe("1 件");
      await waitFor(() => expect(document.querySelector(".stat-row")!.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere));
    });

    it("過去のシーズンでは出さない", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      await waitFor(() => expect(bandCard()).toBeTruthy());
      fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
      expect(bandCard()).toBeUndefined();
    });
  });

  describe("登録した町の今季", () => {
    const frequentCard = () => card(TEXT.statFrequent);
    const withFrequent = (codes: string[]) => localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: FARM_MESH, muniCode: "33203", frequentMuniCodes: codes }));

    it("登録がなければ札を出さない。地点がなければ出さない", async () => {
      setSpot();
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(frequentCard()).toBeUndefined();
    });

    it("約 60km の札のすぐ後に、町ごとの今季の件数を出す。数えない事例は入れない", async () => {
      withFrequent(["33214", "33202"]);
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([
        tsuyamaCase({ id: "m1", muniCode: "33214", muniName: "真庭市", stages: onDate("2026-11-02") }),
        tsuyamaCase({ id: "m2", muniCode: "33214", muniName: "真庭市", stages: onDate("2026-11-03") }),
        tsuyamaCase({ id: "rev", muniCode: "33202", confirmState: "reviewing" }),
      ]);
      await waitFor(() => expect(frequentCard()!.textContent).toContain("真庭市 2 件"));
      expect(frequentCard()!.textContent).toContain("倉敷市 0 件");
      expect(bandCard()!.nextElementSibling).toBe(frequentCard());
    });

    it("登録した町に 0 件があれば、riskAnywhere を札のすぐ前に出す", async () => {
      withFrequent(["33202"]);
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ id: "near", stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(frequentCard()!.textContent).toContain("倉敷市 0 件"));
      expect(document.querySelector(".stat-row")!.previousElementSibling?.textContent).toBe(FIXED_TEXT.riskAnywhere);
    });

    it("読み込み中は 0 件にしない。その町の県が未確認なら断りを付け、47 県とも未確認なら件数を見出しにしない", async () => {
      withFrequent(["33202", "01100"]);
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      await waitFor(() => expect(frequentCard()!.textContent).toContain("まだ読めていません"));
      expect(frequentCard()!.textContent).not.toMatch(/ 0 件/u);
      r.deliverCases([]);
      await waitFor(() => expect(frequentCard()!.textContent).toContain("倉敷市 まだ確認できていません"));
      expect(frequentCard()!.textContent).not.toMatch(/ 0 件/u);
      r.deliverWatch(failedWatch(["33"]));
      await waitFor(() => expect(frequentCard()!.textContent).toContain("倉敷市 確認できた範囲では 0 件（1 県は確認できていません）"));
      expect(frequentCard()!.textContent).toContain("札幌市 0 件");
    });
  });

  describe("野鳥の陽性", () => {
    const birdCard = () => card(TEXT.statBirds);
    const bird = (o: Partial<WildBird> & { id: string }): WildBird => ({
      season: 2026,
      date: "2026-11-01",
      prefCode: "33",
      muniCode: null,
      muniName: null,
      species: null,
      test: "screening_positive",
      focusZone: { from: null, to: null },
      sourceUrl: "https://example.invalid/b",
      ...o,
    });

    it("届くまでは 0 件にしない。読めなければ読めないまま", async () => {
      const r = rig();
      let cb: ((b: WildBird[]) => void) | null = null;
      r.ds.subscribeWildBirds = (_s, c) => {
        cb = c;
        return () => {};
      };
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("まだ読めていません");
      expect(birdCard()!.textContent).not.toMatch(/\d 件/u);
      act(() => cb!([]));
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("0 件");
    });

    it("0 件は『いない』と読ませない断りを常に添える。定点の数へのリンクがある", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(birdCard()!.textContent).toContain(TEXT.statBirdsNote);
      expect(within(birdCard() as HTMLElement).getByRole("link", { name: TEXT.statBirdsLink }).getAttribute("href")).toBe("/trends");
    });

    it("否定を除き、検査中と確定を分けて出す", async () => {
      const r = rig();
      r.ds.subscribeWildBirds = (_s, c) => {
        c([bird({ id: "a" }), bird({ id: "b", test: "hpai_confirmed" }), bird({ id: "c", test: "negative" })]);
        return () => {};
      };
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("2 件");
      expect(birdCard()!.textContent).toContain(TEXT.statBirdsBreakdown(1, 1));
    });

    it("47 県とも未確認で 0 件なら件数を見出しにしない。陽性の発表があれば件数を隠さない。一部の県の未確認は断らない（環境省の発表で、県の見回りと別）", async () => {
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("まだ確認できていません");
      r.deliverWatch(failedWatch(["33"]));
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("0 件");
      cleanup();

      const r2 = rig();
      r2.ds.subscribeWildBirds = (_s, c) => {
        c([bird({ id: "a" })]);
        return () => {};
      };
      show(r2);
      await screen.findByTestId("map");
      r2.deliverCases([]);
      expect(birdCard()!.querySelector(".stat-value")!.textContent).toBe("1 件");
    });
  });

  describe("町の枠の周辺の表", () => {
    it("地点がなければ中心どうし、地点があれば面まで。地点のときの全体の件数は約 60km の札と同じ", async () => {
      localStorage.setItem(TOWN_KEY, "33214");
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      await waitFor(() => expect(document.querySelector(".nearby-past")?.textContent).toContain(TEXT.nearbyBasisCenter));
      cleanup();
      localStorage.clear();

      setSpot();
      const r2 = rig();
      show(r2);
      await screen.findByTestId("map");
      r2.deliverWatch(okWatch());
      r2.deliverCases([]);
      await waitFor(() => expect(document.querySelector(".nearby-past")?.textContent).toContain(TEXT.nearbyBasisMesh));
      await waitFor(() => expect(bandCard()!.textContent).toMatch(/過去 6 シーズン \d+ 件/));
      const n = Number(bandCard()!.textContent!.match(/過去 6 シーズン (\d+) 件/)![1]);
      const rows = [...document.querySelectorAll(".nearby-past tbody tr")];
      const sum = rows.reduce((s, tr) => s + Number(tr.querySelector('td[data-label="件数"]')!.textContent!.match(/\d+/)![0]), 0);
      expect(sum).toBe(n);
      expect(rows[0]!.querySelector('td[data-label="距離"]')!.textContent).toBe("この町");
    });
  });

  it("新しい文に書かない語がない。距離に「約」が付く", () => {
    const words = [
      TEXT.statFrequent,
      TEXT.statBirds,
      TEXT.statBirdsNote,
      TEXT.statBirdsLink,
      TEXT.statBirdsBreakdown(1, 2),
      TEXT.ringNote,
      TEXT.statRecent,
      TEXT.statPastToDate(6, "11 月 4 日"),
      TEXT.statBand(60),
      TEXT.statBandPast(6),
      TEXT.statFailed,
      TEXT.statFailedNote,
      TEXT.statBandRelated,
      TEXT.statBandUnplaced(1),
    ].join("");
    expect(findForbiddenPhrases(words)).toEqual([]);
    expect(words).not.toMatch(/問題ありません|多い|少ない/);
    expect(TEXT.statBand(60)).toContain("約 60 km");
  });
});

describe("幅 64rem 未満の地図の前（スマホ）", () => {
  const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const failing = (codes: readonly string[]): WatchStatus[] => okWatch().map((w) => (codes.includes(w.prefCode) ? { ...w, ok: false, failingSince: w.checkedAt } : w));
  const textBeforeMap = () => {
    const box = document.querySelector(".map-box")!;
    return [...document.querySelector(".map-page")!.children]
      .filter((e) => before(e, box))
      .map((e) => e.textContent)
      .join("\n");
  };

  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("守る文は札のすぐ前で、出典は短いリンクにする。URL の全文は地図の下", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const risk = await waitFor(() => document.querySelector(".map-risk")!);
    expect(risk.textContent).toBe("件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典）");
    expect(FIXED_TEXT.riskAnywhere.startsWith("件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典")).toBe(true);
    expect(risk.nextElementSibling?.className).toBe("stat-row");
    const url = FIXED_TEXT.riskAnywhere.match(/https:\S+(?=）)/)![0];
    expect(within(risk as HTMLElement).getByRole("link", { name: /出典/ }).getAttribute("href")).toBe(url);
    expect(textBeforeMap()).not.toContain("https://");
    const source = document.querySelector(".map-risk-source")!;
    expect(before(document.querySelector(".map-box")!, source)).toBe(true);
    expect(source.textContent).toContain(url);
    expect(screen.getAllByTestId("watch-line")).toHaveLength(1);
    expect(before(document.querySelector(".map-box")!, screen.getByTestId("watch-line"))).toBe(true);
  });

  it("町を選ぶ前は、地図の隅のボタンで全国へ戻れる。切り替えは出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    expect(screen.queryByRole("group", { name: TEXT.mapScopeAria })).toBeNull();
    const home = within(document.querySelector(".map-box") as HTMLElement).getByRole("button", { name: TEXT.japan });
    fireEvent.click(home);
    expect(lastProps().focus?.kind).toBe("japan");
  });

  it("一部未確認: 断りを 1 文にまとめ、確認の行の全文は地図の下。札の断りは .stat-long に入れてスマホで隠す", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failing(["33"]));
    await waitFor(() => expect(document.querySelector(".stat-unchecked")?.textContent).toBe(`確認できた範囲の件数です。岡山県は確認できていません。${TEXT.watchFailedTail}`));
    expect(document.querySelector(".stat-national .stat-value")!.textContent).toBe("確認できた範囲では 0 件（1 県は確認できていません）");
    expect([...document.querySelectorAll(".stat-national .stat-long")].map((e) => e.textContent)).toEqual(["確認できた範囲では ", "（1 県は確認できていません）"]);
    expect(document.querySelector(".stat-national .stat-value b")).toBeNull();
    const watchLine = screen.getByTestId("watch-line");
    expect(watchLine.textContent).toContain("47 都道府県のうち 46 件を確認、1 件は確認できていません（岡山県）");
    expect(before(document.querySelector(".map-box")!, watchLine)).toBe(true);
  });

  it("3 県以上が未確認なら県の数で書く。全県未確認は件数の文を出さず、同じ文の札を繰り返さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failing(["01", "02", "33"]));
    await waitFor(() => expect(document.querySelector(".stat-unchecked")?.textContent).toContain("確認できた範囲の件数です。3 県は確認できていません。"));
    r.deliverWatch(failing(PREFS.map((p) => p.code)));
    await waitFor(() => expect(document.querySelector(".stat-unchecked")?.textContent).toBe(`47 県は確認できていません。${TEXT.watchFailedTail}`));
    expect(document.querySelector(".stat-national .stat-value")!.textContent).toBe("まだ確認できていません");
    expect(document.querySelector(".stat-recent")).toBeNull();
  });

  it("見回りの結果が届く前は、確認の行を地図の前に置き、まとめの文を出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(document.querySelector(".stat-row")).not.toBeNull());
    expect(document.querySelector(".stat-unchecked")).toBeNull();
    expect(before(screen.getByTestId("watch-line"), document.querySelector(".map-box")!)).toBe(true);
  });

  it("段階 ②: 段階の文だけが地図の前。事例の行、町の名、過去は地図の下。町の文の守る文は札の前へ移る", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase()]);
    const main = await screen.findByText(TEXT.adjacent);
    const box = document.querySelector(".map-box")!;
    const lead = document.querySelector(".town-lead")!;
    expect(lead.textContent).toBe(TEXT.adjacent);
    expect(lead.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("lv2");
    expect(main.closest(".town-lead")).toBe(lead);
    expect(before(document.querySelector(".stat-row")!, lead)).toBe(true);
    expect(before(lead, box)).toBe(true);
    const banner = document.querySelector(".town-banner")!;
    expect(before(box, banner)).toBe(true);
    expect(banner.textContent).toContain("津山市で確定");
    expect(banner.querySelector(".town-main")).toBeNull();
    expect(document.querySelector(".stat-row")!.previousElementSibling?.className).toContain("map-risk");
    expect(banner.textContent).not.toContain("https://");
  });

  it("町の県が未確認の文（色なし）は地図の前に残す。町の名と残りの行は地図の下", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failing(["33"]));
    const main = await screen.findByText(TEXT.prefUnwatched);
    const box = document.querySelector(".map-box")!;
    expect(main.closest(".town-lead")).not.toBeNull();
    expect(before(main, box)).toBe(true);
    expect(before(box, document.querySelector(".town-banner")!)).toBe(true);
    expect(document.querySelector(".town-banner .town-main")).toBeNull();
    expect(document.querySelector(".stat-unchecked")?.textContent).toContain("岡山県は確認できていません");
  });

  it("知らない町の文（色なし）は地図の前に残す", async () => {
    localStorage.setItem(TOWN_KEY, "99999");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await screen.findByText(TEXT.unknownTown);
    expect(before(screen.getByText(TEXT.unknownTown), document.querySelector(".map-box")!)).toBe(true);
  });
});

describe("県ごとと週ごとの棒", () => {
  const at = (date: string, prefCode: string, id: string) =>
    tsuyamaCase({ id, prefCode, muniCode: null, muniName: null, stages: { confirmed: { date, time: null } } });
  const cases = [at("2026-10-14", "01", "a"), at("2026-11-02", "01", "b"), at("2026-11-03", "33", "c")];
  const rows = () => [...document.querySelectorAll(".pref-bar-row")].map((r) => r.textContent);

  it("今季の県ごとの棒と週ごとの棒が、月の表の近くに、時点と出典の 1 行とともに出る", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    const charts = await waitFor(() => document.querySelector<HTMLElement>(".season-charts")!);
    expect(rows()).toEqual(["北海道2 件", "岡山県1 件"]);
    expect(within(charts).getByRole("list", { name: "週ごとの全国の発生の棒" }).children).toHaveLength(6);
    expect(charts.nextElementSibling?.className).toContain("month-bars");
    expect(within(charts).getByText(/8:30 時点。出典: 農林水産省と各県の発表/)).toBeTruthy();
  });

  it("件数があっても、守る文は画面に 1 つだけで、棒に添える", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    const risk = await screen.findAllByText(FIXED_TEXT.riskAnywhere);
    expect(risk).toHaveLength(1);
    expect(risk[0]!.closest(".season-charts")).not.toBeNull();
  });

  it("守る文が町の文か札の前にあるときは、棒に重ねて出さない", async () => {
    localStorage.setItem(TOWN_KEY, "33202");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(document.querySelector(".season-charts")).not.toBeNull());
    await waitFor(() => expect(screen.getAllByText(FIXED_TEXT.riskAnywhere).length).toBe(1));
    expect(document.querySelector(".season-charts")!.textContent).not.toContain("どこでも感染のリスク");
  });

  it("確認中と否定は棒に入れない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([...cases, tsuyamaCase({ id: "d", prefCode: "46", confirmState: "reviewing" }), tsuyamaCase({ id: "e", prefCode: "46", negation: "negated" })]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(rows()).toEqual(["北海道2 件", "岡山県1 件"]));
  });

  it("未確認の県は 0 の棒にせず『確認できていません』と書く", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(failed(["23"]));
    const charts = await waitFor(() => document.querySelector<HTMLElement>(".season-charts")!);
    await waitFor(() => expect(charts.textContent).toContain("確認できた範囲の件数です。愛知県は確認できていません。"));
    expect(rows()).toEqual(["北海道2 件", "岡山県1 件"]);
  });

  it("今季 0 件で全県確認なら枠を出さない。守る文は札の前にある", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await screen.findByText(FIXED_TEXT.riskAnywhere);
    expect(document.querySelector(".season-charts")).toBeNull();
  });

  it("今季 0 件で一部が未確認なら、確認できていないことだけ書き、守る文を重ねない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed(["23"]));
    const charts = await waitFor(() => document.querySelector<HTMLElement>(".season-charts")!);
    expect(charts.textContent).toContain("愛知県は確認できていません。");
    expect(charts.textContent).not.toMatch(/(^|[^0-9])0 件/);
    expect(rows()).toEqual([]);
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
  });

  it("読めていない間と、1 県も確認できていない間は枠を出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    expect(document.querySelector(".season-charts")).toBeNull();
    r.deliverCases(cases);
    expect(document.querySelector(".season-charts")).toBeNull();
  });

  it("過去のシーズンを押すと枠を出さない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(document.querySelector(".season-charts")).not.toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(document.querySelector(".season-charts")).toBeNull();
  });

  const showReplay = (r: Rig, replayStats: boolean) =>
    render(
      <MemoryRouter>
        <DataSourceProvider value={{ ...r.ds, mode: "replay" }}>
          <SpotProvider>
            <MapPage replayStats={replayStats} />
          </SpotProvider>
        </DataSourceProvider>
      </MemoryRouter>,
    );

  it("再現の 4 事例の流れでは、札と同じく出さない", async () => {
    const r = rig();
    showReplay(r, false);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(lastProps().view.total).toBe(3));
    expect(document.querySelector(".season-charts")).toBeNull();
  });

  it("再現の全国の流れでは、再現の時点の週までを描き、出典は国の事例一覧にする", async () => {
    const r = rig();
    showReplay(r, true);
    await screen.findByTestId("map");
    r.deliverCases(cases);
    r.deliverWatch(okWatch());
    const charts = await waitFor(() => document.querySelector<HTMLElement>(".season-charts")!);
    expect(charts.textContent).toContain("11 月 2 日の週"); // 再現の時計（NOW）は 11/4 の週
    expect(charts.textContent).not.toContain("11 月 9 日の週");
    expect(charts.textContent).toContain("出典: 国の事例一覧");
  });
});
