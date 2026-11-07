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
import { SPOT_MIN_ZOOM } from "./pickSpot";
import { CMP_TEXT } from "./compareTexts";
import { TEXT } from "./texts";

// 市町村の形の読み込みは fetch を使うので、jsdom では実データを fs から読む偽に替える
vi.mock("../../geo/loadGeo", () => {
  const store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) =>
      JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  // 町の形が届く時を試験で決められるように、止めておく口を持つ（hold で止め、release で届ける）
  let gate: { promise: Promise<typeof store>; release(): void } | null = null;
  return {
    __holdGeo: () => {
      let release = () => {};
      const promise = new Promise<typeof store>((res) => (release = () => res(store)));
      gate = { promise, release };
    },
    __releaseGeo: () => gate?.release(),
    loadWebGeoStore: () => gate?.promise ?? Promise.resolve(store),
    loadJapanTopo: () => Promise.reject(new Error("unused")), loadPrefAnchors: () => Promise.reject(new Error("unused")) };
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

import MapPage, { type MapSection } from "./MapPage";

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

function show(r: Rig, o: { store?: RecordStore; section?: MapSection; path?: string } = {}) {
  const page = (
    <SpotProvider>
      <MapPage section={o.section} />
    </SpotProvider>
  );
  return render(
    <MemoryRouter initialEntries={[o.path ?? "/"]}>
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

/** 自分の町の県のホームページを読み込めていない文。1 回目に読めなかった時刻の記録があれば「〇月〇日 〇:〇〇 から」が入る（2026-11-07 案 B） */
const PREF_UNWATCHED = /この県のホームページを(?:、\d+ 月 \d+ 日 \d+:\d{2} から)?読み込めていません。発生がないとは言えません/u;

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

  it("地図の下に固定のリンクが 7 つある。掲示用の貼り紙は入口を外した（2026-11-06 作者の決定）", async () => {
    show(rig());
    await screen.findByTestId("map");
    const nav = screen.getByRole("navigation", { name: "ほかのページ" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/public", "/known", "/trends", "/replay", "/sample", "/results", "/privacy"]);
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
    expect(screen.getByRole("link", { name: TEXT.areaLink }).getAttribute("href")).toBe("/area/33214");
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
    fireEvent.click(screen.getByRole("button", { name: TEXT.pickTown }));
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "33" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "33214" } });
    fireEvent.click(screen.getByRole("button", { name: TEXT.decideTown }));
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(localStorage.getItem(TOWN_KEY)).toBe("33214");
    expect(localStorage.getItem(SPOT_KEY)).toBeNull();
    expect(lastProps().focus?.kind).toBe("rings") /* 町だけの人も町の中心の輪の全体（設計書 2026-11-06-ui-frame 決定 6） */;
    expect(lastProps().focus?.codes).toEqual(["33214"]);
  });

  it("地図の町のタップで選べるのは、選ぶ画面を開いているあいだだけ", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    expect(lastProps().onSelectMuni).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: TEXT.pickTown }));
    expect(lastProps().pickMode).toBe(true);
    expect(lastProps().onSelectMuni).toBeTypeOf("function");
    act(() => lastProps().onSelectMuni!("33214"));
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect(localStorage.getItem(TOWN_KEY)).toBe("33214");
    expect(lastProps().onSelectMuni).toBeUndefined();
    expect(lastProps().pickMode).toBeFalsy();
  });

  it("町を押して事例を見られるのは今季の地図（section now）だけで、場所を選ぶ画面を開いているあいだは選ぶほうが優先", async () => {
    localStorage.setItem(TOWN_KEY, "33643");
    const r = rig();
    show(r, { section: "now" });
    await screen.findByTestId("map");
    r.deliverCases([]);
    expect(lastProps().onInspectMuni).toBeTypeOf("function");
    act(() => lastProps().onInspectMuni!("33203"));
    expect(await screen.findByRole("heading", { level: 2, name: "津山市" })).toBeTruthy();
    // 町を押している間は、自分の町の 1 文を欄に替える（CSS で隠す。DOM には残る）
    expect(document.querySelector(".map-page > .town-cases h2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "選択地域に戻る" }));
    expect(screen.queryByRole("heading", { level: 2, name: "津山市" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TEXT.changeTown }));
    expect(lastProps().onSelectMuni).toBeTypeOf("function");
    expect(lastProps().onInspectMuni).toBeUndefined();
    cleanup();

    // 再現（all）と一覧（season）では押しても欄を出さない。比べ（compare）は 2 つのシーズンの欄を出す（下の試験）
    for (const section of ["all", "season"] as const) {
      seen.length = 0;
      const other = rig();
      show(other, { section });
      await screen.findByTestId("map").catch(() => null);
      if (seen.length) expect(lastProps().onInspectMuni).toBeUndefined();
      expect(document.querySelector(".town-cases")).toBeNull();
      cleanup();
    }
  });

  // 設計書 2026-11-06-data-explore E8、E10、E14（もとは 2026-11-06-ui-frame 4.4 の 2 枚の地図）
  it("過去シーズンとの比べは 1 枚の地図に重ねる。初めは比べる 1 が昨季、比べる 2 が今季。町を押すと 2 つのシーズンの事例が上下に並び、選び直せる", async () => {
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare" });
    await screen.findAllByTestId("map");
    // 今季を読めていない間は塗らない（空の重ね合わせ。1 シーズン分の普通の塗りも出さない）
    expect(lastProps().overlay!.first).toEqual([]);
    expect(lastProps().overlay!.second).toEqual([]);
    expect(screen.getByText(/今季の発生をまだ読めていません/)).toBeTruthy();
    r.deliverCases([]);
    await waitFor(() => expect(lastProps().overlay!.first.length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("map")).toHaveLength(1);
    expect(lastProps().view.season).toBe(2025);
    expect(lastProps().overlay!.show).toBe("both");
    // 津山市は 2025 年シーズンに国の事例一覧の記録がある
    expect(lastProps().overlay!.first).toContain("33203");
    expect(lastProps().ariaLabel).toBe("発生状況の地図（比べる 1: 昨季（2025 年 6 月〜2026 年 5 月） と、比べる 2: 今季（2026 年 6 月〜2027 年 5 月） の重ね合わせ）");
    // 今季を選んでいる間は、確認できていない県を灰色で重ねる（確認の状態が届く前は全県）
    expect(lastProps().overlay!.unwatchedPrefCodes).toHaveLength(47);
    expect(screen.getByText("今季は疑いを含みます")).toBeTruthy();

    act(() => lastProps().onInspectMuni!("33203"));
    expect(await screen.findByRole("heading", { level: 2, name: "津山市" })).toBeTruthy();
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(["比べる 1（2025 年 6 月〜2026 年 5 月）", "比べる 2（2026 年 6 月〜2027 年 5 月）"]);
    const blocks = [...document.querySelectorAll(".cmp-cases-block")];
    expect(blocks[0]!.querySelectorAll("li").length).toBeGreaterThan(0);
    // 今季に記録がない文は、時点の日付で言う（2026-11-06 作者の決定）
    expect(blocks[1]!.querySelector("p")!.textContent).toMatch(/^(\d{4} 年 \d+ 月 \d+ 日 \d+:\d{2} 時点で、)?発生記録はありません。$/);

    // シーズンはボタンで選ぶ（設計書 2026-11-06-data-explore E12）。3 つ目を足すと、最後の発生の色に切り替わり、見せ方のボタンが消える
    const seasonsGroup = () => screen.getByRole("group", { name: CMP_TEXT.seasonsAria });
    const seasonBtn = (y: number) => within(seasonsGroup()).getByRole("button", { name: new RegExp(`${y}〜`) });
    fireEvent.click(seasonBtn(2023));
    await waitFor(() => expect(lastProps().latest!.colors.length).toBeGreaterThan(0));
    expect(lastProps().overlay).toBeNull();
    expect(screen.queryByRole("group", { name: "地図の見せ方" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    // 下のシーズンの棒（一覧と月の件数のシーズン）は、比べるシーズンのボタンとは別。ボタンを押しても棒の選びは昨季のまま
    expect(screen.getByRole("region", { name: "シーズンの切り替え" }).querySelector('[aria-pressed="true"]')!.textContent).toContain("昨季");
    // 棒を押しても、比べるシーズンは黙って替わらない（横断レビューの指摘、11/7）
    fireEvent.click(within(screen.getByRole("region", { name: "シーズンの切り替え" })).getByRole("button", { name: /^今季/ }));
    expect(seasonBtn(2023).getAttribute("aria-pressed")).toBe("true");
    expect(seasonBtn(2025).getAttribute("aria-pressed")).toBe("true");
    expect(seasonBtn(2026).getAttribute("aria-pressed")).toBe("true");
    expect(lastProps().latest!.colors.length).toBeGreaterThan(0);

    // 2025 を外すと 2 つ（2023 と今季）に戻り、重ね合わせ。古い方が比べる 1
    fireEvent.click(seasonBtn(2025));
    await waitFor(() => expect(lastProps().overlay).not.toBeNull());
    expect(screen.getAllByRole("heading", { level: 3 })[0]!.textContent).toBe("比べる 1（2023 年 6 月〜2024 年 5 月）");

    // 過去 2 シーズンどうしでは、確認できていない県を重ねない
    fireEvent.click(seasonBtn(2024));
    fireEvent.click(seasonBtn(2026));
    expect(screen.getAllByRole("heading", { level: 3 })[1]!.textContent).toBe("比べる 2（2024 年 6 月〜2025 年 5 月）");
    await waitFor(() => expect(lastProps().overlay!.unwatchedPrefCodes).toEqual([]));

    // 見せ方の切り替え
    fireEvent.click(within(screen.getByRole("group", { name: "地図の見せ方" })).getByRole("button", { name: "1 だけ" }));
    expect(lastProps().overlay!.show).toBe("one");
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("heading", { level: 2, name: "津山市" })).toBeNull();
  });

  // 設計書 2026-11-06-data-explore E15
  const scope = () => screen.getByRole("group", { name: "地図の広さ" });
  const pressedScope = () => within(scope()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const inChugoku = (codes: readonly string[]) => codes.length > 0 && codes.every((c) => ["31", "32", "33", "34", "35"].includes(c.slice(0, 2)));

  it("比べの地図は地方のボタンで寄せる。押された印は最後に押した 1 つ", async () => {
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare" });
    await screen.findAllByTestId("map");
    expect(pressedScope()).toEqual(["全国"]);
    fireEvent.click(within(scope()).getByRole("button", { name: "中国" }));
    await waitFor(() => expect(lastProps().focus?.kind).toBe("muni"));
    expect(inChugoku(lastProps().focus!.codes)).toBe(true);
    expect(pressedScope()).toEqual(["中国"]);
    fireEvent.click(within(scope()).getByRole("button", { name: "全国" }));
    expect(lastProps().focus?.kind).toBe("japan");
    expect(pressedScope()).toEqual(["全国"]);
  });

  it("?region=chugoku で開くと、地域を選んであっても中国に寄せ、選択地域付近へは動かない", async () => {
    localStorage.setItem(TOWN_KEY, "01100");
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare", path: "/compare?region=chugoku" });
    await screen.findAllByTestId("map");
    await waitFor(() => expect(lastProps().focus?.kind).toBe("muni"));
    expect(inChugoku(lastProps().focus!.codes)).toBe(true);
    r.deliverCases([]);
    await act(async () => {});
    expect(inChugoku(lastProps().focus!.codes)).toBe(true);
    expect(pressedScope()).toEqual(["中国"]);
    // 一度も選択地域付近へ動いていない（中国へ寄せる前に近くへ寄って上書きされた、ではない）
    expect(seen.some((p) => p.focus?.kind === "rings" || (p.focus?.codes.includes("01100") ?? false))).toBe(false);
    // 地域を選んでいるので［選択地域付近］もある。押すとそちらへ
    fireEvent.click(within(scope()).getByRole("button", { name: "選択地域付近" }));
    expect(pressedScope()).toEqual(["選択地域付近"]);
    expect(lastProps().focus!.codes).toEqual(["01100"]);
  });

  it("くわしい場所まで登録した人が ?region=chugoku で開いても、一度も選択地域付近へ動かず中国に寄せる", async () => {
    const c = (indexJson as unknown as Record<string, { center: [number, number] }>)["01100"]!.center;
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(c[1], c[0]), muniCode: "01100", frequentMuniCodes: [] }));
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare", path: "/compare?region=chugoku" });
    await screen.findAllByTestId("map");
    await waitFor(() => expect(lastProps().focus?.kind).toBe("muni"));
    r.deliverCases([]);
    await act(async () => {});
    expect(inChugoku(lastProps().focus!.codes)).toBe(true);
    expect(seen.some((p) => p.focus?.kind === "rings")).toBe(false);
    expect(pressedScope()).toEqual(["中国"]);
  });

  it("町の形が届く前に［全国］を押すと、届いた後も選択地域付近へ寄せ直さない（押された印と寄せ先がずれない）", async () => {
    localStorage.setItem(TOWN_KEY, "01100");
    const geoMod = (await import("../../geo/loadGeo")) as unknown as { __holdGeo(): void; __releaseGeo(): void };
    geoMod.__holdGeo();
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare" });
    await screen.findAllByTestId("map");
    fireEvent.click(within(scope()).getByRole("button", { name: "全国" }));
    await act(async () => geoMod.__releaseGeo());
    r.deliverCases([]);
    await act(async () => {});
    expect(pressedScope()).toEqual(["全国"]);
    expect(lastProps().focus?.kind).toBe("japan");
  });

  it("知らない地方の指定は全国のまま", async () => {
    seen.length = 0;
    const r = rig();
    show(r, { section: "compare", path: "/compare?region=xxx" });
    await screen.findAllByTestId("map");
    r.deliverCases([]);
    await act(async () => {});
    expect(lastProps().focus?.kind ?? "japan").toBe("japan");
    expect(pressedScope()).toEqual(["全国"]);
  });

  it("別の町を選ぶと、前のくわしい場所を消して、そう伝える", async () => {
    const c = (indexJson as unknown as Record<string, { center: [number, number] }>)["33203"]!.center;
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(c[1], c[0]), muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase()]);
    // 町の 1 文が決まると、町の欄が地図の前後で置き直される。置き直した後のボタンを押す
    await screen.findByText(TEXT.myTown, { selector: ".town-name .town-label" });
    await waitFor(() => expect(screen.queryByText(TEXT.loading)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: TEXT.changeTown }));
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
    // 読み取り専用では変えるボタンを出さない。説明は自分の町の欄の名前の行にある
    expect(screen.queryByRole("button", { name: TEXT.changeTown })).toBeNull();
    expect(document.querySelector(".town-name-row")!.textContent).toContain(TEXT.spotFromFarm);
    expect(screen.queryByText(TEXT.pickingBar)).toBeNull();
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
    expect(childNames(above)).toEqual(["h1", "p.as-of", "p.map-notice map-risk", "div.stat-row", "section.town-banner"]);
    // 全県確認なら見回りの行は出さない（2026-11-06 作者の決定）。並びからも外してある
    expect(screen.queryByTestId("watch-line")).toBeNull();
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
    // 地域を選択ボタンは、自分の町の欄の名前の行に 1 つだけ（設計書 2026-11-06-town-picker D1）
    const changes = screen.getAllByRole("button", { name: TEXT.changeTown });
    expect(changes).toHaveLength(1);
    expect(document.querySelector(".town-banner .town-name-row")!.contains(changes[0]!)).toBe(true);
  });

  it("選ぶ間は地図の上に文が出る。やめると消え、地図を押しても町は決まらない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(screen.queryByText(TEXT.loading)).toBeNull());
    expect(screen.queryByText(TEXT.pickingBar)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TEXT.changeTown }));
    const bar = screen.getByText(TEXT.pickingBar);
    expect(before(bar, document.querySelector(".map-box")!)).toBe(true);
    fireEvent.click(within(bar.closest(".picking-bar") as HTMLElement).getByRole("button", { name: TEXT.cancel }));
    expect(screen.queryByText(TEXT.pickingBar)).toBeNull();
    expect(screen.queryByLabelText(TEXT.searchLabel)).toBeNull();
    expect(lastProps().onSelectMuni).toBeUndefined();
  });

  it("選ぶ画面を開いている間に事例が届いて町の欄の置き場が変わっても、入力した文字は消えない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    fireEvent.click(await screen.findByRole("button", { name: TEXT.changeTown }));
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "津山" } });
    r.deliverCases([tsuyamaCase()]);
    expect(await screen.findByText("隣町で発生しました")).toBeTruthy();
    expect((screen.getByLabelText(TEXT.searchLabel) as HTMLInputElement).value).toBe("津山");
  });

  it("town の画面で町を変えられる", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r, { section: "town" });
    r.deliverCases([]);
    fireEvent.click(await screen.findByRole("button", { name: TEXT.changeTown }));
    // 地図がない画面なので、地図を押して選べるとは書かない
    expect(screen.queryByText(TEXT.mapTapHint)).toBeNull();
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "津山" } });
    fireEvent.click(screen.getByRole("button", { name: "岡山県 津山市" }));
    expect(localStorage.getItem(TOWN_KEY)).toBe("33203");
    expect(await screen.findByText("津山市", { selector: ".town-name strong" })).toBeTruthy();
  });

  it("場所があると、選ぶ画面で消えることを前もって伝える", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(screen.queryByText(TEXT.loading)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: TEXT.changeTown }));
    expect(screen.getByText(TEXT.spotWillClear)).toBeTruthy();
    // PC は地図が見えているので、決めても画面を動かさない
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "真庭" } });
    fireEvent.click(screen.getByRole("button", { name: "岡山県 真庭市" }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("切り替えは最初『選択地域付近』で、押すと地図が動き、押された状態が移る", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const near = screen.getByRole("button", { name: TEXT.mapNear });
    const japan = screen.getByRole("button", { name: "全国" });
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings") /* 町だけの人も町の中心の輪の全体（設計書 2026-11-06-ui-frame 決定 6） */);
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
    expect(lastProps().focus?.kind).toBe("rings") /* 町だけの人も町の中心の輪の全体（設計書 2026-11-06-ui-frame 決定 6） */;
    expect(near.getAttribute("aria-pressed")).toBe("true");
  });

  it("町だけの人は、起動時に町へ寄らず、町の形が届いてから輪の広さへ 1 回だけ動く", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
    const aims = [...new Map(seen.filter((p) => p.focus).map((p) => [p.focus!.nonce, p.focus!.kind])).values()];
    expect(aims).toEqual(["rings"]);
  });

  it("地点があれば、最初も『選択地域付近』も輪の全体が入る広さ", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
    expect(lastProps().focus?.codes).toEqual(["33203"]);
    fireEvent.click(screen.getByRole("button", { name: "全国" }));
    // 場所を決めた後は「鶏舎の付近」と呼ぶ（2026-11-07 作者の決定 A）
    expect(screen.queryByRole("button", { name: TEXT.mapNear })).toBeNull();
    // 本人の端末の場所なので、地図に鶏舎の場所の印を描き、凡例にも載せる
    expect(lastProps().markFarm).toBe(true);
    expect(screen.getByRole("list", { name: TEXT.legendAria }).textContent).toContain(TEXT.legendFarm);
    fireEvent.click(screen.getByRole("button", { name: TEXT.mapNearFarm }));
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
    await screen.findByText(PREF_UNWATCHED);
    // 1 回目に読めなかった時刻（2026-11-04T01:00+09:00）を、地図の画面の 1 文にも添える
    expect(screen.getByText("この県のホームページを、11 月 4 日 1:00 から読み込めていません。発生がないとは言えません")).toBeTruthy();
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
    // 全県確認なら行そのものを出さない（2026-11-06 作者の決定）
    expect(screen.queryByTestId("watch-line")).toBeNull();
    r.deliverWatch(failed(["33"]));
    expect(screen.getByTestId("watch-line").textContent).toContain("確認できていません");
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
    await waitFor(() => expect(bannerText()).toMatch(PREF_UNWATCHED));
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
    await waitFor(() => expect(bannerText()).toMatch(PREF_UNWATCHED));
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
    expect(bannerText()).toMatch(PREF_UNWATCHED);
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
    expect(bannerText()).not.toMatch(PREF_UNWATCHED);
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
    expect(bannerText()).not.toMatch(PREF_UNWATCHED);
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
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r, { section: "now" });
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const box = document.querySelector(".map-box")!;
    // 「色がない場所は」の断りはなくなり、60 km 以内に発生がないときの文がその場所に出る（2026-11-06 作者の決定）
    const disclaimer = await screen.findByText(TEXT.nearNone);
    const picker = screen.getByRole("region", { name: TEXT.spotTitle });
    expect(follows(box, disclaimer)).toBe(true);
    expect(follows(disclaimer, picker)).toBe(true);
    expect(disclaimer.className).toBe("map-disclaimer");
    expect(screen.queryByTestId("watch-line")).toBeNull();
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
    r.deliverWatch(failed(["33"])); // 全県確認だと見回りの行が出ないので、1 県を確認できない状態にして位置を見る
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
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await screen.findByText(/まだ決めていません/);
    await waitFor(() => expect(document.querySelector(".town-banner .town-now")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    expect(scrollMock()).toHaveBeenCalledWith({ block: "start" });
    scrollMock().mockClear();
    fireEvent.click(screen.getByRole("button", { name: /昨季/ }));
    expect(scrollMock()).toHaveBeenCalled();
  });

  it("鶏舎の場所の欄は選択地域の行のすぐ下（2026-11-07 作者の決定 A）。ページの下に別の欄はない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(document.querySelector(".town-banner .town-now")).toBeTruthy());
    const spot = document.querySelector(".town-banner .spot-picker")!;
    expect(spot.previousElementSibling?.classList.contains("town-name-row")).toBe(true);
    expect(document.querySelectorAll(".spot-picker")).toHaveLength(1);
  });

  it("合わせている間に町の文の段階が変わって町の欄の置き場が変わる場合でも、欄を作り直さず、［ここに決める］の後の候補が残る", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    // 段階 ①（町の文は地図の前）で合わせ始める
    r.deliverCases([tsuyamaCase({ muniCode: "33214", muniName: "真庭市", stages: { confirmed: { date: "2026-11-02", time: null } } })]);
    await waitFor(() => expect(document.querySelector(".town-banner .town-now")?.getAttribute("data-tone")).toBe("lv1"));
    const spot = () => document.querySelector(".town-banner .spot-picker")!;
    const afterMap = () => Boolean(document.querySelector(".map-box")!.compareDocumentPosition(spot().closest(".town-banner")!) & Node.DOCUMENT_POSITION_FOLLOWING);
    const before = afterMap();
    expect(before).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    await waitFor(() => expect(spot().getAttribute("data-active")).toBe("true"));
    const banner = spot().closest(".town-banner");
    // 合わせている間に段階 ④（ふだんは地図の後ろ）になっても、置き場を動かさない
    r.deliverCases([tsuyamaCase({ prefCode: "46", muniCode: "46201", muniName: "鹿児島市", stages: { confirmed: { date: "2026-11-02", time: null } } })]);
    await waitFor(() => expect(document.querySelector(".town-banner .town-now")?.getAttribute("data-tone")).toBe("lv4"));
    expect(afterMap()).toBe(before);
    expect(spot().closest(".town-banner")).toBe(banner);
    // 十字の下を真庭市にして［ここに決める］。候補を確かめる［決める］が残る（決めた直後に置き場が戻って作り直さない）
    const fake = { getZoom: () => 14, getCenter: () => ({ lat: 35.07, lng: 133.75 }), project: () => ({ x: 0, y: 0 }), queryRenderedFeatures: () => [{ properties: { c: "33214" } }] };
    act(() => lastProps().onMapReady?.(fake as never));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });
    expect(screen.getByRole("button", { name: "決める" })).toBeTruthy();
    expect(afterMap()).toBe(before);
    // 決めたら固定を外し、ふだんの置き場（段階 ④ は地図の後ろ）に戻る
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    await waitFor(() => expect(afterMap()).toBe(true));
  });

  it("町を選んだ人が『地図で場所を合わせる』を押すと、その町へ、そのまま決められる拡大（SPOT_MIN_ZOOM）まで寄せる指定を地図に渡す", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    await waitFor(() => expect(document.querySelector(".town-banner .town-now")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: "地図で場所を合わせる" }));
    await waitFor(() => expect(lastProps().focus?.minZoom).toBe(SPOT_MIN_ZOOM));
    expect(lastProps().focus?.kind).toBe("muni");
    expect(lastProps().focus?.codes).toEqual(["33214"]);
    // ほかの寄せ方（選択地域付近、全国など）には付けない
    fireEvent.click(screen.getByRole("button", { name: TEXT.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "選択地域付近" }));
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
    expect(lastProps().focus?.minZoom).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "全国" }));
    await waitFor(() => expect(lastProps().focus?.kind).toBe("japan"));
    expect(lastProps().focus?.minZoom).toBeUndefined();
  });

  it("地図の部品が読み込めなければ mapLoadFailed を出し、守る文は残る", async () => {
    mapThrows = true;
    localStorage.setItem(TOWN_KEY, "33214");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = rig();
    show(r, { section: "now" });
    r.deliverCases([]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(TEXT.mapLoadFailed);
    expect(alert.className).toBe("map-error");
    expect(await screen.findByText(TEXT.nearNone)).toBeTruthy();
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
  const setSpotForCards = () => localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));

  it("今季を見ているとき 5 枚（地点がなければ約 60km の札と登録した町の札はない）。数字の札は確認中の県と見回りの行より後で、地図より前。PC は過去の札も数字の列に入れる。守る文は地図の直後。残りの札は一覧より後。watch-line は 1 つ", async () => {
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
    expect(row.querySelectorAll(".stat")).toHaveLength(4);
    const box = document.querySelector(".map-box")!;
    expect(follows(row, box)).toBe(true);
    expect(document.querySelector(".map-disclaimer")).toBeNull(); // 町を選んでいないので、付近の断りは出ない（2026-11-06 作者の決定）
    const rest = document.querySelector(".stat-rest")!;
    expect(rest.querySelectorAll(".stat")).toHaveLength(1);
    expect(follows(document.querySelector(".case-list")!, rest)).toBe(true);
    expect(follows(rest, document.querySelector(".season-bar")!)).toBe(true);
    expect(screen.queryByTestId("watch-line")).toBeNull(); // 全県確認なので見回りの行は出ない（2026-11-06 作者の決定）
    expect(follows(screen.getByText(/確認中の発表がある県/), row)).toBe(true);
    expect(follows(row, document.querySelector(".map-attribution")!)).toBe(true);
    expect(screen.queryAllByTestId("watch-line")).toHaveLength(0);
    expect(row.querySelector("[role=status]")).toBeNull();
    expect(row.querySelector(".stat-headline")!.textContent).toBe(TEXT.statHeadline);
    expect(stats()[2]!.textContent).toContain("11 月 4 日 8:30 時点");
  });

  it("再現の全国の流れの PC の札は、再現の出典を添える", async () => {
    const r = rig();
    render(
      <MemoryRouter>
        <DataSourceProvider value={{ ...r.ds, mode: "replay" }}>
          <SpotProvider>
            <MapPage replayStats />
          </SpotProvider>
        </DataSourceProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const when = (selector: string) => document.querySelector(`.stat-row ${selector} .stat-when`)?.textContent;
    await waitFor(() => expect(when(".stat-national")).toBe(TEXT.chartsSourceReplay));
    expect(when(".stat-recent")).toBe(TEXT.chartsSourceReplay);
  });

  it("PC の札は札ごとに出典か断りを添える", async () => {
    setSpotForCards();
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const when = (selector: string) => document.querySelector(`.stat-row ${selector} .stat-when`)?.textContent;
    await waitFor(() => expect(when(".stat-national")).toBe(TEXT.chartsSourceLive));
    // 約 60 km の件数は札の列ではなく町の欄（作者 11/7）。距離が目安だという断りはそちらに添える
    expect(document.querySelector(".stat-row .stat-band")).toBeNull();
    await waitFor(() => expect(document.querySelector(".town-banner .farm-band")?.textContent).toContain(TEXT.statBandWhen));
    expect(when(".stat-recent")).toBe(TEXT.chartsSourceLive);
    expect(when(".stat-past")).toBe(TEXT.chartsSourceReplay);
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

  it("PC でも一部未確認の数字を分ける。札の断り（.stat-qual、PC の CSS で隠す）の代わりに、札の上の 1 文が必ず出る", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase({ stages: { confirmed: { date: "2026-11-02", time: null } } })]);
    r.deliverWatch(failed(["33"]));
    const value = stats()[0]!.querySelector(".stat-value")!;
    expect(value.textContent).toBe("確認できた範囲では 1 件（1 県は確認できていません）");
    expect(value.querySelector(".stat-num")!.textContent).toBe("1");
    expect([...value.querySelectorAll(".stat-qual")].map((e) => e.textContent)).toEqual(["確認できた範囲では ", "（1 県は確認できていません）"]);
    // 件数だけが読まれないよう、札が一部未確認の数を出す間は、札の上（札の行より前）にまとめの 1 文がある（2026-11-06 作者の決定）
    const wide = document.querySelector(".stat-unchecked-wide")!;
    expect(wide.textContent).toBe("確認できた範囲の件数です。岡山県は確認できていません。");
    expect([...wide.querySelectorAll(".stat-sentence")].map((e) => e.textContent)).toEqual(["確認できた範囲の件数です。", "岡山県は確認できていません。"]);
    expect(follows(wide, document.querySelector(".stat-row")!)).toBe(true);
    expect(document.querySelector(".stat-unchecked")).toBeNull();
  });

  it("PC: 全県を確認できた朝は、札の上のまとめの 1 文を出さない。過去の札の題の日付は 1 つの塊", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(failed([]));
    await waitFor(() => expect(document.querySelector(".stat-row")).not.toBeNull());
    expect(document.querySelector(".stat-unchecked-wide")).toBeNull();
    await waitFor(() => expect(document.querySelector(".stat-past .stat-date")).not.toBeNull());
    expect(document.querySelector(".stat-past .stat-date")!.textContent).toMatch(/^\d+ 月 \d+ 日$/);
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

  it("地点があっても札の列の先頭は全国の件数（約 60 km は町の欄へ移した）。町が分からない発表の断りは町の欄の件数に添える", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase({ muniCode: null, muniName: null })]);
    await waitFor(() => expect(titles()[0]).toBe("発生した件数"));
    const band = () => document.querySelector(".town-banner .farm-band")?.textContent;
    await waitFor(() => expect(band()).toContain(TEXT.statBandUnplaced(1)));
    expect(band()).toContain(TEXT.statBandRelated);
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
    // 十字合わせ中も 2 列のまま。場所の欄は町の欄の中で、町の欄は右の列（地図の隣）にある（2026-11-07 作者の決定 A）
    expect(body).not.toMatch(/spot-picker/);
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
  // 鶏舎から約 60 km 以内の件数は、町の欄の鶏舎の場所のすぐ下にまとめる（2026-11-07 作者の決定 A）
  const bandCard = () => (document.querySelector<HTMLElement>(".town-banner .farm-band") ?? undefined);
  const bandText = () => bandCard()!.textContent ?? "";
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

    it("町だけを選んだときは、町の中心を輪の中心に渡し、町の中心の断りを出す（設計書 2026-11-06-ui-frame 決定 6）", async () => {
      localStorage.setItem(TOWN_KEY, "33203");
      const r = rig();
      show(r, { section: "now" });
      await screen.findByTestId("map");
      r.deliverCases([]);
      expect(lastProps().farmMeshCode).toBeNull();
      const center = (indexJson as unknown as Record<string, { center: [number, number] }>)["33203"]!.center;
      await waitFor(() => expect(lastProps().ringCenter).toEqual(center));
      expect(screen.queryByText(TEXT.ringNote)).toBeNull();
      // 60 km 以内に今季の発生がないので、付近の文（.map-disclaimer）の次に輪の断りが並ぶ
      expect(screen.getByText(TEXT.ringNoteTown).previousElementSibling?.className).toBe("map-disclaimer");
      expect(screen.getByText(TEXT.nearNone).className).toBe("map-disclaimer");
    });

    describe("付近に発生がないときの文（nearNone）", () => {
      const nearNone = () => screen.queryByText(TEXT.nearNone);

      it("町だけ選んで、60 km 以内に今季の事例が 0 件なら出る。全国を押すと消え、付近に戻すと出る", async () => {
        localStorage.setItem(TOWN_KEY, "33214");
        const r = rig();
        show(r, { section: "now" });
        await screen.findByTestId("map");
        // 北海道の事例は真庭市から約 60 km より遠い
        r.deliverCases([tsuyamaCase({ id: "far", prefCode: "01", muniCode: "01100", muniName: "札幌市" })]);
        r.deliverWatch(okWatch());
        expect(await screen.findByText(TEXT.nearNone)).toBeTruthy();
        expect(screen.getByText(TEXT.nearNone).className).toBe("map-disclaimer");
        fireEvent.click(screen.getByRole("button", { name: "全国" }));
        expect(lastProps().focus?.kind).toBe("japan");
        expect(nearNone()).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: TEXT.mapNear }));
        expect(await screen.findByText(TEXT.nearNone)).toBeTruthy();
      });

      it("60 km 以内に今季の事例が 1 件あれば出ない", async () => {
        localStorage.setItem(TOWN_KEY, "33214");
        const r = rig();
        show(r, { section: "now" });
        await screen.findByTestId("map");
        r.deliverCases([tsuyamaCase({ id: "near" })]);
        r.deliverWatch(okWatch());
        await waitFor(() => expect(lastProps().focus?.kind).toBe("rings"));
        expect(nearNone()).toBeNull();
        expect(document.querySelector(".map-disclaimer")).toBeNull();
      });

      it("今季の事例がまだ読めていない間は出さない（0 件と言えない）", async () => {
        localStorage.setItem(TOWN_KEY, "33214");
        const r = rig();
        show(r, { section: "now" });
        await screen.findByTestId("map");
        expect(nearNone()).toBeNull();
      });
    });

    it("地点も町もあれば、輪は地点から。町の中心は渡さず、断りは地点の文だけ", async () => {
      setSpot();
      localStorage.setItem(TOWN_KEY, "33203");
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverCases([]);
      expect(lastProps().farmMeshCode).toBe(FARM_MESH);
      expect(lastProps().ringCenter ?? null).toBeNull();
      expect(screen.getByText(TEXT.ringNote)).toBeTruthy();
      expect(screen.queryByText(TEXT.ringNoteTown)).toBeNull();
    });

    it("地点があれば、マス目を地図に渡し、断りを色がない場所の断りのすぐ後に出す", async () => {
      setSpot();
      const r = rig();
      show(r, { section: "now" });
      await screen.findByTestId("map");
      r.deliverCases([]);
      r.deliverWatch(okWatch());
      expect(lastProps().farmMeshCode).toBe(FARM_MESH);
      const note = await screen.findByText(TEXT.ringNote);
      expect(note.className).toBe("map-ring-note");
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
      await waitFor(() => expect(bandText()).toMatch(/過去 6 シーズン \d+ 件/));
      expect(bandText()).toContain(TEXT.statBandRelated);
      expect(bandText()).toContain("鶏舎から約 60 km 以内");
      // 鶏舎の場所の欄のすぐ下。地図の上の札の列には出さない
      expect(bandCard()!.previousElementSibling?.classList.contains("spot-picker")).toBe(true);
      expect(document.querySelector(".stat-row")!.textContent).not.toContain("60 km");
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
      expect(bandText()).toContain("過去 6 シーズン まだ読めていません");
      await act(async () => {
        r.historyDeferred.reject(new Error("読めない"));
      });
      expect(bandText()).toContain("過去 6 シーズン 読めませんでした");
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

    it("約 60km の今季が 0 件で、札の前に守る文がなければ、件数のすぐ前に出す（町の文からは外して 2 度書かない）", async () => {
      localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: FARM_MESH, muniCode: "33203", frequentMuniCodes: ["01100"] }));
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ prefCode: "01", muniCode: "01100", muniName: "札幌市", stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 0 件"));
      expect(recentValue()).toBe("1 件");
      const risk = bandCard()!.querySelector(".town-note")!;
      expect(risk.textContent).toBe(FIXED_TEXT.riskAnywhere);
      expect(risk.nextElementSibling?.textContent).toContain("今季 0 件");
      const banner = bandCard()!.closest(".town-banner")!;
      expect(banner.textContent!.split(FIXED_TEXT.riskAnywhere).length - 1).toBe(1);
    });

    it("過去の記録がない町で約 60 km の今季が 0 件でも、守る文は町の欄に 1 回だけ（件数のすぐ前）。ページの下の図にも重ねない", async () => {
      localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: latLngToMesh3(44.02, 145.19), muniCode: "01694", frequentMuniCodes: ["01100"] }));
      const r = rig();
      show(r);
      await screen.findByTestId("map");
      r.deliverWatch(okWatch());
      r.deliverCases([tsuyamaCase({ prefCode: "01", muniCode: "01100", muniName: "札幌市", stages: onDate("2026-11-02") })]);
      await waitFor(() => expect(bandCard()!.textContent).toContain("今季 0 件"));
      await waitFor(() => expect(document.querySelector(".town-past")).toBeTruthy());
      const risks = [...document.querySelectorAll("p")].filter((e) => e.textContent === FIXED_TEXT.riskAnywhere);
      expect(risks).toHaveLength(1);
      expect(risks[0]!.closest(".farm-band")).toBeTruthy();
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

    it("地図の下の残りの札に、町ごとの今季の件数を出す。数えない事例は入れない", async () => {
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
      expect(frequentCard()!.parentElement?.classList.contains("stat-below")).toBe(true);
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
      await waitFor(() => expect(bandText()).toMatch(/過去 6 シーズン \d+ 件/));
      const n = Number(bandText().match(/過去 6 シーズン (\d+) 件/)![1]);
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
      TEXT.statBandWhen,
      TEXT.nearUnmarkedLead,
      TEXT.nearUnmarkedReviewing,
      TEXT.nearUnmarkedUnplaced(1),
      TEXT.nearUnmarkedMore(2),
      TEXT.nearUnmarkedJapan,
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

  it("スマホでは自分の町を決めた後に地図の上端へ戻す", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    fireEvent.click(await screen.findByRole("button", { name: TEXT.changeTown }));
    scroll.mockClear();
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "津山" } });
    fireEvent.click(screen.getByRole("button", { name: "岡山県 津山市" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(scroll.mock.contexts.at(-1)).toBe(document.querySelector(".map-box"));
  });

  it("スマホでも、町の欄の約 60 km の件数は見出し（今季、過去 6 シーズン）を隠す部品（.stat-long）を使わない", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([]);
    const band = await waitFor(() => document.querySelector<HTMLElement>(".town-banner .farm-band")!);
    await waitFor(() => expect(band.textContent).toMatch(/過去 6 シーズン/));
    expect(band.querySelector(".stat-long")).toBeNull();
    expect(band.textContent).toContain("今季 0 件");
  });

  it("スマホでも、町が分からない発表と読めない断りは町の欄の約 60 km の件数に出る", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    const r = rig({ history: "deferred" });
    show(r);
    await screen.findByTestId("map");
    r.deliverWatch(okWatch());
    r.deliverCases([tsuyamaCase({ muniCode: null, muniName: null })]);
    const more = () => document.querySelector(".town-banner .farm-band")?.textContent;
    await waitFor(() => expect(more()).toContain(TEXT.statBandUnplaced(1)));
    await act(async () => {
      r.historyDeferred.reject(new Error("読めない"));
    });
    expect(more()).toContain(TEXT.statFailedNote);
  });

  it("スマホは数字の列が 3 枚、過去と野鳥は一覧より後の残りの札", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const row = document.querySelector(".stat-row")!;
    expect(row.querySelectorAll(".stat")).toHaveLength(3);
    expect(row.querySelector(".stat-when")).toBeNull();
    const rest = document.querySelector(".stat-rest")!;
    expect(rest.querySelectorAll(".stat")).toHaveLength(2);
    expect(rest.textContent).toContain("過去 6 シーズンの 11 月 4 日まで");
    expect(before(document.querySelector(".case-list")!, rest)).toBe(true);
    expect(row.querySelector(".stat-time")!.textContent).toContain("11 月 4 日 8:30 時点");
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
    // 全県確認なので見回りの行は出ない（2026-11-06 作者の決定）。地図の下の位置の確かめは、出る条件の試験（確認状況）が受け持つ
    expect(screen.queryAllByTestId("watch-line")).toHaveLength(0);
  });

  it("選択地域付近: 確認中の県と町の分からない発表を、地図の下の端の 1 行に出す。『全国で見る』で全国へ。全国の広さでは出さない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([
      tsuyamaCase({ id: "rev-1", prefCode: "28", muniCode: null, muniName: null, headCount: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.invalid/r"] }),
      tsuyamaCase({ id: "u-1", prefCode: "31", muniCode: null, muniName: null }),
      tsuyamaCase({ id: "c-1" }),
    ]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings") /* 町だけの人も町の中心の輪の全体（設計書 2026-11-06-ui-frame 決定 6） */);
    const line = await waitFor(() => document.querySelector(".map-box .near-unmarked")!);
    // 県の並びは都道府県の順。町の分かる発表（津山市）は地図に塗られるので出さない
    expect(line.querySelector("p")!.textContent).toBe("地図に印のない発表: 兵庫県 確認中、鳥取県 1 件（町名なし）");
    expect(line.textContent).not.toContain("範囲の外");
    fireEvent.click(within(line as HTMLElement).getByRole("button", { name: "全国で見る" }));
    expect(lastProps().focus?.kind).toBe("japan");
    expect(document.querySelector(".near-unmarked")).toBeNull();
  });

  it("選択地域付近: 印のない発表がなければ、1 行を出さない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([tsuyamaCase({ id: "c-1" })]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(lastProps().focus?.kind).toBe("rings") /* 町だけの人も町の中心の輪の全体（設計書 2026-11-06-ui-frame 決定 6） */);
    expect(document.querySelector(".near-unmarked")).toBeNull();
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
    const main = await screen.findByText(PREF_UNWATCHED);
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

describe("MapPage: 見せるまとまり（設計書 2026-11-06-ui-frame 4 章）", () => {
  const has = (sel: string) => document.querySelector(sel) !== null;
  it("now（/）は題、札、地図、町の文と次の画面へのリンク。一覧、シーズンの棒、比べ、月の表、ほかのページのリンクは出さない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r, { section: "now" });
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(has(".stat-row")).toBe(true));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("今季の発生状況");
    expect(has(".map-box")).toBe(true);
    expect(has(".case-list")).toBe(false);
    expect(has(".season-bar")).toBe(false);
    expect(has(".season-compare")).toBe(false);
    expect(has(".month-bars")).toBe(false);
    expect(has(".map-links")).toBe(false);
    const next = within(screen.getByRole("navigation", { name: "次の画面" })).getAllByRole("link");
    expect(next.map((a) => a.getAttribute("href"))).toEqual(["/town", "/season", "/compare"]);
  });

  it("town は町の文を全部（過去の行のくわしい部分を含む）出し、地図と札は出さない", async () => {
    localStorage.setItem(TOWN_KEY, "33214");
    const r = rig();
    show(r, { section: "town" });
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(has(".town-banner")).toBe(true));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("選択地域の過去");
    expect(has(".map-box")).toBe(false);
    expect(has(".stat-row")).toBe(false);
    expect(has(".town-area-link")).toBe(true);
  });

  it("season は一覧と月の表を出し、地図と比べは出さない", async () => {
    const r = rig();
    show(r, { section: "season" });
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(has(".case-list")).toBe(true));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("今季の一覧と数");
    expect(has(".month-bars")).toBe(true);
    expect(has(".map-box")).toBe(false);
    expect(has(".season-compare")).toBe(false);
  });

  it("compare はシーズンの棒と比べ、選んだシーズンの地図と一覧を出す（段階 3 の 2 枚の地図までのつなぎ）。町の文と場所の設定は出さない", async () => {
    const r = rig();
    show(r, { section: "compare" });
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    await waitFor(() => expect(has(".season-bar")).toBe(true));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("過去シーズンとの比べ");
    expect(has(".season-compare")).toBe(true);
    expect(has(".map-box")).toBe(true);
    expect(has(".case-list")).toBe(true);
    expect(has(".town-banner")).toBe(false);
    expect(has(".spot-picker")).toBe(false);
    expect(has(".stat-row")).toBe(false);
  });
});

