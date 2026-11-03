// M-18: 働く人への声かけ文の画面。直してコピーでき、保存しない。雛形か Claude かを示す。
import { workerMessageTemplate } from "@hpai/shared/drafts";
import { createGeoStore, type GeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { Case, CaseDraft, FarmPoint, Season, WatchStatus } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource, RecordStore } from "../../data/types";
import { WORKER_MESSAGE_TEXT } from "./texts";
import { WorkerMessagePanel } from "./WorkerMessagePanel";

const geoBox = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../../geo/loadGeo", () => ({ loadWebGeoStore: () => Promise.resolve(geoBox.store) }));
vi.mock("../auth/useAuthUser", () => ({
  useAuthUser: () => ({ user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} }),
}));

import TodoPage from "./TodoPage";

const dataDir = (...p: string[]) => path.resolve(import.meta.dirname, "../../../../data/geo", ...p);
const freshGeo = (): GeoStore =>
  createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => JSON.parse(readFileSync(dataDir("pref", `${p}.topo.json`), "utf8")) as unknown,
  });

const NOW = new Date("2026-01-05T09:00:00+09:00");
const SPOT: FarmPoint = { meshCode: latLngToMesh3(35.146, 133.995), muniCode: "33203", frequentMuniCodes: [] };
const CONFIRMED = { muniName: "津山市", date: "2025-12-20", stage: "confirmed" as const };
const SUSPECTED = { ...CONFIRMED, stage: "suspected" as const };
const TEMPLATE_CONFIRMED = workerMessageTemplate(CONFIRMED);
const TEMPLATE_SUSPECTED = workerMessageTemplate(SUSPECTED);

const draft = (workerMessage: string, source: CaseDraft["source"] = "claude"): CaseDraft => ({
  caseId: "t1",
  workerMessage,
  source,
  createdAt: "2025-12-20T12:00:00+09:00",
});

function makeDs(mode: "live" | "replay" = "live", cases: Case[] = []): DataSource {
  const watch: WatchStatus[] = PREFS.map((p) => ({ prefCode: p.code, checkedAt: "2026-01-05T08:30:00+09:00", ok: true, lastOkAt: "2026-01-05T08:30:00+09:00", failingSince: null }));
  return {
    mode,
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => (cb(cases), () => {}),
    subscribeWildBirds: (_s, cb) => (cb([]), () => {}),
    subscribeWatchStatus: (cb) => (cb(watch), () => {}),
    loadHistory: async () => [],
  };
}

/** getCaseDraft 以外を呼ぶと投げる記録の口。保存しないことを確かめる。 */
function strictStore(getCaseDraft: RecordStore["getCaseDraft"], mode: RecordStore["mode"] = "firestore") {
  const touched: string[] = [];
  const base = { mode, getCaseDraft } as Record<string, unknown>;
  const store = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (typeof k === "string") {
        return () => {
          touched.push(k);
          return Promise.reject(new Error(`呼んではいけない: ${k}`));
        };
      }
      return undefined;
    },
  }) as unknown as RecordStore;
  return { store, touched };
}

function mount(ui: React.ReactNode, store: RecordStore, ds: DataSource = makeDs(), spot: FarmPoint | null = SPOT) {
  return render(
    <MemoryRouter initialEntries={["/todo"]}>
      <DataSourceProvider value={ds}>
        <RecordStoreProvider value={store}>
          <SpotProvider fixed={spot}>
            <Routes>
              <Route path="/todo" element={ui} />
            </Routes>
          </SpotProvider>
        </RecordStoreProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

const box = () => screen.getByRole("textbox", { name: WORKER_MESSAGE_TEXT.label }) as HTMLTextAreaElement;
const clipboard = vi.fn<(t: string) => Promise<void>>();

beforeEach(() => {
  geoBox.store = freshGeo();
  localStorage.clear();
  sessionStorage.clear();
  clipboard.mockReset();
  clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
});
afterEach(cleanup);

describe("雛形と Claude の下書き", () => {
  it("getCaseDraft が null（sample、再現、農場のない人）なら雛形。雛形だと示す", async () => {
    const { store } = strictStore(vi.fn(async () => null));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    expect(screen.getByText(WORKER_MESSAGE_TEXT.sourceTemplate)).toBeTruthy();
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.sourceClaude)).toBeNull();
  });

  it("Claude の下書きがあればそれを出し、Claude の下書きだと示す", async () => {
    const { store } = strictStore(vi.fn(async () => draft("Claude の文です。")));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe("Claude の文です。"));
    expect(screen.getByText(WORKER_MESSAGE_TEXT.sourceClaude)).toBeTruthy();
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.sourceTemplate)).toBeNull();
  });

  it("サーバーが雛形で残した下書き（source: template）は雛形として示す", async () => {
    const { store } = strictStore(vi.fn(async () => draft(TEMPLATE_CONFIRMED, "template")));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    expect(screen.getByText(WORKER_MESSAGE_TEXT.sourceTemplate)).toBeTruthy();
  });

  it("getCaseDraft が reject しても、同期で投げても、例外にせず雛形に戻る", async () => {
    const rejecting = strictStore(vi.fn(async () => Promise.reject(new Error("権限がありません"))));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, rejecting.store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    cleanup();
    const throwing = strictStore((() => {
      throw new Error("同期で投げる");
    }) as RecordStore["getCaseDraft"]);
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, throwing.store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
  });

  it("読んでいる間は文を出さず、読み込み中と伝える", async () => {
    let resolve!: (d: CaseDraft | null) => void;
    const { store } = strictStore(vi.fn(() => new Promise<CaseDraft | null>((r) => (resolve = r))));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(store.getCaseDraft).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toContain(WORKER_MESSAGE_TEXT.loading);
    expect(screen.queryByRole("textbox")).toBeNull();
    resolve(null);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
  });

  it("sample の記録の口と再現のデータの口では getCaseDraft を呼ばず、雛形を出す", async () => {
    const get = vi.fn(async () => draft("呼ばれてはいけない"));
    const sample = strictStore(get, "sample");
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, sample.store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    cleanup();
    const replay = strictStore(get, "firestore");
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, replay.store, makeDs("replay"));
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    expect(get).not.toHaveBeenCalled();
  });
});

describe("直してコピーする（保存しない）", () => {
  it("直した文をそのままコピーする。保存の口も端末の保存も使わない", async () => {
    const { store, touched } = strictStore(vi.fn(async () => draft("Claude の文です。")));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe("Claude の文です。"));
    fireEvent.change(box(), { target: { value: "直した文です。" } });
    expect(box().value).toBe("直した文です。");
    fireEvent.click(screen.getByRole("button", { name: WORKER_MESSAGE_TEXT.copy }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith("直した文です。"));
    await screen.findByText(WORKER_MESSAGE_TEXT.copied);
    expect(touched).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByText(WORKER_MESSAGE_TEXT.notSaved)).toBeTruthy();
  });

  it("コピーできなかったときは、そう伝える", async () => {
    clipboard.mockRejectedValue(new Error("拒否"));
    const { store } = strictStore(vi.fn(async () => null));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    fireEvent.click(screen.getByRole("button", { name: WORKER_MESSAGE_TEXT.copy }));
    await screen.findByText(WORKER_MESSAGE_TEXT.copyFailed);
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.copied)).toBeNull();
  });

  it("文を直し始めたら『コピーしました』は消える", async () => {
    const { store } = strictStore(vi.fn(async () => null));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    fireEvent.click(screen.getByRole("button", { name: WORKER_MESSAGE_TEXT.copy }));
    await screen.findByText(WORKER_MESSAGE_TEXT.copied);
    fireEvent.change(box(), { target: { value: `${TEMPLATE_CONFIRMED}お願いします。` } });
    expect(screen.queryByText(WORKER_MESSAGE_TEXT.copied)).toBeNull();
  });
});

describe("確定の事例に『疑い』が残っているとき", () => {
  it("直すよう添える。直すと消える", async () => {
    const { store } = strictStore(vi.fn(async () => draft(TEMPLATE_SUSPECTED)));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_SUSPECTED));
    expect(screen.getByRole("alert").textContent).toBe(WORKER_MESSAGE_TEXT.staleSuspected);
    fireEvent.change(box(), { target: { value: TEMPLATE_CONFIRMED } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("疑いの事例では添えない。確定で『疑い』がなくても添えない", async () => {
    const suspected = strictStore(vi.fn(async () => draft(TEMPLATE_SUSPECTED)));
    mount(<WorkerMessagePanel caseId="t1" facts={SUSPECTED} />, suspected.store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_SUSPECTED));
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    const confirmed = strictStore(vi.fn(async () => draft(TEMPLATE_CONFIRMED)));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, confirmed.store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("全角や空白で割れた『疑 い』も見つける", async () => {
    const { store } = strictStore(vi.fn(async () => draft("12月20日、津山市で疑 い が出ました。")));
    mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await screen.findByRole("alert");
  });
});

describe("言葉", () => {
  it("下書きの注意を出し、禁句を使わない", async () => {
    const { store } = strictStore(vi.fn(async () => null));
    const { container } = mount(<WorkerMessagePanel caseId="t1" facts={CONFIRMED} />, store);
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    const text = container.textContent ?? "";
    expect(text).toContain(WORKER_MESSAGE_TEXT.heading);
    expect(text).toContain(WORKER_MESSAGE_TEXT.lead);
    expect(text).toContain(WORKER_MESSAGE_TEXT.basis);
    for (const v of Object.values(WORKER_MESSAGE_TEXT)) expect(findForbiddenPhrases(v)).toEqual([]);
    expect(findForbiddenPhrases(text)).toEqual([]);
  });
});

describe("やること画面への置き方", () => {
  const caseT1 = (o: Partial<Case> = {}): Case => ({
    id: "t1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
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
  });

  it("近くで発生したとき（段階 1）に、その事例の声かけ文を出す。事例の id で下書きを頼む", async () => {
    const get = vi.fn(async (_id: string) => null);
    const { store } = strictStore(get as RecordStore["getCaseDraft"]);
    // 農場の読み込みは別。getFarm は null にして記録の部分を静かにする
    (store as unknown as { getFarm: () => Promise<null> }).getFarm = async () => null;
    mount(<TodoPage />, store, makeDs("live", [caseT1()]));
    await waitFor(() => expect(box().value).toBe(TEMPLATE_CONFIRMED));
    expect(get).toHaveBeenCalledWith("t1");
    expect(screen.getByRole("region", { name: WORKER_MESSAGE_TEXT.heading })).toBeTruthy();
  });

  it("疑いの事例には疑いの雛形", async () => {
    const { store } = strictStore(vi.fn(async () => null));
    (store as unknown as { getFarm: () => Promise<null> }).getFarm = async () => null;
    mount(<TodoPage />, store, makeDs("live", [caseT1({ stages: { suspected: { date: "2025-12-20", time: null } } })]));
    await waitFor(() => expect(box().value).toBe(TEMPLATE_SUSPECTED));
  });

  it("近くに発生がない（段階 4）と、地点がないときは出さない", async () => {
    const far = caseT1({ id: "far", muniCode: "13101", muniName: "千代田区", prefCode: "13" });
    const none = strictStore(vi.fn(async () => null));
    (none.store as unknown as { getFarm: () => Promise<null> }).getFarm = async () => null;
    mount(<TodoPage />, none.store, makeDs("live", [far]));
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: WORKER_MESSAGE_TEXT.heading })).toBeNull();
    cleanup();
    mount(<TodoPage />, none.store, makeDs("live", [caseT1()]), null);
    await screen.findByText(/町を選ぶと/);
    expect(screen.queryByRole("region", { name: WORKER_MESSAGE_TEXT.heading })).toBeNull();
  });

  it("下書きを作れない事例（否定された事例）には出さない", async () => {
    const { store } = strictStore(vi.fn(async () => null));
    (store as unknown as { getFarm: () => Promise<null> }).getFarm = async () => null;
    mount(<TodoPage />, store, makeDs("live", [caseT1({ negation: "negated" })]));
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: WORKER_MESSAGE_TEXT.heading })).toBeNull();
  });
});
