// M-03: やること画面、解除の見込みの表示、消毒の記録。実データの市町村（津山市 33203 など）で段階を確かめる。
import { createGeoStore, GeoNotLoadedError, type GeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { Case, CheckRecord, Farm, FarmPoint, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource, RecordStore } from "../../data/types";
import { DisinfectionPanel } from "../record/DisinfectionPanel";
import { SURVEILLANCE_NOTE } from "../map/texts";
import { TODO_TEXT } from "./texts";
import { resolveTodo } from "./todoModel";

// 県の形の読み込みは fetch を使うので、jsdom では実データを fs から読む。試験ごとに作り直し、未読み込み（冷えた状態）から始める
const geoBox = vi.hoisted(() => ({ store: null as unknown, fail: false }));
vi.mock("../../geo/loadGeo", () => ({
  loadWebGeoStore: () => (geoBox.fail ? Promise.reject(new Error("読めません")) : Promise.resolve(geoBox.store)),
}));

const authState = vi.hoisted(() => ({
  value: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} } as {
    user: { uid: string } | null;
    member: boolean;
    loading: boolean;
    error: boolean;
    refresh(): Promise<void>;
  },
}));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => authState.value }));

import TodoPage from "./TodoPage";

const dataDir = (...p: string[]) => path.resolve(import.meta.dirname, "../../../../data/geo", ...p);
function freshGeo(): GeoStore {
  return createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => JSON.parse(readFileSync(dataDir("pref", `${p}.topo.json`), "utf8")) as unknown,
  });
}

const NOW = new Date("2026-01-05T09:00:00+09:00"); // 今季は 2025
const TODAY = "2026-01-05";
const SPOT: FarmPoint = { meshCode: latLngToMesh3(35.146, 133.995), muniCode: "33203", frequentMuniCodes: [] };

function mkCase(o: Partial<Case> & { id: string }): Case {
  return {
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: (o.muniCode ?? "33203").slice(0, 2),
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/a"],
    updatedAt: "2025-12-20T12:00:00+09:00",
    ...o,
  };
}
const stage = (date: string) => ({ date, time: null });

const okWatch = (): WatchStatus[] =>
  PREFS.map((p) => ({ prefCode: p.code, checkedAt: "2026-01-05T08:30:00+09:00", ok: true, lastOkAt: "2026-01-05T08:30:00+09:00", failingSince: null }));

function makeDs(opts: { cases?: Case[] | null; watch?: WatchStatus[] } = {}): DataSource {
  const cases = opts.cases === undefined ? [] : opts.cases;
  const watch = opts.watch ?? okWatch();
  return {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => {
      if (cases !== null) cb(cases);
      return () => {};
    },
    subscribeWildBirds: (_s, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWatchStatus: (cb) => {
      cb(watch);
      return () => {};
    },
    loadHistory: async () => [],
  };
}

function farmFixture(o: Partial<Farm> = {}): Farm & { id: string } {
  return {
    id: "f1",
    name: "見本農場",
    memberUids: ["u1"],
    unsubscribedUids: [],
    meshCode: SPOT.meshCode,
    muniCode: "33203",
    prefCode: "33",
    frequentMuniCodes: [],
    production: null,
    housing: null,
    kahoContact: "",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {},
    updatedAt: "2025-12-01T10:00:00+09:00",
    ...o,
  };
}

let farm: (Farm & { id: string }) | null;
let getFarmFails = false;
const saveCheck = vi.fn<(c: CheckRecord) => Promise<void>>();
const listChecks = vi.fn<(from: string, to: string) => Promise<Array<CheckRecord & { id: string }>>>();
let store: RecordStore;

beforeEach(() => {
  geoBox.store = freshGeo();
  geoBox.fail = false;
  authState.value = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  farm = farmFixture();
  getFarmFails = false;
  saveCheck.mockReset();
  saveCheck.mockResolvedValue(undefined);
  listChecks.mockReset();
  listChecks.mockResolvedValue([]);
  localStorage.clear();
  store = {
    mode: "firestore",
    getFarm: vi.fn(async () => {
      if (getFarmFails) throw new Error("権限がありません");
      return farm;
    }),
    saveCheck,
    listChecks,
  } as unknown as RecordStore;
});
afterEach(cleanup);

function mount(
  ui: React.ReactNode,
  o: { ds?: DataSource; spot?: FarmPoint | null; path?: string; store?: RecordStore } = {},
) {
  return render(
    <MemoryRouter initialEntries={[o.path ?? "/todo"]}>
      <DataSourceProvider value={o.ds ?? makeDs()}>
        <RecordStoreProvider value={o.store ?? store}>
          <SpotProvider fixed={o.spot === undefined ? SPOT : o.spot}>
            <Routes>
              <Route path={o.path ?? "/todo"} element={ui} />
            </Routes>
          </SpotProvider>
        </RecordStoreProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

/** 「いつ時点か」の行と、声かけ文の枠（M-18。発生の日付を書く。worker-message.test.tsx が見る）を除いた画面の文字 */
function pageText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".as-of, .worker-message").forEach((e) => e.remove());
  return clone.textContent ?? "";
}
const hasHeading = (re: RegExp) => screen.queryAllByRole("heading", { name: re }).length > 0;
const openMore = () => fireEvent.click(screen.getByRole("button", { name: "くわしく" }));

// 段階の材料
const inTsuyama = (o: Partial<Case> = {}) => mkCase({ id: "t1", ...o });
const inTottori = () => mkCase({ id: "tt1", muniCode: "31201", muniName: "鳥取市", prefCode: "31", stages: { suspected: stage("2025-12-25") } });
const farAway = () => mkCase({ id: "far1", muniCode: "13101", muniName: "千代田区", prefCode: "13" });

describe("ふだん（段階 4）", () => {
  it("短い確認だけを出し、『くわしく』を押すと always の確認リストが開く。区域の見出しも日付もない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.getByText(FIXED_TEXT.riskAnywhere)).toBeTruthy();
    // 閉じている間は確認リストの項目が DOM にない
    expect(screen.queryByText(/手指の洗浄と消毒/)).toBeNull();
    expect(screen.getByRole("button", { name: "くわしく" }).getAttribute("aria-expanded")).toBe("false");

    openMore();
    expect(screen.getByRole("heading", { name: "いつも求められていること" })).toBeTruthy();
    expect(screen.getAllByText(/手指の洗浄と消毒/).length).toBeGreaterThan(0);
    expect(hasHeading(/区域に入っていれば/)).toBe(false);
    expect(hasHeading(/確かめておくとよいこと/)).toBe(false);
    expect(screen.queryByRole("region", { name: "解除の見込み" })).toBeNull();
    expect(pageText(container)).not.toMatch(/\d{1,2}月\d{1,2}日/);
    expect(pageText(container)).not.toContain("見込み");
    expect(screen.getByRole("button", { name: "くわしくを閉じる" })).toBeTruthy();
  });

  it("県の発表を確認できていないときは、何もない画面にしない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [], watch: [] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.getByText("この県の発表を確認できていません。県の連絡を確かめてください")).toBeTruthy();
    expect(screen.getByText("確認できていません")).toBeTruthy(); // いつ時点か
  });

  it("確認できていれば、いつ時点かを出す", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(container.querySelector(".as-of")?.textContent).toBe("1 月 5 日 8:30 時点");
    expect(screen.queryByText("この県の発表を確認できていません。県の連絡を確かめてください")).toBeNull();
  });
});

describe("段階 2 と 3", () => {
  it("段階 2: always と確かめておくとよいことだけ。区域の見出しも日付もない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    expect(screen.getByText(FIXED_TEXT.prefContactIsAuthority)).toBeTruthy();
    openMore();
    expect(hasHeading(/いつも求められていること/)).toBe(true);
    expect(hasHeading(/確かめておくとよいこと/)).toBe(true);
    expect(hasHeading(/区域に入っていれば/)).toBe(false);
    expect(screen.queryByRole("region", { name: "解除の見込み" })).toBeNull();
    expect(screen.queryByText(SURVEILLANCE_NOTE)).toBeNull();
    expect(pageText(container)).not.toMatch(/\d{1,2}月\d{1,2}日/);
    expect(pageText(container)).not.toContain("見込み");
  });

  it("段階 3（登録した町）も同じ作り", async () => {
    const sapporo = mkCase({ id: "sp", muniCode: "01100", muniName: "札幌市", prefCode: "01" });
    const { container } = mount(<TodoPage />, {
      spot: { ...SPOT, frequentMuniCodes: ["01100"] },
      ds: makeDs({ cases: [sapporo] }),
    });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    openMore();
    expect(hasHeading(/区域に入っていれば/)).toBe(false);
    expect(hasHeading(/確かめておくとよいこと/)).toBe(true);
    expect(pageText(container)).not.toMatch(/\d{1,2}月\d{1,2}日/);
  });
});

describe("段階 1 の解除の見込み", () => {
  it("防疫措置の完了前は『未定』。搬出の文と『県の連絡が正です』。3 分類が最初から開いている", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByText("区域に入っている可能性があります。県の連絡を確かめてください");
    const region = screen.getByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText(/未定です/)).toBeTruthy();
    expect(within(region).getByText(/搬出制限: 検査の結果を受けて県が解除します/)).toBeTruthy();
    expect(within(region).getByText(/県の連絡が正です/)).toBeTruthy();
    expect(within(region).queryByText(/続発/)).toBeNull();
    // 段階 1 は求められることを最初から開く
    expect(hasHeading(/いつも求められていること/)).toBe(true);
    expect(hasHeading(/区域に入っていれば求められること/)).toBe(true);
    expect(screen.getByText("区域に入っているかは県の連絡が正です")).toBeTruthy();
    expect(hasHeading(/確かめておくとよいこと/)).toBe(true);
  });

  it("完了 12/30 なら 1月21日、1月28日。『最も早い日』『防疫指針の日数から計算』と検査の前提を添える。続発の注意はない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama({ stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-30") } })] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText("1月21日（最も早い日。防疫指針の日数から計算）")).toBeTruthy();
    expect(within(region).getByText("1月28日（最も早い日。防疫指針の日数から計算）")).toBeTruthy();
    expect(within(region).getByText(/検査で区域内の全農場が陰性と確かめられること/)).toBeTruthy();
    expect(within(region).getByText(/検査の結果によっては遅れます/)).toBeTruthy();
    expect(region.textContent).not.toContain("ごろ");
    expect(within(region).queryByText("続発があると延びます")).toBeNull();
  });

  it("隣の町の事例が遅く終わると、延びる日と『続発があると延びます』を出す", async () => {
    const a = inTsuyama({ stages: { confirmed: stage("2025-12-15"), control_done: stage("2025-12-21") } });
    const b = mkCase({ id: "b", muniCode: "33214", muniName: "美作市", stages: { confirmed: stage("2025-12-25"), control_done: stage("2025-12-30") } });
    mount(<TodoPage />, { ds: makeDs({ cases: [a, b] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getAllByText("1月21日（最も早い日。防疫指針の日数から計算）").length).toBeGreaterThan(0);
    expect(within(region).getAllByText("続発があると延びます").length).toBeGreaterThan(0);
  });

  it("県が移動制限の見込みを発表していれば『県の発表』。同じ枠の監視強化は計算した日と分けて出所を添える", async () => {
    const c = inTsuyama({
      stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-21") },
      prefEstimates: { shipment: null, movement: "2026-01-15", surveillance: null },
    });
    mount(<TodoPage />, { ds: makeDs({ cases: [c] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText("1月15日（県の発表）")).toBeTruthy();
    expect(within(region).getByText("1月19日（最も早い日。防疫指針の日数から計算）")).toBeTruthy();
    expect(within(region).queryByText(/県の発表のとおりに出しています/)).toBeNull();
    expect(region.textContent).not.toContain("ごろ");
  });

  it("計算した移動制限の日と、県が発表した監視強化の日が混ざっても、日付ごとに出所が分かれる", async () => {
    const c = inTsuyama({
      stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-21") },
      prefEstimates: { shipment: null, movement: null, surveillance: "2026-01-20" },
    });
    mount(<TodoPage />, { ds: makeDs({ cases: [c] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText("1月12日（最も早い日。防疫指針の日数から計算）")).toBeTruthy();
    expect(within(region).getByText("1月20日（県の発表）")).toBeTruthy();
  });

  it("県の発表だけで計算した日がないときは、検査の前提の文を出さない", async () => {
    const c = inTsuyama({ prefEstimates: { shipment: null, movement: "2026-01-15", surveillance: "2026-01-20" } });
    mount(<TodoPage />, { ds: makeDs({ cases: [c] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText("1月15日（県の発表）")).toBeTruthy();
    expect(within(region).getByText("1月20日（県の発表）")).toBeTruthy();
    expect(within(region).queryByText(/最も早い日です/)).toBeNull();
  });

  it("搬出制限が解除されていれば『搬出制限は解除されました』", async () => {
    const c = inTsuyama({ stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-25"), shipment_lifted: stage("2026-01-03") } });
    mount(<TodoPage />, { ds: makeDs({ cases: [c] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText(/搬出制限: 搬出制限は解除されました/)).toBeTruthy();
    // 段階は①のまま（移動制限が続いている）
    expect(screen.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeTruthy();
  });

  it("監視強化の説明は、監視強化の解除が未記録のときだけ", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    expect(screen.getByText(SURVEILLANCE_NOTE)).toBeTruthy();
    cleanup();
    const done = inTsuyama({ stages: { confirmed: stage("2025-12-20"), surveillance_lifted: stage("2026-01-04") } });
    mount(<TodoPage />, { ds: makeDs({ cases: [done] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    expect(screen.queryByText(SURVEILLANCE_NOTE)).toBeNull();
  });
});

describe("読み込みと失敗（④にしない）", () => {
  it("事例が届くまでは『読み込んでいます』だけ。短い確認も riskAnywhere も出さない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: null }) });
    await screen.findByText(/読み込んでいます/);
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(screen.queryByText("今月の自己点検を確かめましょう")).toBeNull();
    expect(screen.queryByRole("button", { name: "くわしく" })).toBeNull();
  });

  it("県の形を読めなかったときは『読めませんでした』。④の文を出さない", async () => {
    geoBox.fail = true;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText(/読めませんでした/);
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(screen.queryByText("今月の自己点検を確かめましょう")).toBeNull();
  });

  it("地点がなければ町を選ぶ案内と、ふだんの確認。区域の話は出さない", async () => {
    farm = null;
    mount(<TodoPage />, { spot: null, ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByText(/町を選ぶと、近くの発生に合わせた確認を出せます/);
    expect(screen.getByRole("link", { name: "地図で町を選ぶ" }).getAttribute("href")).toBe("/");
    expect(screen.getByText(FIXED_TEXT.riskAnywhere)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "解除の見込み" })).toBeNull();
    expect(screen.queryByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeNull();
  });

  it("冷えた状態（県を読み込んでいない）で、津山市の中心のメッシュと鳥取市の疑いを描いても、例外なく段階 2", async () => {
    const geo = geoBox.store as GeoStore;
    expect(() => geo.geometry("31201")).toThrow(GeoNotLoadedError);
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    expect(screen.queryByText(/読めませんでした/)).toBeNull();
    expect(() => geo.geometry("31201")).not.toThrow(); // 描く前に県 31 を読み込んだ
  });

  it("resolveTodo: 未読み込みから、津山市の中心のメッシュと鳥取市の疑いで level 2、kind adjacent", async () => {
    const geo = freshGeo();
    expect(() => geo.geometry("31201")).toThrow(GeoNotLoadedError);
    const r = await resolveTodo({ spot: { meshCode: latLngToMesh3(35.146, 133.995), muniCode: "33203", frequentMuniCodes: [] }, cases: [inTottori()], season: 2025, geo });
    expect(r.level.level).toBe(2);
    expect(r.level.reasons[0]).toMatchObject({ level: 2, kind: "adjacent" });
    expect(r.lifts).toEqual([]);
  });
});

describe("農場と記録（やった）", () => {
  it("農場の用途と飼い方を確認リストに渡す（肉用は good-broiler だけ、開放的な鶏舎は壁とねずみが先）", async () => {
    farm = farmFixture({ production: "broiler", housing: "open" });
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    openMore();
    await screen.findByText(/肉用の鶏の食鳥処理場への出荷/);
    expect(screen.queryByText(/^卵の出荷は/)).toBeNull();
    const good = screen.getByRole("heading", { name: /確かめておくとよいこと/ }).closest("section")!;
    const items = within(good).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("鶏舎の壁やネットの破損");
    expect(items[1]!.textContent).toContain("ねずみの死体や痕跡");
  });

  it("農場が未設定のときは両方出す（農場がなければ null を渡す）", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    openMore();
    expect(screen.getByText(/^卵の出荷は/)).toBeTruthy();
    expect(screen.getByText(/肉用の鶏の食鳥処理場への出荷/)).toBeTruthy();
  });

  it("『やった』は saveCheck({kind:'disinfection',date,itemId}) だけを呼ぶ", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    const btn = await screen.findByRole("button", { name: /やった: 衛生管理区域（消毒して入る範囲）の入口/ });
    fireEvent.click(btn);
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-17" });
    await waitFor(() => expect(btn.textContent).toBe("今日は記録しました"));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // 区域の項目はない（段階 4）。記録できるのは always の 3 つ
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(3);
  });

  it("段階 1 は区域の消毒（zone-entry、zone-lime、zone-inside）も『やった』で残せる", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    await screen.findAllByRole("button", { name: /^やった/ });
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /やった: 鶏舎の中を/ }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalled());
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "zone-inside" });
  });

  it("保存に失敗したら知らせ、もう一度押せる", async () => {
    saveCheck.mockRejectedValueOnce(new Error("通信できません"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    const btn = await screen.findByRole("button", { name: /やった: 衛生管理区域に入る車両/ });
    fireEvent.click(btn);
    await screen.findByText("記録できませんでした。もう一度押してください");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toBe("今日は記録しました"));
  });

  it("今日すでに記録した項目は、最初から『今日は記録しました』", async () => {
    listChecks.mockResolvedValue([{ id: "c1", kind: "disinfection", date: TODAY, itemId: "always-19" }]);
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    const btn = await screen.findByRole("button", { name: /やった: 衛生管理区域に入る車両/ });
    await waitFor(() => expect(btn.textContent).toBe("今日は記録しました"));
    expect(saveCheck).not.toHaveBeenCalled();
  });

  it("農場がなければ『やった』を出さず、saveCheck を呼ばない。会員でなければ招待コードの案内", async () => {
    farm = null;
    authState.value = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/招待コードで登録すると記録できます/);
    expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
    expect(saveCheck).not.toHaveBeenCalled();
  });

  it("会員で農場がなければ『農場を設定すると記録できます』と /settings/farm へのリンク", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/農場を設定すると記録できます/);
    expect(screen.getByRole("link", { name: "農場を設定する" }).getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
  });

  it("農場を読めなかったとき（権限や通信）は『農場がない』と言わず、『やった』も出さない", async () => {
    getFarmFails = true;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/農場の情報を読めませんでした/);
    expect(screen.queryByText(/農場を設定すると記録できます/)).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
  });

  it("見本の農場（sample）では Firebase のログイン状態を見ない", async () => {
    farm = null;
    const sample = { ...store, mode: "sample" } as RecordStore;
    authState.value = new Proxy(authState.value, {
      get() {
        throw new Error("sample で useAuthUser を呼んでいます");
      },
    });
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }), store: sample, path: "/sample/todo" });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText("見本の農場を読めませんでした");
  });

  it("/todo は会員の判断で包まない（未ログインでも開ける）", async () => {
    authState.value = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    expect(await screen.findByRole("heading", { name: "やること" })).toBeTruthy();
    expect(await screen.findByText("今月の自己点検を確かめましょう")).toBeTruthy();
  });
});

describe("リンク", () => {
  it("/todo の自己点検のリンクは /record/self-check", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const link = await screen.findByRole("link", { name: "今月の自己点検を開く" });
    expect(link.getAttribute("href")).toBe("/record/self-check");
  });

  it("/sample/todo では /sample/record/self-check。/record で始まる href がない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }), path: "/sample/todo" });
    const link = await screen.findByRole("link", { name: "今月の自己点検を開く" });
    expect(link.getAttribute("href")).toBe("/sample/record/self-check");
    await screen.findByRole("region", { name: "解除の見込み" });
    for (const a of container.querySelectorAll("a[href]")) expect(a.getAttribute("href")!.startsWith("/record")).toBe(false);
  });
});

describe("全文に禁止語がない", () => {
  it.each([
    ["段階 1", () => [inTsuyama({ stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-30") } })]],
    ["段階 2", () => [inTottori()]],
    ["段階 4", () => [farAway()]],
  ] as const)("%s", async (_name, cases) => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: cases() }) });
    await screen.findByRole("button", { name: "くわしく" }).catch(() => screen.findByRole("button", { name: "くわしくを閉じる" }));
    if (screen.queryByRole("button", { name: "くわしく" })) openMore();
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^やった/ }).length).toBeGreaterThan(0));
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });
});

describe("画面の文言", () => {
  it("読み込み中、失敗、案内など、どの状態の文にも禁止語がない", () => {
    expect(findForbiddenPhrases(`${Object.values(TODO_TEXT).join("\n")}\n${SURVEILLANCE_NOTE}`)).toEqual([]);
  });
});

describe("DisinfectionPanel", () => {
  it("農場があれば、記録できる項目だけに『やった』を出し、押すと saveCheck を同じ形で呼ぶ", async () => {
    listChecks.mockResolvedValue([{ id: "c0", kind: "disinfection", date: "2026-01-04", itemId: "always-22" }]);
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    const btns = await screen.findAllByRole("button", { name: /^やった/ });
    expect(btns).toHaveLength(3); // 段階 4: always-17、19、22
    fireEvent.click(screen.getByRole("button", { name: /やった: 衛生管理区域に入る車両/ }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-19" });
    // 最近の記録に、昨日の分と今の分が新しい順で出る
    const recent = screen.getByRole("region", { name: "最近の記録" });
    const rows = within(recent).getAllByRole("listitem").map((l) => l.textContent);
    expect(rows[0]).toContain("1月5日");
    expect(rows[0]).toContain("衛生管理区域に入る車両");
    expect(rows[1]).toContain("1月4日");
  });

  it("段階 1 では区域の消毒の項目も出る（見出しで義務の種類が分かる）", async () => {
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [inTsuyama()] }) });
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(6));
    expect(hasHeading(/区域に入っていれば求められること/)).toBe(true);
  });

  it("農場がなければ『やった』を出さず、saveCheck を呼ばない", async () => {
    farm = null;
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText(/農場を設定すると記録できます/);
    expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
    expect(saveCheck).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "最近の記録" })).toBeNull();
  });

  it("近くの発生を読めなかったときは、ふだんの項目だけと断る", async () => {
    geoBox.fail = true;
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("近くの発生を読めなかったので、ふだんの項目だけ出しています");
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(3));
  });
});
