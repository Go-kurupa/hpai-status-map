import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
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
vi.mock("./MapView", () => ({
  default: (props: MapViewProps) => {
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
  seen.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("MapPage", () => {
  it("今季の事例がまだ届かないうちは『0 件』と書かず、riskAnywhere も出さない。県はすべて確認できていない扱い", async () => {
    show(rig());
    await screen.findByTestId("map");
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(document.body.textContent).not.toMatch(/(^|[^0-9])0 件/);
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

  it("地図の下に固定のリンクが 5 つある", async () => {
    show(rig());
    await screen.findByTestId("map");
    const nav = screen.getByRole("navigation", { name: "ほかのページ" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/public", "/known", "/replay", "/results", "/privacy"]);
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
  it("町を選んでいなければ『町を選んでください』。地図に自分の町の縁はない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    expect(screen.getByText("町を選んでください")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "自分の町" }));
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
    fireEvent.click(screen.getByRole("button", { name: "自分の町" }));
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
    expect(bannerText()).toContain(FIXED_TEXT.riskAnywhere);
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
