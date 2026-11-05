import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import { createGeoStore } from "@hpai/shared/geo";
import { describePast } from "@hpai/shared/past";
import { PREFS } from "@hpai/shared/pref";
import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import historyJson from "../../../../data/history/cases.json";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { loadWebGeoStore } from "../../geo/loadGeo";
import type { DataSource, RecordStore } from "../../data/types";
import { TEXT } from "../map/texts";
import AreaPage from "./AreaPage";

// 市町村の形の読み込みは fetch を使うので、jsdom では実データを fs から読む偽に替える
vi.mock("../../geo/loadGeo", () => {
  const store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) =>
      JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  return {
    loadWebGeoStore: vi.fn(() => Promise.resolve(store)),
    loadJapanTopo: () => Promise.reject(new Error("unused")),
    loadPrefAnchors: () => Promise.reject(new Error("unused")),
  };
});

// 計算が落ちる場合を作るため、必要なときだけ computeAreaStatus を投げる偽にできるようにする
const levelFlag = vi.hoisted(() => ({ throwOnce: false }));
vi.mock("@hpai/shared/level", async (orig) => {
  const mod = await orig<typeof import("@hpai/shared/level")>();
  return {
    ...mod,
    computeAreaStatus: ((...a: Parameters<typeof mod.computeAreaStatus>) => {
      if (levelFlag.throwOnce) throw new Error("broken");
      return mod.computeAreaStatus(...a);
    }) as typeof mod.computeAreaStatus,
  };
});

const history = historyJson as HistoryCase[];
const NOW = new Date("2026-11-04T09:00:00+09:00"); // 今季は 2026

function mkCase(o: Partial<Case> & { id: string }): Case {
  return {
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
    sourceUrls: ["https://example.invalid/case"],
    updatedAt: "2026-11-02T12:00:00+09:00",
    ...o,
  };
}

interface Rig {
  ds: DataSource;
  deliverCases(rows: Case[]): void;
  deliverWatch(rows: WatchStatus[]): void;
}

function rig(): Rig {
  let casesCb: ((c: Case[]) => void) | null = null;
  let watchCb: ((w: WatchStatus[]) => void) | null = null;
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
    loadHistory: () => Promise.resolve(history),
  };
  return { ds, deliverCases: (rows) => act(() => casesCb!(rows)), deliverWatch: (rows) => act(() => watchCb!(rows)) };
}

function show(r: Rig, code: string, store?: RecordStore) {
  const page = (
    <Routes>
      <Route path="/area/:muniCode" element={<AreaPage />} />
    </Routes>
  );
  return render(
    <MemoryRouter initialEntries={[`/area/${code}`]}>
      <DataSourceProvider value={r.ds}>{store ? <RecordStoreProvider value={store}>{page}</RecordStoreProvider> : page}</DataSourceProvider>
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

const tone = () => document.querySelector("[data-tone]")?.getAttribute("data-tone");
const bodyText = () => document.body.textContent ?? "";
/** 発生が 0 件、発生はありません、と読める言い方（見回りの「0 件は確認できていません」は別） */
const ZERO_CLAIM = /(発生|事例|報告)[^。（]{0,8}[^0-9]0 件|0 件の(発生|事例)|発生はありません|報告はありません/u;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AreaPage（/area/{市町村コード}）", () => {
  it("今季の事例が届くまでは『読み込んでいます』。0 件とも、距離の説明とも、段階の文とも出さない", async () => {
    show(rig(), "33214");
    await screen.findByText("真庭市の状況");
    expect(bodyText()).toContain(TEXT.loading);
    expect(bodyText()).not.toMatch(ZERO_CLAIM);
    expect(bodyText()).not.toContain(FIXED_TEXT.riskAnywhere);
    expect(bodyText()).not.toContain(FIXED_TEXT.areaNoDistance);
    expect(document.querySelector("[data-tone]")).toBeNull();
  });

  it("読み込み中の文は state-wait（role=status）。town-now-wait は使わない", async () => {
    show(rig(), "33214");
    await screen.findByText("真庭市の状況");
    const p = screen.getByText(TEXT.loading);
    expect(p.className).toBe("state-wait");
    expect(p.getAttribute("role")).toBe("status");
    expect(document.querySelector(".town-now-wait")).toBeNull();
  });

  it("壊れた記録で計算が落ちたときの文は state-unknown（role=alert）。town-now-wait は使わない", async () => {
    const r = rig();
    show(r, "33214");
    await screen.findByText("真庭市の状況");
    levelFlag.throwOnce = true;
    try {
      r.deliverCases([mkCase({ id: "c1", muniCode: "33214" })]);
      const p = await screen.findByRole("alert");
      expect(p.className).toBe("state-unknown");
      expect(p.textContent).toBe(TEXT.loadFailed);
      expect(document.querySelector(".town-now-wait")).toBeNull();
    } finally {
      levelFlag.throwOnce = false;
    }
  });

  it("段階 1（同じ町）: 『この町で発生しました』。areaNoDistance と riskAnywhere を必ず出す（契約 8）", async () => {
    const r = rig();
    show(r, "33203");
    await screen.findByText("津山市の状況");
    r.deliverCases([mkCase({ id: "c1" })]);
    await screen.findByText(TEXT.areaSame);
    expect(tone()).toBe("lv1");
    expect(bodyText()).toContain("津山市で確定（11 月 2 日）");
    expect(bodyText()).toContain(FIXED_TEXT.areaNoDistance);
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
    expect(bodyText()).not.toContain("区域に入っています");
    expect(findForbiddenPhrases(bodyText())).toEqual([]);
  });

  it("段階 2（隣町）: 『隣町で発生しました』。areaNoDistance と riskAnywhere を必ず出す", async () => {
    const r = rig();
    show(r, "33214");
    await screen.findByText("真庭市の状況");
    r.deliverCases([mkCase({ id: "c1" })]);
    await screen.findByText(TEXT.adjacent);
    expect(tone()).toBe("lv2");
    expect(bodyText()).toContain(FIXED_TEXT.areaNoDistance);
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
    expect(findForbiddenPhrases(bodyText())).toEqual([]);
  });

  it("段階 4（全国の動き）: 事例が遠くでも areaNoDistance と riskAnywhere を出す。『0 件』と見せない", async () => {
    const r = rig();
    show(r, "33214");
    await screen.findByText("真庭市の状況");
    r.deliverWatch(okWatch());
    r.deliverCases([mkCase({ id: "far", prefCode: "01", muniCode: "01100", muniName: "札幌市" })]);
    await screen.findByText(TEXT.national);
    expect(tone()).toBe("lv4");
    expect(bodyText()).toContain(FIXED_TEXT.areaNoDistance);
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
    expect(bodyText()).not.toMatch(ZERO_CLAIM);
    expect(findForbiddenPhrases(bodyText())).toEqual([]);
  });

  it("移動制限の解除の後の同じ市町村は sameMuniLifted。『隣町』と書かない（契約 2.4）", async () => {
    const r = rig();
    show(r, "33203");
    await screen.findByText("津山市の状況");
    r.deliverCases([mkCase({ id: "c1", stages: { confirmed: { date: "2026-11-02", time: null }, movement_lifted: { date: "2026-11-20", time: null } } })]);
    await screen.findByText(FIXED_TEXT.sameMuniLifted);
    expect(tone()).toBe("lv2");
    expect(document.querySelector("[data-tone]")!.textContent).not.toContain("隣町"); // 過去の行の「隣町」は別
    expect(bodyText()).toContain(FIXED_TEXT.areaNoDistance);
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("過去の 1 文（記録）と、過去の発生の一覧に出典の注意書きが付く", async () => {
    const r = rig();
    show(r, "33203");
    r.deliverCases([]);
    const geo = await loadWebGeoStore();
    const expected = describePast("33203", history, geo, 2026).sentence;
    await screen.findByText(new RegExp(expected.replace(/[()（）]/gu, "\\$&")));
    expect(bodyText()).toContain(FIXED_TEXT.pastDisclaimer);
  });

  it("周辺の町の過去の発生: 近い順の表で、中心どうしの距離と分かる。関連農場を除く。畳まない。段階の色の外", async () => {
    const r = rig();
    show(r, "33214");
    r.deliverCases([]);
    const table = await screen.findByRole("table", { name: TEXT.nearbyAria });
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows.length).toBeGreaterThan(0);
    const box = table.closest(".nearby-past")!;
    expect(box.closest("details")).toBeNull();
    expect(box.closest("[data-tone]")).toBeNull();
    expect(box.textContent).toContain(TEXT.nearbyBasisCenter);
    expect(box.textContent).toContain(TEXT.statBandRelated);
    for (const tr of rows) expect(tr.querySelector('td[data-label="距離"]')!.textContent).toMatch(/^(この町|約 \d+ km|約 1 km 未満)$/u);
    const kms = rows.flatMap((tr) => tr.querySelector('td[data-label="距離"]')!.textContent!.match(/約 (\d+) km$/u)?.[1] ?? []).map(Number);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    const seasons = [2025, 2024, 2023, 2022, 2021, 2020];
    const main = history.filter((h) => !h.related && seasons.includes(h.season));
    const small = main.filter((h) => h.headCount !== null && h.headCount < 3000).length;
    expect(bodyText()).toContain(TEXT.smallFlocks(6, main.length, main.filter((h) => h.headCount !== null).length, small));
    expect(findForbiddenPhrases(bodyText())).toEqual([]);
    // 既存の『この町』『隣町』の 1 文と一覧は残る
    expect(document.querySelector(".past-details")).toBeTruthy();
    expect(bodyText()).toContain(FIXED_TEXT.pastDisclaimer);
  });

  it("周辺に記録がない町: 表を出さず、記録にないと書く。事例が届くまで riskAnywhere を出さず、届いたら 1 つだけ", async () => {
    const r = rig();
    show(r, "13421"); // 小笠原村（約 60km 以内に過去の発生の記録がない町）
    await screen.findByText(new RegExp(TEXT.nearbyNone(60, 6).replace(/[()（）]/gu, "\\$&")));
    expect(screen.queryByRole("table")).toBeNull();
    expect(bodyText()).not.toContain(FIXED_TEXT.riskAnywhere);
    expect(bodyText()).not.toMatch(/[^0-9]0 件/u); // 既存の過去の 1 文（PAST_NONE）は「記録」と書いた文として残る
    r.deliverWatch(okWatch());
    r.deliverCases([]);
    await screen.findByText(TEXT.national);
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
    expect(findForbiddenPhrases(bodyText())).toEqual([]);
  });

  it("過去の記録が読めない間は 0 件の表を出さない。読めなければ失敗の文だけ", async () => {
    const r = rig();
    let reject = (_: Error) => {};
    r.ds.loadHistory = () => new Promise((_res, rej) => (reject = rej));
    show(r, "33214");
    r.deliverCases([]);
    await screen.findByText(TEXT.pastLoading);
    expect(screen.queryByRole("table")).toBeNull();
    expect(bodyText()).not.toMatch(ZERO_CLAIM);
    act(() => reject(new Error("offline")));
    await screen.findByText(TEXT.pastFailed);
    expect(screen.queryByRole("table")).toBeNull();
    expect(bodyText()).not.toContain(TEXT.nearbyFailed);
    expect(bodyText()).not.toMatch(ZERO_CLAIM);
  });

  it("全県が未確認でも、過去の表は記録として出る（今季の未確認の文と両方）", async () => {
    const r = rig();
    show(r, "33214");
    r.deliverCases([]);
    await screen.findByText(TEXT.prefUnwatched);
    await screen.findByRole("table", { name: TEXT.nearbyAria });
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("本文に、7 つの要点への /public#topic のリンクがある（§11）", async () => {
    const r = rig();
    show(r, "33214");
    r.deliverWatch(okWatch());
    r.deliverCases([]);
    await screen.findByText(TEXT.national);
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/public#"));
    expect(links).toEqual(OFFICIAL_GUIDANCE.map((g) => `/public#${g.topic}`));
    for (const g of OFFICIAL_GUIDANCE) expect(screen.getByRole("link", { name: g.heading })).toBeTruthy();
  });

  it("農場の記録の口（useRecordStore）を使わず、本文に meshCode がない", async () => {
    const store = new Proxy({} as RecordStore, {
      get: (_t, p) => {
        throw new Error(`RecordStore の ${String(p)} を呼んではいけません`);
      },
    });
    const r = rig();
    show(r, "33203", store);
    r.deliverCases([mkCase({ id: "c1" })]);
    await screen.findByText(TEXT.areaSame);
    expect(bodyText()).not.toMatch(/\d{8}/u);
    expect(localStorage.length).toBe(0); // 端末内の地点も読まない
  });

  it("未知のコードと、区のコード（33101）は『この市町村は見つかりません』。段階の文を出さない", async () => {
    for (const code of ["99999", "33101", "abc", "constructor", "toString", "__proto__"]) {
      const r = rig();
      const { unmount } = show(r, code);
      r.deliverCases([mkCase({ id: "c1" })]);
      await screen.findByText("この市町村は見つかりません");
      expect(document.querySelector("[data-tone]"), code).toBeNull();
      expect(bodyText(), code).not.toContain(FIXED_TEXT.riskAnywhere);
      expect(screen.getByRole("link", { name: /地図/ }).getAttribute("href")).toBe("/");
      unmount();
    }
  });

  it("市町村の形を読めなかったら、段階の文を出さずに『読めませんでした』", async () => {
    vi.mocked(loadWebGeoStore).mockRejectedValueOnce(new Error("offline"));
    const r = rig();
    show(r, "33214");
    r.deliverCases([]);
    await screen.findAllByRole("alert");
    expect(bodyText()).toContain("読めませんでした");
    expect(document.querySelector("[data-tone]")).toBeNull();
    expect(bodyText()).not.toContain("この市町村は見つかりません");
  });

  it("見回りの結果が届くまでは確認できていない扱い。届くと時点と確認状況が出る", async () => {
    const r = rig();
    show(r, "33214");
    r.deliverCases([]);
    await screen.findByText(TEXT.prefUnwatched); // 見回りが未着の間は、④（全国の動き）にしない
    expect(bodyText()).toContain(TEXT.watchNotLoaded);
    r.deliverWatch(okWatch());
    await screen.findByText(TEXT.national);
    await waitFor(() => expect(bodyText()).toContain("11 月 4 日 8:30 時点"));
    expect(screen.getByTestId("watch-line").textContent).toContain("47 都道府県のうち 47 件を確認");
  });

  it("この町の県が見回りで確認できていないときは、それを 1 文に足す（④だけで済ませない）", async () => {
    const r = rig();
    show(r, "33214");
    r.deliverCases([]);
    r.deliverWatch(okWatch().map((w) => (w.prefCode === "33" ? { ...w, ok: false, lastOkAt: null } : w)));
    await screen.findByText(TEXT.prefUnwatched);
    expect(tone()).toBe("none");
    expect(bodyText()).toContain(FIXED_TEXT.areaNoDistance);
    expect(bodyText()).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("県の連絡が正であることと、出典のリンクが出る。農場の情報は出さない", async () => {
    const r = rig();
    show(r, "33203");
    r.deliverCases([mkCase({ id: "c1", headCount: 123456, birdUse: "採卵鶏" })]);
    await screen.findByText(TEXT.areaSame);
    expect(bodyText()).toContain(FIXED_TEXT.prefContactIsAuthority);
    expect(screen.getAllByRole("link", { name: "出典" }).map((a) => a.getAttribute("href"))).toContain("https://example.invalid/case");
    expect(bodyText()).not.toContain("123456");
    expect(bodyText()).not.toContain("採卵鶏");
  });
});
