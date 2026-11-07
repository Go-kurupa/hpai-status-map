// M-03: やること画面、解除の見込みの表示、消毒の記録。実データの市町村（津山市 33203 など）で段階を確かめる。
import { createGeoStore, GeoNotLoadedError, type GeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { Case, CheckRecord, Farm, FarmPoint, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { RISK_LINE_TEXT, RISK_SENTENCE, RISK_SOURCE_NAME, RISK_URL } from "../../ui/RiskLine";
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

// 相談から足した見直しの欄。足した項目の口とカードの一覧は偽物に差し替える（Firebase とネットワークに出ない）
const reviewBox = vi.hoisted(() => ({
  store: { addReview: vi.fn(), listReviews: vi.fn(), listReviewItems: vi.fn(), markReview: vi.fn(), removeReview: vi.fn() },
  catalog: null as unknown,
  catalogFail: false,
}));
vi.mock("../consult/reviewStore", () => ({ createReviewStore: () => reviewBox.store }));
vi.mock("../consult/cardsData", () => ({
  loadConsultCatalog: () => (reviewBox.catalogFail ? Promise.reject(new Error("読めません")) : Promise.resolve(reviewBox.catalog)),
}));

import TodoPage, { orderSections } from "./TodoPage";
import { STANDARD_NUMBER_NOTE } from "@hpai/shared/checklist/items";
import { buildChecklist } from "@hpai/shared/checklist";

// 守る文は箇条書きで「文（出典: 名前）」と名前のリンクに分けて出す（URL は本文に出さない）
const riskItem = () => screen.queryAllByRole("listitem").find((li) => li.textContent?.includes(RISK_SENTENCE)) ?? null;
function expectRiskItem() {
  const li = riskItem();
  expect(li?.textContent).toBe(RISK_LINE_TEXT);
  expect(li?.textContent).not.toContain(RISK_URL);
  const a = li!.querySelector("a")!;
  expect(a.textContent).toBe(RISK_SOURCE_NAME);
  expect(a.getAttribute("href")).toBe(RISK_URL);
}


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
  reviewBox.store.addReview.mockReset();
  reviewBox.store.listReviews.mockReset().mockResolvedValue([]);
  reviewBox.store.listReviewItems.mockReset().mockResolvedValue([]);
  reviewBox.store.markReview.mockReset().mockResolvedValue(undefined);
  reviewBox.store.removeReview.mockReset().mockResolvedValue(undefined);
  reviewBox.catalogFail = false;
  reviewBox.catalog = {
    cards: new Map([
      ["maff-M07", { id: "maff-M07", action: "着替え・履き替えの前後の動線を分ける", evidence: "obligation", sourceId: "maff-s1" }],
      ["aphis-A01", { id: "aphis-A01", action: "鶏舎の入口で専用の靴に履き替える", evidence: "study-association", sourceId: "aphis-s1" }],
      ["maff-M02", { id: "maff-M02", action: "防鳥ネットの破れを点検する", evidence: "obligation", sourceId: "maff-s1" }],
      ["maff-M12", { id: "maff-M12", action: "敷地の除草をする", evidence: "obligation", sourceId: "maff-s1" }],
    ]),
    sources: new Map([
      ["maff-s1", { id: "maff-s1", title: "飼養衛生管理基準遵守指導の手引き", publisher: "農林水産省", url: "https://www.maff.go.jp/x.pdf", domestic: true }],
      ["aphis-s1", { id: "aphis-s1", title: "Table Egg Layers Case-Control Study", publisher: "USDA APHIS", url: "https://www.aphis.usda.gov/x.pdf", domestic: false }],
    ]),
  };
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
    // けさの確認（会員だけ）が読む今日の死亡数。既定は鶏舎なし
    listHouses: vi.fn(async () => []),
    listDeaths: vi.fn(async () => []),
  } as unknown as RecordStore;
});
/** 見本の道筋（/sample）の記録の口。本物では SampleLayout が mode: sample の口を渡す */
const sampleStore = () => ({ ...store, mode: "sample" }) as unknown as RecordStore;
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
/** 閉じているときの名前（開くと出る確認項目の数は農場の種類で変わるので、数は固定しない） */
const MORE = /^確認リストを開く（\d+ 項目）$/;
const LESS = "確認リストを閉じる";
const openMore = () => fireEvent.click(screen.getByRole("button", { name: MORE }));

// 段階の材料
const inTsuyama = (o: Partial<Case> = {}) => mkCase({ id: "t1", ...o });
const inTottori = () => mkCase({ id: "tt1", muniCode: "31201", muniName: "鳥取市", prefCode: "31", stages: { suspected: stage("2025-12-25") } });
const farAway = () => mkCase({ id: "far1", muniCode: "13101", muniName: "千代田区", prefCode: "13" });

describe("ふだん（段階 4）", () => {
  it("短い確認だけを出し、『確認リストを開く（N 項目）』を押すと always の確認リストが開く。区域の見出しも日付もない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expectRiskItem();
    // 閉じている間は確認リストの項目が DOM にない
    expect(screen.queryByText(/手指の洗浄と消毒/)).toBeNull();
    const more = screen.getByRole("button", { name: MORE });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // ボタンの直前に、何が並ぶかの 1 行（小さな注）
    const lead = more.previousElementSibling!;
    expect(lead.classList.contains("todo-note")).toBe(true);
    expect(lead.textContent).toBe(TODO_TEXT.moreLead);
    const n = Number(/（(\d+) 項目）/.exec(more.textContent ?? "")![1]);

    openMore();
    // 名前の数は、開くと出る確認項目の数と同じ
    expect(container.querySelectorAll(".todo-details .todo-items > li")).toHaveLength(n);
    expect(screen.getByRole("heading", { name: "いつも求められていること" })).toBeTruthy();
    expect(screen.getAllByText(/手指の洗浄と消毒/).length).toBeGreaterThan(0);
    expect(hasHeading(/区域に入っていれば/)).toBe(false);
    expect(hasHeading(/確かめておくとよいこと/)).toBe(false);
    expect(screen.queryByRole("region", { name: "解除の見込み" })).toBeNull();
    expect(pageText(container)).not.toMatch(/\d{1,2}月\d{1,2}日/);
    expect(pageText(container)).not.toContain("見込み");
    const less = screen.getByRole("button", { name: LESS });
    expect(less.getAttribute("aria-expanded")).toBe("true");
  });

  it("県の発表を確認できていないときは、何もない画面にしない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [], watch: [] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.getByText("この県の発表を確認できていません。県の連絡を確かめてください")).toBeTruthy();
    expect(container.querySelector(".as-of")?.textContent).toBe("確認できていません"); // いつ時点か（けさの確認にも同じ文が出る）
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

describe("距離の帯の農場（確認リストと声かけは ④ と同じ）", () => {
  const kurashiki = () => mkCase({ id: "kr", muniCode: "33202", muniName: "倉敷市", prefCode: "33" });

  it("帯だけなら resolveTodo は ④ で、声かけの元の事例がない。確認リストも ④ と同じ", async () => {
    const r = await resolveTodo({ spot: SPOT, cases: [kurashiki()], season: 2025, geo: freshGeo() });
    expect(r.level).toEqual({ level: 4, reasons: [], shipmentLifted: false, inSurveillanceNote: false });
    expect(r.workerCase).toBeNull();
    expect(r.lifts).toEqual([]);
    const opt = { production: null, housing: null };
    expect(buildChecklist({ level: r.level.level, ...opt })).toEqual(buildChecklist({ level: 4, ...opt }));
  });

  it("帯の中の登録した町は、今までどおり段階 3 で、声かけの元になる", async () => {
    const r = await resolveTodo({ spot: { ...SPOT, frequentMuniCodes: ["33202"] }, cases: [kurashiki()], season: 2025, geo: freshGeo() });
    expect(r.level.level).toBe(3);
    expect(r.level.reasons.map((x) => x.kind)).toEqual(["frequent"]);
    expect(r.workerCase?.caseId).toBe("kr");
  });

  it("画面は ④ と同じ短い確認で、確かめておくとよいことを足さない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [kurashiki()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByText("近くの町で発表がありました。県の発表を確かめましょう")).toBeNull();
    openMore();
    expect(hasHeading(/確かめておくとよいこと/)).toBe(false);
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
    expect(riskItem()).toBeNull();
    expect(screen.queryByText("今月の自己点検を確かめましょう")).toBeNull();
    expect(screen.queryByRole("button", { name: /^確認リストを(開く|閉じる)/ })).toBeNull();
  });

  it("県の形を読めなかったときは『読めませんでした』。④の文を出さない", async () => {
    geoBox.fail = true;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText(/読めませんでした/);
    expect(riskItem()).toBeNull();
    expect(screen.queryByText("今月の自己点検を確かめましょう")).toBeNull();
  });

  it("地点がなければ町を選ぶ案内と、ふだんの確認。区域の話は出さない", async () => {
    farm = null;
    mount(<TodoPage />, { spot: null, ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByText(/地域を選択すると、近くの発生に合わせた確認を出せます/);
    expect(screen.getByRole("link", { name: "地図で地域を選択" }).getAttribute("href")).toBe("/");
    expectRiskItem();
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
    expect(await screen.findByRole("heading", { name: "対策項目" })).toBeTruthy();
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
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }), path: "/sample/todo", store: sampleStore() });
    const link = await screen.findByRole("link", { name: "今月の自己点検を開く" });
    expect(link.getAttribute("href")).toBe("/sample/record/self-check");
    await screen.findByRole("region", { name: "解除の見込み" });
    for (const a of container.querySelectorAll("a[href]")) expect(a.getAttribute("href")!.startsWith("/record")).toBe(false);
  });
});

describe("消毒への道、段階 1 の並び、番号の注意", () => {
  it("/todo の消毒のリンクは /record/disinfection、/sample/todo では /sample/record/disinfection", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const link = await screen.findByRole("link", { name: "消毒の記録を開く" });
    expect(link.getAttribute("href")).toBe("/record/disinfection");
    expect(link.className).toContain("tap-link");
    expect(screen.getByRole("link", { name: "今月の自己点検を開く" }).className).toContain("tap-link");
    cleanup();
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }), path: "/sample/todo", store: sampleStore() });
    const sample = await screen.findByRole("link", { name: "消毒の記録を開く" });
    expect(sample.getAttribute("href")).toBe("/sample/record/disinfection");
    await screen.findByRole("region", { name: "解除の見込み" });
    for (const a of container.querySelectorAll("a[href]")) expect(a.getAttribute("href")!.startsWith("/record")).toBe(false);
  });

  it("orderSections: 段階 1 だけ if_in_zone、always、good_to_check の順。ほかは shared のまま", () => {
    const base = { production: null, housing: null } as const;
    const names = (l: 1 | 2 | 3 | 4) => orderSections(l, buildChecklist({ level: l, ...base })).map((s) => s.class);
    expect(names(1)).toEqual(["if_in_zone", "always", "good_to_check"]);
    for (const l of [2, 3, 4] as const) expect(names(l)).toEqual(buildChecklist({ level: l, ...base }).map((s) => s.class));
  });

  it("段階 1 では『区域に入っていれば』が『いつも求められていること』より前", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    const hs = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    const zone = hs.findIndex((t) => /区域に入っていれば/.test(t));
    const always = hs.findIndex((t) => /いつも求められていること/.test(t));
    expect(zone).toBeGreaterThanOrEqual(0);
    expect(zone).toBeLessThan(always);
  });

  it("段階 4 と 2 の並びは今のまま（いつも、確かめておくとよいこと）", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    openMore();
    const hs = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(hs.findIndex((t) => /いつも求められていること/.test(t))).toBeLessThan(hs.findIndex((t) => /確かめておくとよいこと/.test(t)));
  });

  it("段階 1 で番号の注意は枠ごとに 1 回。項目の番号と条文の位置は項目に残る", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    for (const block of container.querySelectorAll(".class-block")) {
      const notes = Array.from(block.querySelectorAll("p")).filter((p) => p.textContent === STANDARD_NUMBER_NOTE);
      const hasStd = Array.from(block.querySelectorAll(".todo-items > li")).length > 0 && notes.length > 0;
      expect(notes.length).toBeLessThanOrEqual(1);
      if (hasStd) expect(block.querySelectorAll(".todo-items .todo-note").length).toBeGreaterThan(0);
    }
    expect(container.textContent!.split(STANDARD_NUMBER_NOTE).length - 1).toBeGreaterThanOrEqual(1);
    const items = buildChecklist({ level: 1, production: null, housing: null }).flatMap((s) => s.items);
    const stdItems = items.filter((i) => i.source.note?.includes(STANDARD_NUMBER_NOTE));
    expect(stdItems.length).toBeGreaterThan(0);
    const blocksWithStd = new Set(buildChecklist({ level: 1, production: null, housing: null }).filter((s) => s.items.some((i) => i.source.note?.includes(STANDARD_NUMBER_NOTE))).map((s) => s.class));
    expect(container.textContent!.split(STANDARD_NUMBER_NOTE).length - 1).toBe(blocksWithStd.size);
    const i17 = items.find((i) => i.id === "always-17")!;
    const position = i17.source.note!.replace(STANDARD_NUMBER_NOTE, "").trim();
    expect(position.length).toBeGreaterThan(0);
    expect(container.textContent).toContain(position);
  });

  it("農場が読めているとき確認リストの中に取り消しがない旨が出る。農場がなければ出ない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    expect(await screen.findByText(TODO_TEXT.doneNoUndo)).toBeTruthy();
    cleanup();
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/農場を設定すると記録できます/);
    expect(screen.queryByText(TODO_TEXT.doneNoUndo)).toBeNull();
  });

  it("DisinfectionPanel: panelLead の次に doneNoUndo が出る", async () => {
    const { container } = mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    const lead = await screen.findByText(TODO_TEXT.panelLead);
    expect(lead.nextElementSibling?.textContent).toBe(TODO_TEXT.doneNoUndo);
    expect(container.textContent).toContain(TODO_TEXT.doneNoUndo);
  });
});

describe("全文に禁止語がない", () => {
  it.each([
    ["段階 1", () => [inTsuyama({ stages: { confirmed: stage("2025-12-20"), control_done: stage("2025-12-30") } })]],
    ["段階 2", () => [inTottori()]],
    ["段階 4", () => [farAway()]],
  ] as const)("%s", async (_name, cases) => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: cases() }) });
    await screen.findByRole("button", { name: MORE }).catch(() => screen.findByRole("button", { name: LESS }));
    if (screen.queryByRole("button", { name: MORE })) openMore();
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

/** 足した項目（店の読み出しの形）。既定は前に足したまま（記録なし） */
type ReviewItemFixture = { id: string; status: "pending" | "later" | "done" | null; note: string; updatedAt: Date | null; mine: boolean | null };
const reviewItem = (id: string, over: Partial<ReviewItemFixture> = {}): ReviewItemFixture => ({ id, status: null, note: "", updatedAt: null, mine: null, ...over });
const items = (...ids: string[]) => ids.map((id) => reviewItem(id));

describe("AI の相談から足した見直しの欄（会員だけ）", () => {
  const section = () => screen.findByRole("region", { name: TODO_TEXT.reviewsHeading });

  it("欄は「確認リストを開く」のボタンの直後に詰めず、上を 24px（--s3）空ける（2026-11-07 精査 T3）", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items());
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    expect((await section()).classList.contains("todo-reviews")).toBe(true);
    // jsdom は css を当てないので、規則を読んで確かめる
    const css = readFileSync(path.join(import.meta.dirname, "todo.css"), "utf8");
    expect(css.match(/\.todo-reviews\s*\{([^}]*)\}/)?.[1] ?? "").toMatch(/margin-top:\s*var\(--s3\)/);
  });

  it("足したカードが 1 行ずつ、対策・根拠の札・資料名と、「外す」のボタンで並ぶ", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "aphis-A01"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    expect(sec.getByRole("heading", { name: "AI の相談から足した見直し" })).toBeTruthy();
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(2));
    const rows = sec.getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("着替え・履き替えの前後の動線を分ける");
    expect(rows[0]!.textContent).toContain("義務");
    expect(rows[0]!.textContent).toContain("飼養衛生管理基準遵守指導の手引き");
    expect(rows[1]!.textContent).toContain("研究で関係あり");
    expect(within(rows[0]!).getByRole("button", { name: "外す" })).toBeTruthy();
  });

  it("各項目の「この対策を AI に聞く」は、その対策の名前を入れた相談の画面へ。一覧の下にも相談へのリンクを出す", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    const ask = within(sec.getAllByRole("listitem")[0]!).getByRole("link", { name: "この対策を AI に聞く" });
    expect(ask.getAttribute("href")).toBe(`/consult?q=${encodeURIComponent("着替え・履き替えの前後の動線を分ける")}`);
    expect(sec.getByRole("link", { name: "AIに対策を相談する" }).getAttribute("href")).toBe("/consult");
  });

  it("今の資料にないカードには「この対策を AI に聞く」を出さない", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("gone-X99"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    expect(sec.queryByRole("link", { name: "この対策を AI に聞く" })).toBeNull();
  });

  it("「外す」を押すと消して、その行がなくなる", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "aphis-A01"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(2));
    fireEvent.click(within(sec.getAllByRole("listitem")[0]!).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    expect(reviewBox.store.removeReview).toHaveBeenCalledWith("maff-M07");
    expect(sec.queryByText("着替え・履き替えの前後の動線を分ける")).toBeNull();
  });

  it("前に同じ対策の文のカードが 2 件とも足してあっても（相談の画面が二重に足すのを止める前の古いデータ）、落ちずに 2 行出て、記録はそれぞれの id に付く", async () => {
    const cat = reviewBox.catalog as { cards: Map<string, unknown> };
    cat.cards.set("maff-M07b", { id: "maff-M07b", action: "着替え・履き替えの前後の動線を分ける", evidence: "obligation", sourceId: "maff-s1" });
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "maff-M07b"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByText("着替え・履き替えの前後の動線を分ける")).toHaveLength(2));
    const rows = sec.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M07b", { status: "done" });
    expect(reviewBox.store.markReview).toHaveBeenCalledTimes(1);
  });

  it("外すのに失敗したら、行は残り、失敗の文が出る", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07"));
    reviewBox.store.removeReview.mockRejectedValue(new Error("permission-denied"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    fireEvent.click(sec.getByRole("button", { name: "外す" }));
    expect((await sec.findByRole("alert")).textContent).toBe("外せませんでした。もう一度お試しください。");
    expect(sec.getAllByRole("listitem")).toHaveLength(1);
  });

  it("0 件のときは案内の文と、相談へのリンクを出す", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    expect(await sec.findByText("相談の画面で『対策項目に足す』を押すと、ここに並びます。")).toBeTruthy();
    expect(sec.getByRole("link", { name: "AIに対策を相談する" }).getAttribute("href")).toBe("/consult");
    expect(sec.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("今の資料にないカードの id は、その旨と「外す」だけ出す", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("gone-X99"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    expect(sec.getByText("このカードは今の資料にありません。")).toBeTruthy();
    expect(sec.getByRole("button", { name: "外す" })).toBeTruthy();
  });

  it("足した項目を読めなかったときは、読めなかった旨を出す（0 件と読ませない）", async () => {
    reviewBox.store.listReviewItems.mockRejectedValue(new Error("permission-denied"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = within(await section());
    expect((await sec.findByRole("alert")).textContent).toBe("足した見直しを読めませんでした。ページを読み込み直してください。");
    expect(sec.queryByText("相談の画面で『対策項目に足す』を押すと、ここに並びます。")).toBeNull();
  });

  it("会員でない（農場を読めない）ときは欄を出さず、足した項目も読みにいかない", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: "AI の相談から足した見直し" })).toBeNull();
    expect(reviewBox.store.listReviewItems).not.toHaveBeenCalled();
    expect(reviewBox.store.listReviews).not.toHaveBeenCalled();
  });

  it("見本の農場（sample）では欄を出さず、足した項目を読みにいかない", async () => {
    const sample = { ...store, mode: "sample" } as unknown as RecordStore;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }), store: sample });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: "AI の相談から足した見直し" })).toBeNull();
    expect(reviewBox.store.listReviewItems).not.toHaveBeenCalled();
    expect(reviewBox.store.listReviews).not.toHaveBeenCalled();
  });

  it("欄の文言に禁句がない", () => {
    const joined = Object.entries(TODO_TEXT).filter(([k]) => k.startsWith("reviews")).map(([, v]) => v).join("\n");
    expect(joined).not.toBe("");
    expect(findForbiddenPhrases(joined)).toEqual([]);
  });
});

describe("足した対策の実施の記録（まだ・後でやる・やった、メモ）", () => {
  const section = async () => within(await screen.findByRole("region", { name: TODO_TEXT.reviewsHeading }));
  const rowOf = (sec: ReturnType<typeof within>, action: string) =>
    sec.getAllByRole("listitem").find((li: HTMLElement) => li.textContent?.includes(action))!;
  const pressed = (row: HTMLElement) =>
    within(row)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
  const NET = "防鳥ネットの破れを点検する";
  async function mountWith(list: ReviewItemFixture[]) {
    reviewBox.store.listReviewItems.mockResolvedValue(list);
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const sec = await section();
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(list.length));
    return sec;
  }

  it("各対策に「まだ」「後でやる」「やった」の 3 つのボタンが並び、押されている状態は aria-pressed", async () => {
    const sec = await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date("2026-11-07T21:30:00Z"), mine: true })]);
    const row = rowOf(sec, NET);
    const group = within(row).getByRole("group", { name: `実施の状態: ${NET}` });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["まだ", "後でやる", "やった"]);
    expect(pressed(row)).toEqual(["後でやる"]);
  });

  it("前に足した対策（状態なし）は消さずに出し、「まだ」を押した形で「記録なし」と出す。断りは一覧の上に 1 回だけ", async () => {
    const sec = await mountWith(items("maff-M02", "maff-M07"));
    for (const row of sec.getAllByRole("listitem")) {
      expect(pressed(row)).toEqual(["まだ"]);
      expect(row.textContent).toContain("記録なし");
      expect(row.textContent).not.toContain("更新:");
    }
    expect(sec.getAllByText("「まだ」には、やったかどうかをまだ記録していない対策も入ります。")).toHaveLength(1);
  });

  it("「やった」を押すと、その対策の状態だけを保存し（メモは送らない）、押した形と「更新: 日時（あなた）」に変わる。保存中は押せない", async () => {
    let finish: () => void = () => undefined;
    reviewBox.store.markReview.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const sec = await mountWith(items("maff-M02"));
    const row = rowOf(sec, NET);
    fireEvent.change(within(row).getByLabelText("メモ（40 字まで）"), { target: { value: "未保存のメモ" } });
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { status: "done" });
    await waitFor(() => expect(within(row).getByRole("button", { name: "まだ" }).hasAttribute("disabled")).toBe(true));
    expect(within(row).getByRole("button", { name: "メモを保存" }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(pressed(row)).toEqual(["やった"]));
    expect(row.textContent).toMatch(/更新: \d{1,2} 月 \d{1,2} 日 \d{1,2}:\d{2}（あなた）/);
    expect(within(row).getByRole("button", { name: "やった" }).hasAttribute("disabled")).toBe(false);
    expect(reviewBox.store.markReview).toHaveBeenCalledTimes(1);
  });

  it("「まだ」を押すと戻す（pending を保存）。メモは残る", async () => {
    const sec = await mountWith([reviewItem("maff-M02", { status: "done", note: "点検した", updatedAt: new Date(), mine: true })]);
    const row = rowOf(sec, NET);
    fireEvent.click(within(row).getByRole("button", { name: "まだ" }));
    await waitFor(() => expect(pressed(row)).toEqual(["まだ"]));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { status: "pending" });
    expect((within(row).getByLabelText("メモ（40 字まで）") as HTMLInputElement).value).toBe("点検した");
    expect(row.textContent).not.toContain("記録なし");
  });

  it("押されている状態をもう一度押しても保存しない", async () => {
    const sec = await mountWith([reviewItem("maff-M02", { status: "done", updatedAt: new Date(), mine: true })]);
    fireEvent.click(within(rowOf(sec, NET)).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).not.toHaveBeenCalled();
  });

  it("メモは 40 字まで・1 行で、「メモを保存」でメモだけを保存する（状態は送らない）", async () => {
    const sec = await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date(), mine: true })]);
    const row = rowOf(sec, NET);
    const input = within(row).getByLabelText("メモ（40 字まで）") as HTMLInputElement;
    expect(input.getAttribute("maxlength")).toBe("40");
    expect(input.tagName).toBe("INPUT");
    // 変えていないうちは押せない
    expect(within(row).getByRole("button", { name: "メモを保存" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "資材を用意してから再確認" } });
    fireEvent.click(within(row).getByRole("button", { name: "メモを保存" }));
    await waitFor(() => expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { note: "資材を用意してから再確認" }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "メモを保存" }).hasAttribute("disabled")).toBe(true));
    expect(pressed(row)).toEqual(["後でやる"]);
    expect(input.value).toBe("資材を用意してから再確認");
  });

  it("メモの欄は 1 行の入力で、貼り付けた改行は入らない。前後の空白は除いて保存する", async () => {
    const sec = await mountWith(items("maff-M02"));
    const row = rowOf(sec, NET);
    fireEvent.change(within(row).getByLabelText("メモ（40 字まで）"), { target: { value: " 資材\n再確認 " } });
    fireEvent.click(within(row).getByRole("button", { name: "メモを保存" }));
    await waitFor(() => expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { note: "資材再確認" }));
  });

  it("保存に失敗したら、理由を短く出して元の表示に戻す（権限・外された、と、通信）", async () => {
    reviewBox.store.markReview.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "permission-denied" }));
    const sec = await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date(), mine: true })]);
    const row = rowOf(sec, NET);
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    expect((await within(row).findByRole("alert")).textContent).toBe(
      "保存できませんでした。この対策が外されたか、権限がありません。ページを読み込み直してください。",
    );
    expect(pressed(row)).toEqual(["後でやる"]);
    expect(within(row).getByRole("button", { name: "やった" }).hasAttribute("disabled")).toBe(false);

    reviewBox.store.markReview.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "unavailable" }));
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    await waitFor(() =>
      expect(within(row).getByRole("alert").textContent).toBe("保存できませんでした。通信を確かめて、もう一度お試しください。"),
    );
    expect(pressed(row)).toEqual(["後でやる"]);
  });

  it("並びは「後でやる」「まだ」（記録なしを含む）が上、「やった」が下。押しても並べ替えない（読み込んだときだけ）", async () => {
    const at = new Date();
    const sec = await mountWith([
      reviewItem("maff-M07", { status: "done", updatedAt: at, mine: true }),
      reviewItem("aphis-A01"),
      reviewItem("maff-M02", { status: "later", updatedAt: at, mine: true }),
      reviewItem("maff-M12", { status: "pending", updatedAt: at, mine: true }),
    ]);
    const order = () => sec.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);
    expect(order()).toEqual([NET, "鶏舎の入口で専用の靴に履き替える", "敷地の除草をする", "着替え・履き替えの前後の動線を分ける"]);
    fireEvent.click(within(rowOf(sec, NET)).getByRole("button", { name: "やった" }));
    await waitFor(() => expect(pressed(rowOf(sec, NET))).toEqual(["やった"]));
    expect(order()[0]).toBe(NET);
  });

  it("更新した人は、自分なら「（あなた）」、ほかの会員なら「（同じ農場の会員）」。時刻は日本時間", async () => {
    const sec = await mountWith([
      reviewItem("maff-M02", { status: "later", updatedAt: new Date("2026-11-07T21:30:00Z"), mine: true }),
      reviewItem("maff-M12", { status: "later", updatedAt: new Date("2026-11-08T00:05:00Z"), mine: false }),
    ]);
    expect(rowOf(sec, NET).textContent).toContain("更新: 11 月 8 日 6:30（あなた）");
    expect(rowOf(sec, "敷地の除草をする").textContent).toContain("更新: 11 月 8 日 9:05（同じ農場の会員）");
  });

  it("既存の操作（この対策を AI に聞く、外す）はそのまま。今の資料にないカードは状態のボタンを出さない", async () => {
    const sec = await mountWith([reviewItem("maff-M02", { status: "done", updatedAt: new Date(), mine: true }), reviewItem("gone-X99")]);
    const row = rowOf(sec, NET);
    expect(within(row).getByRole("link", { name: "この対策を AI に聞く" }).getAttribute("href")).toBe(`/consult?q=${encodeURIComponent(NET)}`);
    const gone = rowOf(sec, "このカードは今の資料にありません。");
    expect(within(gone).queryByRole("group")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(sec.getAllByRole("listitem")).toHaveLength(1));
    expect(reviewBox.store.removeReview).toHaveBeenCalledWith("maff-M02");
  });
});
