// M-03: やること画面、解除の見込みの表示、消毒の記録。実データの市町村（津山市 33203 など）で段階を確かめる。
import { createGeoStore, GeoNotLoadedError, type GeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { Case, CheckRecord, Farm, FarmPoint, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { RISK_LINE_TEXT, RISK_SENTENCE, RISK_SOURCE_NAME, RISK_URL } from "../../ui/RiskLine";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { RECORD_TEXT } from "../record/recordTexts";
import { SURVEILLANCE_NOTE } from "../map/texts";
import { TODO_TEXT } from "./texts";
import { resolveTodo } from "./todoModel";

// 県の形の読み込みは fetch を使うので、jsdom では実データを fs から読む。試験ごとに作り直し、未読み込み（冷えた状態）から始める
const geoBox = vi.hoisted(() => ({ store: null as unknown, fail: false }));
vi.mock("../../geo/loadGeo", () => ({
  loadWebGeoStore: () => (geoBox.fail ? Promise.reject(new Error("読み込めません")) : Promise.resolve(geoBox.store)),
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
  loadConsultCatalog: () => (reviewBox.catalogFail ? Promise.reject(new Error("読み込めません")) : Promise.resolve(reviewBox.catalog)),
}));

import TodoPage, { orderSections, sharedSource } from "./TodoPage";
import { STANDARD_NUMBER_NOTE } from "@hpai/shared/checklist/items";
import { buildChecklist, CHECKLIST_ITEMS, shortReminder } from "@hpai/shared/checklist";

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
/**
 * 閉じているときの名前（開くと出る確認項目の数は農場の種類で変わるので、数は固定しない）。
 * 会員の画面は参照の「一覧を開く（N 項目）」、見本と会員でない人は今のまま「確認リストを開く（N 項目）」（2026-11-07 A）
 */
const MORE = /^(?:確認リスト|一覧)を開く（\d+ 項目）$/;
const LESS = /^(?:確認リスト|一覧)を閉じる$/;
const openMore = () => fireEvent.click(screen.getByRole("button", { name: MORE }));
/** 段階が決まって、確認リスト（会員は参照の一覧）のボタンが出るまで待つ */
const ready = () => screen.findByRole("button", { name: MORE }).catch(() => screen.findByRole("button", { name: LESS }));

// 段階の材料
const inTsuyama = (o: Partial<Case> = {}) => mkCase({ id: "t1", ...o });
const inTottori = () => mkCase({ id: "tt1", muniCode: "31201", muniName: "鳥取市", prefCode: "31", stages: { suspected: stage("2025-12-25") } });
const farAway = () => mkCase({ id: "far1", muniCode: "13101", muniName: "千代田区", prefCode: "13" });

describe("ふだん（段階 4）", () => {
  it("短い確認だけを出し、『確認リストを開く（N 項目）』を押すと always の確認リストが開く。区域の見出しも日付もない（会員でない人の今の形）", async () => {
    farm = null;
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

  it("県の発表を確認できていないときは、何もない画面にしない。時点は主語つきの「発表の確認: 未確認」（単独の「確認できていません」にしない）", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [], watch: [] }) });
    await screen.findByText("この県の発表を確認できていません。県の連絡を確かめてください。");
    expect(container.querySelector(".as-of")?.textContent).toBe("発表の確認: 未確認");
    expect(screen.queryByText("確認できていません")).toBeNull();
    cleanup();
    farm = null;
    const plain = mount(<TodoPage />, { ds: makeDs({ cases: [], watch: [] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(plain.container.querySelector(".as-of")?.textContent).toBe("発表の確認: 未確認");
  });

  it("確認できていれば、いつ時点かを主語つきで出す（「発表の確認: 1 月 5 日 8:30 時点」）", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [] }) });
    await ready();
    expect(container.querySelector(".as-of")?.textContent).toBe("発表の確認: 1 月 5 日 8:30 時点");
    expect(screen.queryByText("この県の発表を確認できていません。県の連絡を確かめてください。")).toBeNull();
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
    await ready();
    expect(screen.queryByText("近くの町で発表がありました。県の発表を確かめましょう")).toBeNull();
    openMore();
    expect(hasHeading(/確かめておくとよいこと/)).toBe(false);
  });
});

describe("段階 1 の解除の見込み", () => {
  it("防疫措置の完了前は『未定』。搬出の文と『正式な情報は県の連絡です』。3 分類が最初から開いている", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByText("区域に入っている可能性があります。県の連絡を確かめてください");
    const region = screen.getByRole("region", { name: "解除の見込み" });
    expect(within(region).getByText(/未定です/)).toBeTruthy();
    expect(within(region).getByText(/搬出制限: 検査の結果を受けて県が解除します/)).toBeTruthy();
    expect(within(region).getByText(/正式な情報は県の連絡です/)).toBeTruthy();
    expect(within(region).queryByText(/続発/)).toBeNull();
    // 段階 1 は求められることを最初から開く
    expect(hasHeading(/いつも求められていること/)).toBe(true);
    expect(hasHeading(/区域に入っていれば求められること/)).toBe(true);
    expect(screen.getByText("区域に入っているかは、県の連絡で確かめてください")).toBeTruthy();
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

  it("県の形を読み込めなかったときは『読み込めませんでした』。④の文を出さない", async () => {
    geoBox.fail = true;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText(/読み込めませんでした/);
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
    expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
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
    await ready();
    openMore();
    const btn = await screen.findByRole("button", { name: /やった: 衛生管理区域（消毒して入る範囲）の入口/ });
    fireEvent.click(btn);
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-17" });
    await waitFor(() => expect(btn.textContent).toBe("今日は記録しました"));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // 区域の項目はない（段階 4）。記録できるのは always の 9 つ（消毒の 3 つは今日のやることの行、残りの 6 つは参照の一覧。2026-11-08）
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(9);
  });

  it("会員の確認リスト（参照の一覧）の新しい項目（always-18）の『やった』は saveCheck({kind:'disinfection',date,itemId}) で 1 件を保存する", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const ref = screen.getByRole("region", { name: "参照" });
    fireEvent.click(within(ref).getByRole("button", { name: MORE }));
    const summary = () => document.querySelector(".today-summary")?.textContent;
    const before = summary();
    const btn = await within(ref).findByRole("button", { name: /やった: 衛生管理区域専用の衣服と靴/ });
    fireEvent.click(btn);
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-18" });
    await waitFor(() => expect(btn.textContent).toBe("今日は記録しました"));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // 今日のやること（消毒の 6 項目のうちの 3 つ）の集計は変わらない
    expect(summary()).toBe(before);
  });

  it("段階 1 は区域の消毒（zone-entry、zone-lime、zone-inside）も『やった』で残せる", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    await screen.findAllByRole("button", { name: /^やった/ });
    // 今日のやることの 6 つ（消毒）と、区域の枠の 3 つ、参照の一覧の always の 6 つ（2026-11-08）
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: /やった: 鶏舎の中を/ }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalled());
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "zone-inside" });
  });

  it("見本の農場（/sample/todo）の確認リストは、いつも求められていることと区域に入っていれば求められることの全項目に『やった』。確かめておくとよいことには出さない（2026-11-08）", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }), path: "/sample/todo", store: sampleStore() });
    await screen.findByRole("region", { name: "解除の見込み" });
    await screen.findAllByRole("button", { name: /^やった/ });
    const want = buildChecklist({ level: 1, production: farm?.production ?? null, housing: farm?.housing ?? null })
      .filter((x) => x.class !== "good_to_check")
      .flatMap((x) => x.items.map((i) => `やった: ${i.text}`));
    const labels = screen.getAllByRole("button", { name: /^やった/ }).map((b) => b.getAttribute("aria-label"));
    expect([...labels].sort()).toEqual([...want].sort());
    expect(labels).toHaveLength(15);
    const good = screen.getByRole("heading", { name: /確かめておくとよいこと/ }).closest("section")!;
    expect(within(good).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(good).queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
    // 新しい項目（zone-visitors）を押すと 1 件を保存する
    fireEvent.click(screen.getByRole("button", { name: /やった: 鶏舎などへの、関係者以外の出入りを控える/ }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "zone-visitors" });
  });

  it("保存に失敗したら知らせ、もう一度押せる", async () => {
    saveCheck.mockRejectedValueOnce(new Error("通信できません"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await ready();
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
    await ready();
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

  it("農場を読み込めなかったとき（権限や通信）は『農場がない』と言わず、『やった』も出さない", async () => {
    getFarmFails = true;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/農場の情報を読み込めませんでした/);
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
    await screen.findByText("見本の農場を読み込めませんでした");
  });

  it("/todo は会員の判断で包まない（未ログインでも開ける）", async () => {
    farm = null;
    authState.value = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    expect(await screen.findByRole("heading", { name: "対策項目" })).toBeTruthy();
    expect(await screen.findByText("今月の自己点検を確かめましょう")).toBeTruthy();
  });
});

describe("リンク", () => {
  it("/todo の自己点検のリンクは /record/self-check（会員でない人の今の形。会員は今日のやることの自己点検の行）", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const link = await screen.findByRole("link", { name: "今月の自己点検を開く" });
    expect(link.getAttribute("href")).toBe("/record/self-check");
  });

  // 2026-11-08: /sample の記録を試す画面をなくしたので、見本の対策項目には記録へのリンクを出さない（地図へ戻されるだけになるため）
  it("/sample/todo には自己点検と消毒の記録へのリンクがない。/record と /sample/record で始まる href がない", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }), path: "/sample/todo", store: sampleStore() });
    await screen.findByRole("region", { name: "解除の見込み" });
    expect(screen.queryByRole("link", { name: "今月の自己点検を開く" })).toBeNull();
    expect(screen.queryByRole("link", { name: "消毒・対策の記録を開く" })).toBeNull();
    for (const a of container.querySelectorAll("a[href]")) expect(a.getAttribute("href")!).not.toMatch(/^\/(sample\/)?record/);
  });
});

describe("消毒への道、段階 1 の並び、番号の注意", () => {
  it("/todo の消毒のリンクは /record/disinfection（会員でない人の今の形）", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const link = await screen.findByRole("link", { name: "消毒・対策の記録を開く" });
    expect(link.getAttribute("href")).toBe("/record/disinfection");
    expect(link.className).toContain("tap-link");
    expect(screen.getByRole("link", { name: "今月の自己点検を開く" }).className).toContain("tap-link");
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
    // 出典を枠でまとめたので、項目には位置（末尾の「。」を除く）だけを、出典と同じ URL のリンクで残す（2026-11-08 直し 2）
    const position = i17.source.note!.replace(STANDARD_NUMBER_NOTE, "").trim().replace(/。$/u, "");
    expect(position.length).toBeGreaterThan(0);
    const link = within(container.querySelector<HTMLElement>(".class-always")!).getByRole("link", { name: `出典: ${i17.source.title}（${position}）` });
    expect(link.textContent).toBe(position);
    expect(link.getAttribute("href")).toBe(i17.source.url);
  });

  it("農場が読み込めているとき取り消しがない旨が 1 回出る（会員は今日のやることの消毒の行）。農場がなければ出ない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await ready();
    openMore();
    await waitFor(() => expect(document.body.textContent!.split(TODO_TEXT.doneNoUndo).length - 1).toBe(1));
    cleanup();
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    openMore();
    await screen.findByText(/農場を設定すると記録できます/);
    expect(screen.queryByText(TODO_TEXT.doneNoUndo)).toBeNull();
  });

  it("DisinfectionPanel: 任意と取り消せない旨は、次にすることの近くに 1 回だけ出る", async () => {
    const { container } = mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    const next = await screen.findByText(/^次にすること: /);
    expect(next.nextElementSibling?.textContent).toBe(RECORD_TEXT.disNote);
    expect(container.textContent!.split(RECORD_TEXT.disNote).length - 1).toBe(1);
    expect(container.textContent).not.toContain(TODO_TEXT.doneNoUndo);
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
  /** 直近 14 日の表の 1 行（日付の行）を、列の名前 → ☑ の有無にする */
  function tableRow(date: string): Record<string, boolean> {
    const table = within(screen.getByRole("region", { name: RECORD_TEXT.disTableHeading })).getByRole("table");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    const row = within(table).getByRole("rowheader", { name: date }).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    return Object.fromEntries(cells.map((c, k) => [heads[k + 1]!, within(c).queryByRole("img", { name: RECORD_TEXT.disTableDone }) !== null]));
  }

  it("農場があれば、記録できる項目だけに『やった』を出し、押すと saveCheck を同じ形で呼ぶ", async () => {
    listChecks.mockResolvedValue([{ id: "c0", kind: "disinfection", date: "2026-01-04", itemId: "always-22" }]);
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    const btns = await screen.findAllByRole("button", { name: /^やった/ });
    expect(btns).toHaveLength(3); // 段階 4: always-17、19、22
    fireEvent.click(screen.getByRole("button", { name: /やった: 衛生管理区域に入る車両/ }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-19" });
    // 記録した行は ☑ と「今日 記録済み」になり、押すものがなくなる
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(2));
    const row = screen.getByText("車両の消毒", { selector: ".row-title" }).closest("li")!;
    expect(within(row).getByRole("img", { name: "記録済み" }).textContent).toBe("☑");
    expect(row.textContent).toContain(RECORD_TEXT.disDoneToday);
    // 直近 14 日の表に、今日の分と昨日の分が新しい順で出る
    await waitFor(() => expect(tableRow("1月5日")["車両の消毒"]).toBe(true));
    expect(tableRow("1月5日")["鶏舎の手指消毒"]).toBe(false);
    expect(tableRow("1月4日")["鶏舎の手指消毒"]).toBe(true);
    const dates = within(screen.getByRole("region", { name: RECORD_TEXT.disTableHeading }))
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(dates).toHaveLength(14);
    expect(dates.slice(0, 2)).toEqual(["1月5日", "1月4日"]);
    expect(dates.at(-1)).toBe("12月23日");
  });

  it("確認リストで記録した新しい項目（always-18、zone-abnormal）も、直近 14 日の表に短い名前の列で出る。今日の項目は消毒の 3 つのまま（2026-11-08）", async () => {
    listChecks.mockResolvedValue([
      { id: "c0", kind: "disinfection", date: "2026-01-04", itemId: "always-18" },
      { id: "c1", kind: "disinfection", date: "2026-01-03", itemId: "zone-abnormal" },
    ]);
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await waitFor(() => expect(tableRow("1月4日")["区域専用の衣服と靴"]).toBe(true));
    expect(tableRow("1月3日")["区域の異状の即時報告"]).toBe(true);
    expect(tableRow("1月3日")["区域専用の衣服と靴"]).toBe(false);
    const heads = within(screen.getByRole("region", { name: RECORD_TEXT.disTableHeading })).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["日付", "入口の手指消毒", "車両の消毒", "鶏舎の手指消毒", "区域専用の衣服と靴", "区域の異状の即時報告"]);
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 2, name: "消毒・対策の記録" })).toBeTruthy();
    expect(screen.getByText("この画面では、消毒や対策をしたら「やった」を押して、日付と項目を記録します。")).toBeTruthy();
  });

  it("題と 1 文、札（今日の記録・直近 14 日の記録）、次にすることを、記録に合わせて出す", async () => {
    listChecks.mockResolvedValue([
      { id: "c0", kind: "disinfection", date: "2026-01-04", itemId: "always-22" },
      { id: "c1", kind: "disinfection", date: TODAY, itemId: "always-17" },
    ]);
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    expect(screen.getByRole("heading", { level: 2, name: RECORD_TEXT.disTitle })).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.disLead)).toBeTruthy();
    const stats = await screen.findByRole("list", { name: RECORD_TEXT.disStatsLabel });
    await waitFor(() => expect(within(stats).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["今日の記録1 / 3項目", "直近 14 日の記録2件"]));
    expect(screen.getByText(`次にすること: ${RECORD_TEXT.disNext(2)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /やった: 衛生管理区域に入る車両/ }));
    fireEvent.click(screen.getByRole("button", { name: /やった: 鶏舎に出入りする/ }));
    await screen.findByText(`次にすること: ${RECORD_TEXT.disNextDone}`);
    expect(within(stats).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["今日の記録3 / 3項目", "直近 14 日の記録4件"]);
    // 見出しは短い名前、その下に長い文と出典
    const row = screen.getByText("入口の手指消毒", { selector: ".row-title" }).closest("li")!;
    expect(row.textContent).toContain("衛生管理区域（消毒して入る範囲）の入口で");
    expect(within(row).getByRole("link", { name: /^出典: / })).toBeTruthy();
  });

  it("読み込み中は札を 0 と言わず「…」、読めなければ「読み込めませんでした」", async () => {
    let release: (v: Array<CheckRecord & { id: string }>) => void = () => {};
    listChecks.mockImplementation(() => new Promise((r) => (release = r)));
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    const stats = await screen.findByRole("list", { name: RECORD_TEXT.disStatsLabel });
    expect(within(stats).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["今日の記録…", "直近 14 日の記録…"]);
    expect(screen.queryByText(/^次にすること: /)).toBeNull();
    await waitFor(() => expect(listChecks).toHaveBeenCalled());
    release([]);
    await waitFor(() => expect(within(stats).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["今日の記録0 / 3項目", "直近 14 日の記録0件"]));
    cleanup();
    listChecks.mockRejectedValue(new Error("読み込めません"));
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    expect(await screen.findByText(RECORD_TEXT.disTableFailed)).toBeTruthy();
    const failed = screen.getByRole("list", { name: RECORD_TEXT.disStatsLabel });
    expect(within(failed).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["今日の記録読み込めませんでした", "直近 14 日の記録読み込めませんでした"]);
  });

  it("段階が下がって出なくなった区域の項目も、直近の記録にあれば表の列に残す", async () => {
    listChecks.mockResolvedValue([{ id: "c0", kind: "disinfection", date: "2026-01-02", itemId: "zone-lime" }]);
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await waitFor(() => expect(tableRow("1月2日")["消石灰の消毒"]).toBe(true));
    expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(3);
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
    expect(screen.queryByRole("region", { name: RECORD_TEXT.disTableHeading })).toBeNull();
    expect(screen.queryByRole("list", { name: RECORD_TEXT.disStatsLabel })).toBeNull();
  });

  it("近くの発生を読み込めなかったときは、ふだんの項目だけと断る", async () => {
    geoBox.fail = true;
    mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("近くの発生を読み込めなかったので、ふだんの項目だけ出しています");
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^やった/ })).toHaveLength(3));
  });
});

/** 足した項目（店の読み出しの形）。既定は前に足したまま（記録なし） */
type ReviewItemFixture = { id: string; status: "pending" | "later" | "done" | null; note: string; updatedAt: Date | null; mine: boolean | null };
const reviewItem = (id: string, over: Partial<ReviewItemFixture> = {}): ReviewItemFixture => ({ id, status: null, note: "", updatedAt: null, mine: null, ...over });
const items = (...ids: string[]) => ids.map((id) => reviewItem(id));

// 会員の画面（2026-11-07 A）では、相談から足した対策は「今日のやること」の 1 本のリストの行になる（別の欄を作らない）
const TODAY_HEADING = "今日のやること";
/** 今日のやることの節。全部の読み出しが終わって集計の行が出るまで待つ */
async function todayList() {
  const region = await screen.findByRole("region", { name: TODAY_HEADING });
  await waitFor(() => expect(region.querySelector(".today-summary")).not.toBeNull());
  return within(region);
}
/** 相談から足した対策の行（補足に「AI の相談から追加」がある行） */
const reviewRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".today-row")).filter((li) => li.querySelector(".today-sub")?.textContent?.startsWith("AI の相談から追加"));
const titleOf = (li: HTMLElement) => li.querySelector(".today-title")?.textContent ?? "";
const openFold = (li: HTMLElement) => fireEvent.click(li.querySelector("details > summary")!);

describe("会員の画面の作り（今日のやること・参照、2026-11-07 A）", () => {
  it("段階 4: 今日のやることの下に参照。守る文と県の注意、「国の指針で確かめること（出典つき）」と「一覧を開く（N 項目）」。一覧の「やった」は今日のやることにない項目だけ", async () => {
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [farAway()], watch: [] }) });
    await todayList();
    const ref = screen.getByRole("region", { name: "参照" });
    // 今日のやることの後ろ
    const today = screen.getByRole("region", { name: TODAY_HEADING });
    expect(today.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(ref).getByText("この県の発表を確認できていません。県の連絡を確かめてください。")).toBeTruthy();
    expect(within(ref).getByText("国の指針で確かめること（出典つき）")).toBeTruthy();
    expectRiskItem();
    // 自己点検の短い確認は、今日のやることの自己点検の行と重なるので出さない
    expect(screen.queryByText("今月の自己点検を確かめましょう")).toBeNull();
    const more = within(ref).getByRole("button", { name: /^一覧を開く（\d+ 項目）$/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const n = Number(/（(\d+) 項目）/.exec(more.textContent ?? "")![1]);
    fireEvent.click(more);
    expect(container.querySelectorAll(".todo-details .todo-items > li")).toHaveLength(n);
    expect(within(ref).getByRole("button", { name: "一覧を閉じる" }).getAttribute("aria-expanded")).toBe("true");
    // 消毒の 3 項目の「やった」は今日のやることの行だけ（同じボタンを 2 つにしない）。
    // ほかの「いつも求められていること」の 6 項目は一覧で押せる（2026-11-08）
    const refDone = within(ref)
      .queryAllByRole("button", { name: /^やった/ })
      .map((b) => b.getAttribute("aria-label"));
    const always = CHECKLIST_ITEMS.filter((i) => i.class === "always");
    expect(refDone).toEqual(always.filter((i) => !i.disinfectionLoggable).map((i) => `やった: ${i.text}`));
    for (const i of always.filter((x) => x.disinfectionLoggable)) expect(refDone).not.toContain(`やった: ${i.text}`);
    expect(within(today).getAllByRole("button", { name: /^やった/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(9);
    // 今の作りの 2 つのリンクは、今日のやることの行に置き換わる
    expect(screen.queryByRole("link", { name: "今月の自己点検を開く" })).toBeNull();
    expect(screen.queryByRole("link", { name: "消毒・対策の記録を開く" })).toBeNull();
  });

  it("段階 1: 短い確認・解除の見込み・「区域に入っていれば求められること」を今日のやることより上に出す（今の順序）。区域の枠は下の一覧に重ねない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await todayList();
    const today = screen.getByRole("region", { name: TODAY_HEADING });
    const before = (el: Element) => Boolean(el.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(screen.getByText("区域に入っている可能性があります。県の連絡を確かめてください"))).toBe(true);
    expect(before(screen.getByRole("region", { name: "解除の見込み" }))).toBe(true);
    const zone = screen.getByRole("heading", { name: /区域に入っていれば求められること/ });
    expect(before(zone)).toBe(true);
    expect(screen.getAllByRole("heading", { name: /区域に入っていれば求められること/ })).toHaveLength(1);
    // 区域の消毒（3 つ）は今日のやることの行で記録し、区域の枠には出さない。区域の枠のほかの 3 項目は枠の中で押せる（2026-11-08）
    expect(within(today).getAllByRole("button", { name: /^やった/ })).toHaveLength(6);
    const zoneDone = within(zone.closest("section")!)
      .queryAllByRole("button", { name: /^やった/ })
      .map((b) => b.getAttribute("aria-label"));
    const zoneItems = CHECKLIST_ITEMS.filter((i) => i.class === "if_in_zone");
    expect(zoneDone).toEqual(zoneItems.filter((i) => !i.disinfectionLoggable).map((i) => `やった: ${i.text}`));
    expect(zoneDone).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^やった/ })).toHaveLength(15);
    // 下の一覧は最初から開いている（段階 1）。いつも・確かめておくとよいことだけ
    expect(screen.getByRole("button", { name: "一覧を閉じる" })).toBeTruthy();
    expect(hasHeading(/いつも求められていること/)).toBe(true);
    expect(hasHeading(/確かめておくとよいこと/)).toBe(true);
    // 確かめておくとよいことには「やった」を出さない（2026-11-08）
    const good = screen.getByRole("heading", { name: /確かめておくとよいこと/ }).closest("section")!;
    expect(within(good).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(good).queryAllByRole("button", { name: /^やった/ })).toHaveLength(0);
  });
});

describe("会員の画面: 開いている間に段階が変わったとき", () => {
  it("段階 1 に上がって区域の消毒の行が増えても、その印の群（まだ）の末尾に入る。前からある行の順は変えない", async () => {
    listChecks.mockResolvedValue([{ id: "c1", kind: "disinfection", date: TODAY, itemId: "always-17" }]);
    let emit: (c: Case[]) => void = () => {};
    const base = makeDs({ cases: [] });
    const ds: DataSource = {
      ...base,
      subscribeCases: (_s, cb) => {
        emit = cb;
        cb([]);
        return () => {};
      },
    };
    mount(<TodoPage />, { ds });
    await todayList();
    const titles = () => Array.from(document.querySelectorAll<HTMLElement>(".today-row")).map(titleOf);
    const before = titles();
    act(() => emit([inTsuyama()]));
    await waitFor(() => expect(within(screen.getByRole("region", { name: TODAY_HEADING })).getAllByRole("button", { name: /^やった/ })).toHaveLength(6));
    const after = titles();
    expect(after.filter((t) => before.includes(t))).toEqual(before);
    const text = (id: string) => buildChecklist({ level: 1, production: null, housing: null }).flatMap((x) => x.items).find((i) => i.id === id)!.text;
    const done17 = after.indexOf(text("always-17"));
    const self = after.indexOf("自己点検");
    for (const id of ["zone-entry", "zone-lime", "zone-inside"]) {
      const i = after.indexOf(text(id));
      expect(i, id).toBeGreaterThanOrEqual(0);
      expect(i, id).toBeLessThan(done17);
      expect(i, id).toBeLessThan(self);
    }
  });
});

describe("AI の相談から足した対策の行（会員だけ。今日のやることの中）", () => {
  it("参照の節は今日のやることの直後に詰めず、上を 24px（--s3）空ける（2026-11-07 精査 T3 を引き継ぐ）", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const css = readFileSync(path.join(import.meta.dirname, "todo.css"), "utf8");
    expect(css.match(/\.todo-ref\s*\{([^}]*)\}/)?.[1] ?? "").toMatch(/margin-top:\s*var\(--s3\)/);
  });

  it("足したカードが 1 行ずつ、対策の文と「AI の相談から追加」。根拠の札・資料名と「外す」は「くわしく」の中", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "aphis-A01"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const rows = reviewRows();
    expect(rows.map(titleOf)).toEqual(["着替え・履き替えの前後の動線を分ける", "鶏舎の入口で専用の靴に履き替える"]);
    const fold = rows[0]!.querySelector("details")!;
    expect(fold.textContent).toContain("義務");
    expect(fold.textContent).toContain("飼養衛生管理基準遵守指導の手引き");
    expect(rows[1]!.querySelector("details")!.textContent).toContain("研究で関係あり");
    expect(within(fold).getByRole("button", { name: "外す", hidden: true })).toBeTruthy();
  });

  it("各項目の「この対策を AI に聞く」は、その対策の名前を入れた相談の画面へ。リストの下にも相談へのリンクを出す", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const list = await todayList();
    const row = reviewRows()[0]!;
    openFold(row);
    const ask = within(row).getByRole("link", { name: "この対策を AI に聞く" });
    expect(ask.getAttribute("href")).toBe(`/consult?q=${encodeURIComponent("着替え・履き替えの前後の動線を分ける")}`);
    expect(list.getByRole("link", { name: "AIに対策を相談する" }).getAttribute("href")).toBe("/consult");
  });

  it("今の資料にないカードには「この対策を AI に聞く」を出さない", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("gone-X99"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const list = await todayList();
    expect(list.getByText("このカードは今の資料にありません。")).toBeTruthy();
    expect(list.queryByRole("link", { name: "この対策を AI に聞く", hidden: true })).toBeNull();
  });

  it("「外す」を押すと消して、その行がなくなる", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "aphis-A01"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    expect(reviewRows()).toHaveLength(2);
    fireEvent.click(within(reviewRows()[0]!).getByRole("button", { name: "外す", hidden: true }));
    await waitFor(() => expect(reviewRows()).toHaveLength(1));
    expect(reviewBox.store.removeReview).toHaveBeenCalledWith("maff-M07");
    expect(screen.queryByText("着替え・履き替えの前後の動線を分ける")).toBeNull();
  });

  it("前に同じ対策の文のカードが 2 件とも足してあっても（相談の画面が二重に足すのを止める前の古いデータ）、落ちずに 2 行出て、記録はそれぞれの id に付く", async () => {
    const cat = reviewBox.catalog as { cards: Map<string, unknown> };
    cat.cards.set("maff-M07b", { id: "maff-M07b", action: "着替え・履き替えの前後の動線を分ける", evidence: "obligation", sourceId: "maff-s1" });
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07", "maff-M07b"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const rows = reviewRows();
    expect(rows.map(titleOf)).toEqual(["着替え・履き替えの前後の動線を分ける", "着替え・履き替えの前後の動線を分ける"]);
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M07b", { status: "done" });
    expect(reviewBox.store.markReview).toHaveBeenCalledTimes(1);
  });

  it("外すのに失敗したら、行は残り、失敗の文が出る", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("maff-M07"));
    reviewBox.store.removeReview.mockRejectedValue(new Error("permission-denied"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const row = reviewRows()[0]!;
    fireEvent.click(within(row).getByRole("button", { name: "外す", hidden: true }));
    expect((await within(row).findByRole("alert")).textContent).toBe("外せませんでした。もう一度お試しください。");
    expect(reviewRows()).toHaveLength(1);
  });

  it("0 件のときは案内の文と、相談へのリンクを出す", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const list = await todayList();
    expect(list.getByText(/相談の画面で『対策項目に追加する』を押すと、ここに並びます。/)).toBeTruthy();
    expect(list.getByRole("link", { name: "AIに対策を相談する" }).getAttribute("href")).toBe("/consult");
    expect(reviewRows()).toHaveLength(0);
  });

  it("今の資料にないカードの id は、その旨と「外す」だけ出す", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(items("gone-X99"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    const row = reviewRows()[0]!;
    expect(titleOf(row)).toBe("このカードは今の資料にありません。");
    expect(within(row).getByRole("button", { name: "外す", hidden: true })).toBeTruthy();
    expect(within(row).queryByRole("group", { name: /^実施の状態/ })).toBeNull();
  });

  it("足した項目を読み込めなかったときは、読み込めなかった旨を出す（0 件と読ませない）", async () => {
    reviewBox.store.listReviewItems.mockRejectedValue(new Error("permission-denied"));
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    const list = await todayList();
    expect(list.getByRole("alert").textContent).toBe("足した見直しを読み込めませんでした。ページを読み込み直してください。");
    expect(list.queryByText(/相談の画面で『対策項目に追加する』を押すと/)).toBeNull();
  });

  it("会員でない（農場を読み込めない）ときは今日のやることを出さず、足した項目も読みにいかない", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: TODAY_HEADING })).toBeNull();
    expect(reviewBox.store.listReviewItems).not.toHaveBeenCalled();
    expect(reviewBox.store.listReviews).not.toHaveBeenCalled();
  });

  it("見本の農場（sample）では今日のやることを出さず、足した項目を読みにいかない", async () => {
    const sample = { ...store, mode: "sample" } as unknown as RecordStore;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }), store: sample });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: TODAY_HEADING })).toBeNull();
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
  const rowOf = (action: string) => reviewRows().find((li) => titleOf(li) === action)!;
  const pressed = (row: HTMLElement) =>
    within(row)
      .getAllByRole("button", { hidden: true })
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
  const NET = "防鳥ネットの破れを点検する";
  async function mountWith(list: ReviewItemFixture[]) {
    reviewBox.store.listReviewItems.mockResolvedValue(list);
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    await waitFor(() => expect(reviewRows()).toHaveLength(list.length));
  }

  it("各対策に「まだ」「後でやる」「やった」の 3 つのボタンが並び、押されている状態は aria-pressed", async () => {
    await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date("2026-11-07T21:30:00Z"), mine: true })]);
    const row = rowOf(NET);
    const group = within(row).getByRole("group", { name: `実施の状態: ${NET}` });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["まだ", "後でやる", "やった"]);
    expect(pressed(row)).toEqual(["後でやる"]);
  });

  it("前に足した対策（状態なし）は消さずに出し、「まだ」を押した形で、行ごとに補足「記録なし」と出す", async () => {
    await mountWith(items("maff-M02", "maff-M07"));
    for (const row of reviewRows()) {
      expect(pressed(row)).toEqual(["まだ"]);
      expect(row.querySelector(".today-sub")!.textContent).toContain("記録なし");
      expect(row.textContent).not.toContain("更新:");
    }
  });

  it("「やった」を押すと、その対策の状態だけを保存し（メモは送らない）、押した形と「更新: 日時（あなた）」に変わる。保存中は押せない", async () => {
    let finish: () => void = () => undefined;
    reviewBox.store.markReview.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await mountWith(items("maff-M02"));
    const row = rowOf(NET);
    fireEvent.change(within(row).getByLabelText("メモ（40 字まで）"), { target: { value: "未保存のメモ" } });
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { status: "done" });
    await waitFor(() => expect(within(row).getByRole("button", { name: "まだ" }).hasAttribute("disabled")).toBe(true));
    expect(within(row).getByRole("button", { name: "メモを保存", hidden: true }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(pressed(row)).toEqual(["やった"]));
    expect(row.textContent).toMatch(/更新: \d{1,2} 月 \d{1,2} 日 \d{1,2}:\d{2}（あなた）/);
    expect(within(row).getByRole("button", { name: "やった" }).hasAttribute("disabled")).toBe(false);
    expect(reviewBox.store.markReview).toHaveBeenCalledTimes(1);
  });

  it("「まだ」を押すと戻す（pending を保存）。メモは残る", async () => {
    await mountWith([reviewItem("maff-M02", { status: "done", note: "点検した", updatedAt: new Date(), mine: true })]);
    const row = rowOf(NET);
    fireEvent.click(within(row).getByRole("button", { name: "まだ" }));
    await waitFor(() => expect(pressed(row)).toEqual(["まだ"]));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { status: "pending" });
    expect((within(row).getByLabelText("メモ（40 字まで）") as HTMLInputElement).value).toBe("点検した");
    expect(row.textContent).not.toContain("記録なし");
  });

  it("押されている状態をもう一度押しても保存しない", async () => {
    await mountWith([reviewItem("maff-M02", { status: "done", updatedAt: new Date(), mine: true })]);
    fireEvent.click(within(rowOf(NET)).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).not.toHaveBeenCalled();
  });

  it("メモは 40 字まで・1 行で、「メモを保存」でメモだけを保存する（状態は送らない）", async () => {
    await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date(), mine: true })]);
    const row = rowOf(NET);
    openFold(row);
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
    // 保存したメモは、畳んでいても行に短く出る
    expect(row.textContent).toContain("メモ: 資材を用意してから再確認");
  });

  it("メモの欄は 1 行の入力で、貼り付けた改行は入らない。前後の空白は除いて保存する", async () => {
    await mountWith(items("maff-M02"));
    const row = rowOf(NET);
    fireEvent.change(within(row).getByLabelText("メモ（40 字まで）"), { target: { value: " 資材\n再確認 " } });
    fireEvent.click(within(row).getByRole("button", { name: "メモを保存", hidden: true }));
    await waitFor(() => expect(reviewBox.store.markReview).toHaveBeenCalledWith("maff-M02", { note: "資材再確認" }));
  });

  it("保存に失敗したら、理由を短く出して元の表示に戻す（権限・外された、と、通信）", async () => {
    reviewBox.store.markReview.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "permission-denied" }));
    await mountWith([reviewItem("maff-M02", { status: "later", updatedAt: new Date(), mine: true })]);
    const row = rowOf(NET);
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

  it("並びは開いたときに「まだ」（記録なしを含む）→「後でやる」→「やった」。押しても並べ替えない", async () => {
    const at = new Date();
    await mountWith([
      reviewItem("maff-M07", { status: "done", updatedAt: at, mine: true }),
      reviewItem("aphis-A01"),
      reviewItem("maff-M02", { status: "later", updatedAt: at, mine: true }),
      reviewItem("maff-M12", { status: "pending", updatedAt: at, mine: true }),
    ]);
    const order = () => reviewRows().map(titleOf);
    expect(order()).toEqual(["鶏舎の入口で専用の靴に履き替える", "敷地の除草をする", NET, "着替え・履き替えの前後の動線を分ける"]);
    fireEvent.click(within(rowOf(NET)).getByRole("button", { name: "やった" }));
    await waitFor(() => expect(pressed(rowOf(NET))).toEqual(["やった"]));
    expect(order()[2]).toBe(NET);
  });

  it("更新した人は、自分なら「（あなた）」、ほかの会員なら「（同じ農場の会員）」。時刻は日本時間", async () => {
    await mountWith([
      reviewItem("maff-M02", { status: "later", updatedAt: new Date("2026-11-07T21:30:00Z"), mine: true }),
      reviewItem("maff-M12", { status: "later", updatedAt: new Date("2026-11-08T00:05:00Z"), mine: false }),
    ]);
    expect(rowOf(NET).textContent).toContain("更新: 11 月 8 日 6:30（あなた）");
    expect(rowOf("敷地の除草をする").textContent).toContain("更新: 11 月 8 日 9:05（同じ農場の会員）");
  });

  it("既存の操作（この対策を AI に聞く、外す）はそのまま。今の資料にないカードは状態のボタンを出さない", async () => {
    await mountWith([reviewItem("maff-M02", { status: "done", updatedAt: new Date(), mine: true }), reviewItem("gone-X99")]);
    const row = rowOf(NET);
    expect(within(row).getByRole("link", { name: "この対策を AI に聞く", hidden: true }).getAttribute("href")).toBe(`/consult?q=${encodeURIComponent(NET)}`);
    const gone = rowOf("このカードは今の資料にありません。");
    expect(within(gone).queryByRole("group", { name: /^実施の状態/ })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "外す", hidden: true }));
    await waitFor(() => expect(reviewRows()).toHaveLength(1));
    expect(reviewBox.store.removeReview).toHaveBeenCalledWith("maff-M02");
  });
});

// 2026-11-08 レビュー 1 周目の設計: 目次（段階 1 だけ）、確認リストの見出し、段階 1 の短い確認の重なり、出典の集約、解除の見込みの枠の色
describe("目次（見出しのある節が 4 つ以上のときだけ）", () => {
  const toc = () => screen.queryByRole("navigation", { name: "目次" });
  const tocNames = () => within(toc()!).getAllByRole("link").map((a) => a.textContent?.replace(/^\d+/u, "") ?? "");
  const short = (heading: string) => heading.split("（")[0]!;
  const level1Sections = () => orderSections(1, buildChecklist({ level: 1, production: null, housing: null }));

  it("見本と会員でない人の段階 1: 短い確認のすぐ下に 5 件。画面の順で、確認リストの枠には項目数を添える（buildChecklist の数と同じ）", async () => {
    farm = null;
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    const nav = toc()!;
    expect(nav).not.toBeNull();
    // 短い確認（区域に入っている可能性…）を目次で押し下げない: 目次は短い確認のすぐ下、解除の見込みより上（2026-11-08 2 周目）
    const reminder = screen.getByRole("list", { name: "短い確認" });
    expect(nav.previousElementSibling).toBe(reminder);
    expect(reminder.previousElementSibling?.classList.contains("as-of")).toBe(true);
    expect(nav.compareDocumentPosition(screen.getByRole("region", { name: "解除の見込み" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 「目次」の文字は見出しにしない（ページの見出しの並びを変えない）
    expect(screen.queryByRole("heading", { name: "目次" })).toBeNull();
    const sections = level1Sections();
    expect(tocNames()).toEqual([
      "解除の見込み（津山市）",
      "働く人への声かけ文",
      ...sections.map((s) => `${short(s.heading)} ${s.items.length} 項目`),
    ]);
    expect(sections.map((s) => s.class)).toEqual(["if_in_zone", "always", "good_to_check"]);
    // 番号は 1 から順に
    expect(within(nav).getAllByRole("link").map((a) => a.querySelector(".todo-toc-num")?.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    // 飛び先はどれも画面にあり、目次の順と画面の順が同じ
    const targets = within(nav)
      .getAllByRole("link")
      .map((a) => container.querySelector<HTMLElement>(a.getAttribute("href")!)!);
    expect(targets.every((t) => t !== null)).toBe(true);
    for (let i = 1; i < targets.length; i++) expect(targets[i - 1]!.compareDocumentPosition(targets[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 赤（--lv1 の縦線）は区域の札だけ。ほかの札は枠の線の種類を写す
    const classes = within(nav)
      .getAllByRole("link")
      .map((a) => a.className);
    expect(classes).toEqual(["", "", "toc-if_in_zone", "toc-always", "toc-good_to_check"]);
  });

  it("「確認リストを閉じる」で確認リストの 3 件が目次から消える（残りが 4 つ未満なので目次ごと出ない）。開き直すと戻る", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    expect(tocNames()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: LESS }));
    expect(toc()).toBeNull();
    openMore();
    expect(tocNames()).toHaveLength(5);
  });

  it("段階 4 と段階 2 には目次がない（確認リストを開いても）", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await ready();
    openMore();
    expect(toc()).toBeNull();
    cleanup();
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    openMore();
    expect(screen.getByRole("heading", { name: "いつも求められていること" })).toBeTruthy();
    expect(toc()).toBeNull();
  });

  it("札を押すと、その節へ動かして焦点を移す（節は tabIndex -1）", async () => {
    const original = Element.prototype.scrollIntoView;
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      farm = null;
      mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
      await screen.findByRole("region", { name: "解除の見込み" });
      const always = within(toc()!).getByRole("link", { name: /^いつも求められていること/ });
      fireEvent.click(always);
      const block = screen.getByRole("heading", { name: "いつも求められていること" }).closest("section")!;
      expect(document.activeElement).toBe(block);
      expect(block.getAttribute("tabindex")).toBe("-1");
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(block);
      expect(scroll.mock.calls[0]![0]).toEqual({ block: "start" });
      fireEvent.click(within(toc()!).getByRole("link", { name: "働く人への声かけ文" }));
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "働く人への声かけ文" }));
      fireEvent.click(within(toc()!).getByRole("link", { name: "解除の見込み（津山市）" }));
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "解除の見込み" }));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("会員の段階 1: 4 件（解除の見込み、区域、今日のやること、参照）。今日のやることには件数を添えない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await todayList();
    const zone = level1Sections().find((s) => s.class === "if_in_zone")!;
    expect(tocNames()).toEqual(["解除の見込み（津山市）", `区域に入っていれば求められること ${zone.items.length} 項目`, "今日のやること", "参照"]);
    // 短い確認のすぐ下（題の行と短い確認の間に入れない）
    expect(toc()!.previousElementSibling).toBe(screen.getByRole("list", { name: "短い確認" }));
    for (const a of within(toc()!).getAllByRole("link")) expect(document.querySelector(a.getAttribute("href")!)).not.toBeNull();
  });

  it("会員の段階 4 には目次がない", async () => {
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await todayList();
    expect(toc()).toBeNull();
  });

  it("解除の見込みが複数の町なら「（最初の町）ほか」", () => {
    expect(TODO_TEXT.tocTowns(["津山市"])).toBe("津山市");
    expect(TODO_TEXT.tocTowns(["津山市", "美作市"])).toBe("津山市ほか");
    expect(TODO_TEXT.tocTowns([])).toBe("");
  });

  it("新しい文言（目次、項目数、確認リストの見出し、出典の位置の読み上げ）に禁止語がなく、「足す」「つける」「おして」を使わない", () => {
    const words = [TODO_TEXT.tocLabel, TODO_TEXT.tocItems(6), TODO_TEXT.tocTowns(["津山市", "美作市"]), TODO_TEXT.checklistHeading, TODO_TEXT.sourcePositionLabel("資料", "項目 17")].join("\n");
    expect(findForbiddenPhrases(words)).toEqual([]);
    expect(words).not.toMatch(/足す|つける|おして/u);
  });
});

describe("目次以外の直し（2026-11-08）", () => {
  it("確認リストの群に見出し「確認リスト」（h2）があり、その下に説明の 1 行と開くボタン。中の 3 枠の見出しは h3（見本と会員でない人）", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [farAway()] }) });
    await ready();
    const h = screen.getByRole("heading", { level: 2, name: TODO_TEXT.checklistHeading });
    const group = h.closest("section")!;
    expect(group.id).toBe("todo-checklist");
    expect(within(group).getByText(TODO_TEXT.moreLead)).toBeTruthy();
    expect(within(group).getByRole("button", { name: MORE })).toBeTruthy();
    openMore();
    expect(within(group).getByRole("heading", { level: 3, name: "いつも求められていること" })).toBeTruthy();
    expect(within(group).queryAllByRole("heading", { level: 2 })).toEqual([h]);
  });

  it("段階 1 の短い確認から「正式な情報は県の連絡です」を除く（解除の見込みの枠が出す）。見本・会員でない人と、会員の両方。段階 2 は今のまま", async () => {
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    const region = await screen.findByRole("region", { name: "解除の見込み" });
    const reminder = screen.getByRole("list", { name: "短い確認" });
    expect(within(reminder).getAllByRole("listitem").map((li) => li.textContent)).toEqual(shortReminder(1).filter((l) => l !== FIXED_TEXT.prefContactIsAuthority));
    expect(within(reminder).getAllByRole("listitem")).toHaveLength(3);
    expect(region.textContent).toContain(FIXED_TEXT.prefContactIsAuthority);
    cleanup();
    // 会員の段階 1 も同じ（2026-11-08 2 周目）。画面の中で 1 回だけ（解除の見込みの枠）
    farm = farmFixture();
    mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await todayList();
    const memberReminder = screen.getByRole("list", { name: "短い確認" });
    expect(within(memberReminder).getAllByRole("listitem")).toHaveLength(3);
    expect(memberReminder.textContent).not.toContain(FIXED_TEXT.prefContactIsAuthority);
    expect(within(screen.getByRole("region", { name: "解除の見込み" })).getByText(/正式な情報は県の連絡です/)).toBeTruthy();
    cleanup();
    farm = null;
    mount(<TodoPage />, { ds: makeDs({ cases: [inTottori()] }) });
    await screen.findByText("近くの町で発表がありました。県の発表を確かめましょう");
    expect(within(screen.getByRole("list", { name: "短い確認" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("出典の集約: 全項目が同じ出典の枠（区域・いつも）は見出しの直下に出典を 1 回、各項目は位置だけを同じ URL のリンクで。混ざる枠（確かめておくとよいこと）は今のまま各項目に", async () => {
    farm = null;
    const { container } = mount(<TodoPage />, { ds: makeDs({ cases: [inTsuyama()] }) });
    await screen.findByRole("region", { name: "解除の見込み" });
    const sections = orderSections(1, buildChecklist({ level: 1, production: null, housing: null }));
    for (const s of sections) {
      const block = container.querySelector<HTMLElement>(`.class-${s.class}`)!;
      const lines = block.querySelectorAll(".source-line");
      if (s.class === "good_to_check") {
        // 出典が混ざる: 枠の上には出さず、各項目に 1 行ずつ
        expect(sharedSource(s.items)).toBeNull();
        expect(block.querySelector(":scope > .source-line")).toBeNull();
        expect(lines).toHaveLength(s.items.length);
        continue;
      }
      const src = s.items[0]!.source;
      expect(sharedSource(s.items)).toEqual(src);
      // 見出しの直下に 1 回だけ
      expect(lines).toHaveLength(1);
      expect(block.querySelector(":scope > h3")!.nextElementSibling).toBe(lines[0]);
      expect(lines[0]!.textContent).toBe(`出典: ${src.title}`);
      // 各項目から出典へたどれる: 位置のリンクが出典と同じ URL
      const rows = block.querySelectorAll<HTMLElement>(".todo-items > li");
      expect(rows).toHaveLength(s.items.length);
      s.items.forEach((item, i) => {
        const a = rows[i]!.querySelector<HTMLAnchorElement>(".todo-pos a")!;
        // 何の位置か分かるよう、灰色の「出典の」を前に置く（リンクは位置の部分だけ）
        expect(a.parentElement!.textContent).toBe(`${TODO_TEXT.sourcePositionLead}${a.textContent}`);
        expect(a.parentElement!.classList.contains("todo-note")).toBe(true);
        expect(a.getAttribute("href")).toBe(src.url);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.textContent!.length).toBeGreaterThan(0);
        expect(a.textContent).not.toMatch(/。$/u);
        expect(a.getAttribute("aria-label")).toBe(`出典: ${src.title}（${a.textContent}）`);
        expect(rows[i]!.textContent).not.toContain("出典:");
      });
    }
    // 区域の枠の位置は「第 9 の 1(5)、留意事項 48」のような文
    const zoneLinks = [...container.querySelectorAll(".class-if_in_zone .todo-pos a")].map((a) => a.textContent);
    expect(zoneLinks[0]).toBe("第 9 の 1(5)、留意事項 48");
  });

  it("sharedSource: 空、出典の混ざり、位置のない項目は null（まとめない）", () => {
    const items = buildChecklist({ level: 1, production: null, housing: null }).flatMap((s) => s.items);
    const always = items.filter((i) => i.class === "always");
    expect(sharedSource([])).toBeNull();
    expect(sharedSource(always)?.title).toBe(always[0]!.source.title);
    expect(sharedSource(items)).toBeNull();
    const noPos = { ...always[0]!, source: { ...always[0]!.source, note: null } };
    expect(sharedSource([...always, noPos])).toBeNull();
  });

  it("消毒の記録の画面（DisinfectionPanel）は、枠の部品を使うが、目次の飛び先にも出典の集約にもならない。枠の見出しは h2 のまま", async () => {
    const { container } = mount(<DisinfectionPanel />, { path: "/record/disinfection", ds: makeDs({ cases: [farAway()] }) });
    await screen.findByText(/^次にすること: /);
    const blocks = container.querySelectorAll(".class-block");
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.hasAttribute("id")).toBe(false);
      expect(b.hasAttribute("tabindex")).toBe(false);
      expect(b.querySelector(":scope > .source-line")).toBeNull();
      expect(b.querySelector(":scope > h2")).not.toBeNull();
      expect(b.querySelector(":scope > h3")).toBeNull();
    }
  });

  it("CSS: 解除の見込みの枠は中立の線（--line）で赤を使わない。赤は区域の枠と、目次の区域の札の縦線だけ。解除の見込みの h3 は 1.1rem", () => {
    const todoCss = readFileSync(path.resolve(import.meta.dirname, "todo.css"), "utf8");
    const theme = readFileSync(path.resolve(import.meta.dirname, "../../ui/theme.css"), "utf8");
    const rule = (css: string, sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
    const lift = rule(todoCss, ".lift-region")!;
    expect(lift).toMatch(/border:\s*2px solid var\(--line\)/);
    expect(lift).not.toContain("--lv1");
    expect(rule(todoCss, ".lift-block > h3")).toMatch(/font-size:\s*1\.1rem/);
    expect(rule(theme, ".class-if_in_zone")).toMatch(/var\(--lv1\)/);
    // todo.css で --lv1 を使うのは、目次の区域の札だけ
    const lv1 = [...todoCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[2]!.includes("--lv1")).map((m) => m[1]!.trim().split("\n").at(-1));
    expect(lv1).toEqual([".todo-toc a.toc-if_in_zone"]);
  });

  it("CSS（2 周目）: 目次は PC で同じ幅の 2 列、スマホで 1 列。札の名前に下線を付けず、触れたとき・焦点で示す。位置のリンクは上下の padding で押せる高さ（行は広げない）", () => {
    const todoCss = readFileSync(path.resolve(import.meta.dirname, "todo.css"), "utf8");
    const theme = readFileSync(path.resolve(import.meta.dirname, "../../ui/theme.css"), "utf8");
    const rule = (css: string, sel: string) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
    expect(rule(todoCss, ".todo-toc ol")).toMatch(/display:\s*grid/);
    expect(rule(todoCss, ".todo-toc ol")).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    const narrow = /@media \(max-width: 40rem\) \{([\s\S]*?)\n\}/.exec(todoCss.slice(todoCss.indexOf(".todo-toc {")))![1]!;
    expect(rule(narrow, ".todo-toc ol")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(rule(todoCss, ".todo-toc-name")).not.toMatch(/text-decoration/);
    expect(todoCss).toMatch(/\.todo-toc a:hover \.todo-toc-name,\s*\.todo-toc a:focus-visible \.todo-toc-name\s*\{\s*text-decoration:\s*underline/);
    const pos = rule(todoCss, ".todo-pos a")!;
    expect(pos).toMatch(/padding-block:\s*11px/);
    expect(pos).not.toMatch(/min-height/);
    expect(rule(todoCss, ".todo-pos")).toBeNull();
    // 枠の見出しは h2 でも h3 でも同じ並び。h3 は一段小さい
    expect(theme).toMatch(/\.class-block > :is\(h2, h3\) \{/);
    expect(rule(theme, ".class-block > h3")).toMatch(/font-size:\s*1\.15rem/);
  });
});
