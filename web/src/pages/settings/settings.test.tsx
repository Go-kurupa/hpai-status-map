import type { MuniEntry } from "@hpai/shared/geo";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { Farm } from "@hpai/shared/types";
import { JUDGE_FARM_ID } from "@hpai/shared/judge";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { findForbiddenPhrases, findWordingViolations } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFY_FIXTURE, farmFixture } from "../../../../shared/test/helpers/mFixtures";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import type { DataSource, RecordStore } from "../../data/types";
import { MultipleFarmsError } from "../auth/firestoreRecordStore";
import { PRIVACY_NOTICE } from "../privacy/privacyNotice";
import { RECORD_TEXT } from "../record/recordTexts";
import { TEXT } from "../map/texts";

// 地図（WebGL）は jsdom にないので、maplibre の入口を偽物にする。クリックは偽の地図から起こす
interface FakeMap {
  options: Record<string, unknown>;
  handlers: Map<string, (e: unknown) => void>;
  sources: Map<string, { data: unknown }>;
  removed: boolean;
}
const maps: FakeMap[] = [];
// true にすると、WebGL2 が使えない端末のように地図の初期化が投げる
const noWebgl = vi.hoisted(() => ({ value: false }));
vi.mock("../../geo/maplibre", () => {
  class MlMap {
    fake: FakeMap;
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    constructor(options: Record<string, unknown>) {
      if (noWebgl.value) throw new Error("GPUInitializationError: WebGL2 is required to display this map");
      this.fake = { options, handlers: new Map(), sources: new Map(), removed: false };
      maps.push(this.fake);
    }
    isStyleLoaded() {
      return true;
    }
    once(_e: string, _cb: () => void) {}
    on(e: string, cb: (x: unknown) => void) {
      this.fake.handlers.set(e, cb);
    }
    addSource(id: string, spec: { data: unknown }) {
      this.fake.sources.set(id, { data: spec.data });
    }
    addLayer() {}
    getSource(id: string) {
      const s = this.fake.sources.get(id);
      return s ? { setData: (d: unknown) => void (s.data = d) } : undefined;
    }
    fitBounds() {}
    getCanvas() {
      return { style: {} as Record<string, string> };
    }
    remove() {
      this.fake.removed = true;
    }
  }
  return { MlMap, AttributionControl: class {}, Marker: class {} };
});

const CHIYODA: MuniEntry = { code: "13101", name: "千代田区", prefCode: "13", center: [139.75, 35.69], bbox: [139.73, 35.67, 139.79, 35.71] };
const OKAYAMA: MuniEntry = { code: "33100", name: "岡山市", prefCode: "33", center: [133.9, 34.65], bbox: [133.7, 34.5, 134.1, 34.8] };
const geoStore = vi.hoisted(() => ({ ensured: [] as string[] }));
vi.mock("../../geo/loadGeo", () => ({
  loadWebGeoStore: async () => ({
    index: { "13101": CHIYODA, "33100": OKAYAMA },
    adjacency: {},
    ensurePrefs: async (p: string[]) => void geoStore.ensured.push(...p),
    geometry: (c: string) => ({ type: "Feature", properties: { c }, geometry: { type: "Polygon", coordinates: [] } }),
  }),
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

const createInvite = vi.hoisted(() => ({ fn: vi.fn() }));
const deleteCall = vi.hoisted(() => vi.fn<(farmId: string, confirmName: string) => Promise<void>>());
vi.mock("../auth/callables", () => ({
  createFarmInviteCall: createInvite.fn,
  redeemInviteCall: vi.fn(),
  deleteFarmDataCall: deleteCall,
}));

const resumeCall = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("./resumeMailCall", () => ({ resumeMailCall: resumeCall.fn }));

import { dueDateOf, NEW_FARM_NOTIFY, pickToFarmPatch, savedAtLabel, seasonMonths, uniformDueDay } from "./farmForm";
import FarmSettingsPage from "./FarmSettingsPage";
import NotifySettingsPage from "./NotifySettingsPage";

type Saved = Farm & { id: string };
let farm: Saved | null;
let store: RecordStore;
const saveFarm = vi.fn();
let nextUpdatedAt = "2026-11-06T10:30:00+09:00";
let mailStopped = false;

const NOW = new Date("2026-11-06T10:30:00+09:00"); // 今季は 2026
const dataSource = { mode: "live", now: () => NOW } as unknown as DataSource;

beforeEach(() => {
  maps.length = 0;
  noWebgl.value = false;
  geoStore.ensured.length = 0;
  authState.value = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  farm = { id: "f1", ...farmFixture("u1") };
  nextUpdatedAt = "2026-11-06T10:30:00+09:00";
  mailStopped = false;
  createInvite.fn.mockReset();
  deleteCall.mockReset();
  deleteCall.mockResolvedValue(undefined);
  resumeCall.fn.mockReset();
  resumeCall.fn.mockImplementation(async () => {
    mailStopped = false;
  });
  saveFarm.mockReset();
  saveFarm.mockImplementation(async (patch: Partial<Farm>) => {
    // 実物の保存と同じく、渡した項目だけを変えて updatedAt を進める
    farm = { ...(farm ?? { id: "f-new", ...farmFixture("u1", { notify: NEW_FARM_NOTIFY }) }), ...patch, updatedAt: nextUpdatedAt } as Saved;
  });
  store = {
    mode: "firestore",
    getFarm: vi.fn(async () => farm),
    saveFarm,
    listHouses: vi.fn(async () => []), // 鶏舎の欄（M-05）が読む。この試験の対象ではない
    saveHouse: vi.fn(),
    isMailStopped: vi.fn(async () => mailStopped),
  } as unknown as RecordStore;
});
afterEach(cleanup);

function LocationProbe() {
  const l = useLocation();
  return <p data-testid="at">{l.pathname}</p>;
}

function mount(initial: string, over: Partial<RecordStore> = {}) {
  const wrap = (el: React.ReactNode) => (
    <DataSourceProvider value={dataSource}>
      <RecordStoreProvider value={{ ...store, ...over }}>
        <LocationProbe />
        {el}
      </RecordStoreProvider>
    </DataSourceProvider>
  );
  const routes: RouteObject[] = [
    { path: "/settings/farm", element: wrap(<FarmSettingsPage />) },
    { path: "/settings/notify", element: wrap(<NotifySettingsPage />) },
    { path: "/login", element: <LocationProbe /> },
  ];
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [initial] })} />);
}

function clickMap(lat: number, lng: number) {
  const m = maps.at(-1)!;
  act(() => m.handlers.get("click")!({ lngLat: { lat, lng } }));
}

describe("farmForm", () => {
  it("pickToFarmPatch は千代田区の点を『meshCode、muniCode、prefCode』だけにする", () => {
    const patch = pickToFarmPatch({ lat: 35.681, lng: 139.767 }, CHIYODA);
    expect(patch).toEqual({ meshCode: "53394611", muniCode: "13101", prefCode: "13" });
    expect(JSON.stringify(patch)).not.toMatch(/35\.6|139\.7|lat|lng/);
  });

  it("seasonMonths(2026) は 2026-10 から 2027-05 の 8 か月", () => {
    expect(seasonMonths(2026)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]);
  });

  it("formatJaDate は『12月19日』", () => {
    expect(formatJaDate("2025-12-19")).toBe("12月19日");
  });

  it("新しい農場の notify は mFixtures の値と同じ", () => {
    expect(NEW_FARM_NOTIFY).toEqual(DEFAULT_NOTIFY_FIXTURE);
  });

  it("dueDateOf: 『各月の分』の期限は翌月の N 日。月にない日はその月の末日（年またぎ、うるう年も）", () => {
    expect(dueDateOf("2026-11", 5)).toBe("2026-12-05");
    expect(dueDateOf("2026-12", 5)).toBe("2027-01-05");
    expect(dueDateOf("2026-10", 31)).toBe("2026-11-30");
    expect(dueDateOf("2027-01", 31)).toBe("2027-02-28");
    expect(dueDateOf("2027-01", 29)).toBe("2027-02-28");
    expect(dueDateOf("2028-01", 30)).toBe("2028-02-29");
    expect(dueDateOf("2027-05", 1)).toBe("2027-06-01");
    expect(dueDateOf("2026-12", 31)).toBe("2027-01-31");
  });

  it("uniformDueDay: 8 か月が全部空なら ''、全部が同じ N から作った日なら N、それ以外（一部だけ空、日が違う、同じ月の日）は null", () => {
    const months = seasonMonths(2026);
    const of = (n: number) => Object.fromEntries(months.map((m) => [m, dueDateOf(m, n)]));
    expect(uniformDueDay({}, months)).toBe("");
    expect(uniformDueDay(Object.fromEntries(months.map((m) => [m, ""])), months)).toBe("");
    expect(uniformDueDay(of(5), months)).toBe(5);
    expect(uniformDueDay(of(31), months)).toBe(31);
    expect(uniformDueDay(of(28), months)).toBe(28);
    // 前季の月は見ない
    expect(uniformDueDay({ ...of(5), "2025-12": "2026-01-20" }, months)).toBe(5);
    const { ["2026-11"]: _gone, ...partial } = of(5);
    expect(uniformDueDay(partial, months)).toBeNull();
    expect(uniformDueDay({ ...of(5), "2027-02": "2027-03-06" }, months)).toBeNull();
    expect(uniformDueDay(Object.fromEntries(months.map((m) => [m, `${m}-05`])), months)).toBeNull();
  });

  it("savedAtLabel は日付と時刻を出す。読み込めなければ null", () => {
    expect(savedAtLabel("2026-11-06T10:30:00+09:00")).toBe("最終保存 11月6日 10:30");
    expect(savedAtLabel(undefined)).toBeNull();
    expect(savedAtLabel("昨日")).toBeNull();
  });
});

describe("/settings/farm", () => {
  it("会員でなければ、保存の欄を出さず /login へ（RequireMember で包む）", async () => {
    authState.value = { ...authState.value, user: null, member: false };
    mount("/settings/farm");
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe("/login"));
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
  });

  it("地図の欄に MAP_ATTRIBUTION の 3 つの出典がある。回転はできない", async () => {
    mount("/settings/farm");
    fireEvent.click(await screen.findByRole("button", { name: "地点を変える" }));
    const region = await screen.findByRole("region", { name: "農場の地点を選ぶ地図" });
    expect(region).toBeTruthy();
    const page = region.closest("section")!;
    expect(within(page).getByText(/地理院タイル/)).toBeTruthy();
    expect(within(page).getByText(/Vector Map Level 0/)).toBeTruthy();
    expect(within(page).getByText(/国土数値情報/)).toBeTruthy();
    // 地図は effect で作る。欄の DOM が出た時点では、まだ作られていないことがある
    await waitFor(() => expect(maps[0]?.options["dragRotate"]).toBe(false));
  });

  it("住所の欄がなく、『約 1km のマス目で保存します』と出す。点は描かない", async () => {
    const { container } = mount("/settings/farm");
    fireEvent.click(await screen.findByRole("button", { name: "地点を変える" }));
    await screen.findByRole("region", { name: "農場の地点を選ぶ地図" });
    expect(screen.getByText(/約 1km のマス目で保存します/)).toBeTruthy();
    expect(screen.queryByLabelText(/住所/)).toBeNull();
    expect(container.querySelector('input[name*="address" i], input[autocomplete*="address"]')).toBeNull();
    // 地図は effect で作る（上の試験と同じ）。重いときは欄の DOM の後になるので、作られるのを待つ
    const m = await waitFor(() => {
      expect(maps[0]).toBeDefined();
      return maps[0]!;
    });
    expect(m.sources.size).toBeLessThanOrEqual(2); // 町の境の線とマス目の四角だけ。点の層はない
  });

  it("町を選び、地図をおすまで『地点を保存』は押せない。選ぶと saveFarm にマス目と町のコードだけ渡す", async () => {
    farm = null;
    mount("/settings/farm");
    const save = await screen.findByRole("button", { name: "地点を保存" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "13" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "13101" } });
    expect((save as HTMLButtonElement).disabled).toBe(true); // 町だけでは保存できない（ルールが meshCode を要る）

    clickMap(35.681, 139.767);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm).toHaveBeenCalledWith({ meshCode: "53394611", muniCode: "13101", prefCode: "13" });
    expect(JSON.stringify(saveFarm.mock.calls)).not.toMatch(/35\.68|139\.76|lat|lng/);
  });

  it("選んだ町の外を押すと、はじいて知らせる。保存は押せないまま", async () => {
    farm = null;
    mount("/settings/farm");
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "13" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "13101" } });
    clickMap(34.7, 135.5); // 大阪
    expect((await screen.findByRole("alert")).textContent).toMatch(/選んだ市町村の外/);
    expect((screen.getByRole("button", { name: "地点を保存" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("保存の後に『最終保存』を出す（Farm.updatedAt）", async () => {
    farm = null;
    nextUpdatedAt = "2026-12-19T14:05:00+09:00";
    mount("/settings/farm");
    expect(screen.queryByText(/最終保存/)).toBeNull();
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "13" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "13101" } });
    clickMap(35.681, 139.767);
    fireEvent.click(await screen.findByRole("button", { name: "地点を保存" }));
    expect(await screen.findByText("最終保存 12月19日 14:05")).toBeTruthy();
  });

  it("登録済みの農場は、町を選んだ状態で開き、登録した町と最終保存を出す", async () => {
    farm = { id: "f1", ...farmFixture("u1", { muniCode: "13101", prefCode: "13", updatedAt: "2026-11-03T09:00:00+09:00" }) };
    mount("/settings/farm");
    expect(await screen.findByText("最終保存 11月3日 09:00")).toBeTruthy();
    expect(await screen.findByText(/登録した地点: 千代田区/)).toBeTruthy();
    // 登録の後は地点の欄を畳む。「地点を変える」で開く（aria-expanded）
    const toggle = screen.getByRole("button", { name: "地点を変える" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("市町村")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect((screen.getByLabelText("市町村") as HTMLSelectElement).value).toBe("13101");
    expect((screen.getByRole("button", { name: "地点を保存" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("農場を読み込めなかったら『読み込めませんでした』を出し、保存の欄を出さない（重ねて農場を作らない）", async () => {
    mount("/settings/farm", { getFarm: vi.fn(async () => Promise.reject(new Error("permission-denied"))) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/読み込めませんでした/);
    expect(screen.queryByRole("button", { name: "地点を保存" })).toBeNull();
    expect(screen.queryByRole("region", { name: "農場の地点を選ぶ地図" })).toBeNull();
  });

  it("会員を追加するのは『招待リンクを作る』のボタン 1 つ。押すとリンクが出る", async () => {
    createInvite.fn.mockResolvedValue({ code: "ABC", url: "https://hpai.example.test/join/ABC" });
    mount("/settings/farm");
    const button = await screen.findByRole("button", { name: "招待リンクを作る" });
    expect(screen.getAllByRole("button", { name: /招待/ })).toHaveLength(1);
    fireEvent.click(button);
    const input = (await screen.findByLabelText("招待リンク")) as HTMLInputElement;
    expect(input.value).toBe("https://hpai.example.test/join/ABC");
    expect(createInvite.fn).toHaveBeenCalledWith("f1");
    expect(screen.getByText(/7 日で切れ、1 回だけ/)).toBeTruthy();
  });

  // 審査員用の見本の農場（2026-11-08）。削除と招待は関数の側でも止めている
  it("審査員用の見本の農場では、会員を追加する節と全データの削除を出さず、断りの 1 行を出す", async () => {
    farm = { id: JUDGE_FARM_ID, ...farmFixture("judge-demo", { name: "審査員用の見本の農場" }) };
    const { container } = mount("/settings/farm");
    expect(await screen.findByText("審査員用の見本の農場です。記録は作り物です。削除と招待は止めています。")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "会員を追加する" })).toBeNull();
    expect(screen.queryByRole("button", { name: "招待リンクを作る" })).toBeNull();
    expect(screen.queryByText("農場の全データを削除する")).toBeNull();
    expect(container.querySelector("#delete")).toBeNull();
    // ほかの節（農場の情報、鶏舎）は今までどおり
    expect(screen.getByRole("heading", { name: "農場の情報" })).toBeTruthy();
    expect(findWordingViolations("審査員用の見本の農場です。記録は作り物です。削除と招待は止めています。")).toEqual([]);
    expect(findForbiddenPhrases("審査員用の見本の農場です。記録は作り物です。削除と招待は止めています。")).toEqual([]);
  });

  it("審査員用でない農場には、会員を追加する節と全データの削除が出て、断りの 1 行は出ない", async () => {
    mount("/settings/farm");
    expect(await screen.findByRole("heading", { name: "会員を追加する" })).toBeTruthy();
    expect(await screen.findByText("農場の全データを削除する", { selector: "summary" })).toBeTruthy();
    expect(screen.queryByText(/審査員用の見本の農場です/)).toBeNull();
  });

  it("農場がないうちは招待リンクを出さない", async () => {
    farm = null;
    mount("/settings/farm");
    await screen.findByRole("button", { name: "地点を保存" });
    expect(screen.queryByRole("button", { name: "招待リンクを作る" })).toBeNull();
  });

  it("招待リンクを作れなかったら、その旨を出す", async () => {
    createInvite.fn.mockRejectedValue(new Error("x"));
    mount("/settings/farm");
    fireEvent.click(await screen.findByRole("button", { name: "招待リンクを作る" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/招待リンクを作れませんでした/);
  });

  it("末尾に、/settings/notify へのリンクがある", async () => {
    // 2026-11-07 作り直し: 末尾のリンクをなくし、題の下の切り替え（農場｜通知）から開く
    mount("/settings/farm");
    const tabs = await screen.findByRole("navigation", { name: "設定の切り替え" });
    expect(tabs.className).toContain("section-tabs");
    const link = within(tabs).getByRole("link", { name: "通知" });
    expect(link.getAttribute("href")).toBe("/settings/notify");
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(within(tabs).getByRole("link", { name: "農場" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "通知の設定を開く" })).toBeNull();
  });

  it("末尾の 3 本とも .tap-link", async () => {
    // 末尾は 2 本（近隣への説明文、プライバシーの説明）
    mount("/settings/farm");
    const links = [await screen.findByRole("link", { name: "近隣への説明文を作る" }), screen.getByRole("link", { name: "プライバシーの説明" })];
    for (const l of links) expect(l.classList.contains("tap-link")).toBe(true);
  });

  it("下に /privacy へのリンクがあり、全文に禁止語がない", async () => {
    const { container } = mount("/settings/farm");
    const link = await screen.findByRole("link", { name: /プライバシー/ });
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });

  it("選んだ町を替えると、選んだマス目は取り消す", async () => {
    farm = null;
    mount("/settings/farm");
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "13" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "13101" } });
    clickMap(35.681, 139.767);
    await waitFor(() => expect((screen.getByRole("button", { name: "地点を保存" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "33" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "地点を保存" }) as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("/settings/farm（WebGL2 が使えない端末）", () => {
  // 全体を並べて回すと部品の読み込みが 1 秒を超えることがあるので、待ち時間を延ばす（確かめる中身は同じ）
  it("案内の文は地図をおす操作ではなく、代わりのボタンに合う。押すと町の中心あたりのマス目で保存できる", async () => {
    noWebgl.value = true;
    farm = null;
    mount("/settings/farm");
    const save = await screen.findByRole("button", { name: "地点を保存" }, { timeout: 5000 });
    // 地図の初期化の失敗はボタンより後に届くので、案内が替わるのを待つ（負荷が高いと間に合わなかった）
    expect(await screen.findByText(TEXT.meshPickMuniFirst, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(/地図がその町に寄ります/)).toBeNull();

    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "13" } });
    fireEvent.change(await screen.findByLabelText("市町村", {}, { timeout: 5000 }), { target: { value: "13101" } });
    expect(await screen.findByText(TEXT.meshPressCenter, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(/地図で、農場のあたりを押してください/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: TEXT.meshUseCenter }));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(save);
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(saveFarm).toHaveBeenCalledWith({ meshCode: latLngToMesh3(CHIYODA.center[1], CHIYODA.center[0]), muniCode: "13101", prefCode: "13" });
    expect(findWordingViolations(TEXT.meshPickMuniFirst + TEXT.meshPressCenter)).toEqual([]);
  });
});

describe("MeshPicker", () => {
  it("座標を state にもサーバーにも残さない（ソースに lat/lng を持つ state がない）", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "MeshPicker.tsx"), "utf8");
    expect(src).not.toMatch(/useState<[^>]*(lat|lng|LngLat)/i);
    expect(src).not.toMatch(/new Marker|Marker\(/);
  });
});

describe("/settings/notify", () => {
  const save = () => screen.getByRole("button", { name: "通知の設定を保存" });

  it("農場がなければ保存を出さず、/settings/farm へ案内する（ルールが meshCode を要る）", async () => {
    farm = null;
    mount("/settings/notify");
    const link = await screen.findByRole("link", { name: /農場の設定/ });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
    expect(saveFarm).not.toHaveBeenCalled();
  });

  it("会員でなければ /login へ", async () => {
    authState.value = { ...authState.value, user: null, member: false };
    mount("/settings/notify");
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe("/login"));
  });

  it("saveFarm に notify だけ渡す（toEqual）。段階の受信と朝のまとめを切り替えられる", async () => {
    mount("/settings/notify");
    fireEvent.click(await screen.findByLabelText(/隣の町で発生/));
    fireEvent.click(screen.getByLabelText(/朝のまとめ/));
    fireEvent.click(save());
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({
      notify: { level1: true, level2: false, level3: true, morningDigest: false, selfCheckRemindDays: null },
    });
  });

  it("期限の知らせを入れると日数が入り、切ると selfCheckRemindDays は null", async () => {
    farm = { id: "f1", ...farmFixture("u1", { notify: { ...DEFAULT_NOTIFY_FIXTURE, selfCheckRemindDays: 3 } }) };
    mount("/settings/notify");
    const remind = (await screen.findByLabelText(/期限の前に知らせる/)) as HTMLInputElement;
    expect(remind.checked).toBe(true);
    expect((screen.getByLabelText("何日前に知らせるか") as HTMLSelectElement).value).toBe("3");

    fireEvent.change(screen.getByLabelText("何日前に知らせるか"), { target: { value: "5" } });
    fireEvent.click(save());
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({ notify: { ...DEFAULT_NOTIFY_FIXTURE, selfCheckRemindDays: 5 } });

    fireEvent.click(remind);
    expect(screen.queryByLabelText("何日前に知らせるか")).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(2));
    expect(saveFarm.mock.calls[1]![0]).toEqual({ notify: { ...DEFAULT_NOTIFY_FIXTURE, selfCheckRemindDays: null } });
  });

  it("保存の後に『最終保存』を出す", async () => {
    nextUpdatedAt = "2026-11-07T08:15:00+09:00";
    mount("/settings/notify");
    fireEvent.click(await screen.findByLabelText(/朝のまとめ/));
    fireEvent.click(save());
    expect(await screen.findByText("最終保存 11月7日 08:15")).toBeTruthy();
  });

  it("知らせの保存で『保存しました』が、そのボタンの直下に出る。入力を変えると消える", async () => {
    mount("/settings/notify");
    fireEvent.click(await screen.findByLabelText(/朝のまとめ/));
    fireEvent.click(save());
    const status = await screen.findByText("保存しました");
    expect(save().nextElementSibling).toBe(status);
    expect(screen.getAllByText("保存しました")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(/朝のまとめ/));
    expect(screen.queryByText("保存しました")).toBeNull();
  });

  it("期限の保存で『保存しました』が、そのボタンの直下に出る。入力を変えると消える", async () => {
    mount("/settings/notify");
    fireEvent.change(await screen.findByLabelText("各月の分の期限"), { target: { value: "5" } });
    const btn = screen.getByRole("button", { name: "期限を保存" });
    fireEvent.click(btn);
    const status = await screen.findByText("保存しました");
    expect(btn.nextElementSibling).toBe(status);
    fireEvent.change(screen.getByLabelText("各月の分の期限"), { target: { value: "6" } });
    expect(screen.queryByText("保存しました")).toBeNull();
  });

  it("主のボタン（.btn-primary）は『通知の設定を保存』だけ。『期限を保存』は普通のボタン", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    const saves = screen.getAllByRole("button", { name: /を保存$/ });
    expect(saves.map((b) => b.textContent)).toEqual(["通知の設定を保存", "期限を保存"]);
    expect(saves[0]!.className.split(" ")).toContain("btn-primary");
    expect(saves[1]!.className.split(" ")).not.toContain("btn-primary");
  });

  it("保存に失敗したら、同じボタンの直下に『保存できませんでした』を出す", async () => {
    saveFarm.mockRejectedValue(new Error("x"));
    mount("/settings/notify");
    fireEvent.click(await screen.findByLabelText(/朝のまとめ/));
    fireEvent.click(save());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/保存できませんでした/);
    expect(save().nextElementSibling).toBe(alert);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(/朝のまとめ/));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("通知の設定の末尾に、/settings/farm へのリンクがある", async () => {
    // 2026-11-07 作り直し: 末尾のリンクをなくし、題の下の切り替え（農場｜通知）から開く
    mount("/settings/notify");
    const tabs = await screen.findByRole("navigation", { name: "設定の切り替え" });
    const link = within(tabs).getByRole("link", { name: "農場" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(within(tabs).getByRole("link", { name: "通知" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "農場の設定を開く" })).toBeNull();
  });

  const dueDay = () => screen.getByLabelText("各月の分の期限") as HTMLSelectElement;
  const perMonth = () => screen.getByRole("button", { name: "月ごとに変える" });

  it("自己点検の期限は『各月の分の期限』の 1 欄（翌月の 1〜31 日）。既定は選ばない。月ごとの 8 欄は畳んである", async () => {
    mount("/settings/notify");
    await screen.findByLabelText("各月の分の期限");
    expect(dueDay().value).toBe("");
    const options = [...dueDay().options].map((o) => o.textContent);
    expect(options[0]).toBe("選ばない（知らせない）");
    expect(options.slice(1)).toEqual(Array.from({ length: 31 }, (_, i) => `翌月の ${i + 1} 日`));
    expect(perMonth().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByLabelText(/年\d+月の分の期限/)).toHaveLength(0);
  });

  it("『月ごとに変える』を押すと、今までの月ごとの 8 欄が開く（aria-expanded、aria-controls）。もう一度押すと畳む", async () => {
    mount("/settings/notify");
    await screen.findByLabelText("各月の分の期限");
    fireEvent.click(perMonth());
    expect(perMonth().getAttribute("aria-expanded")).toBe("true");
    const box = document.getElementById(perMonth().getAttribute("aria-controls") ?? "");
    expect(box).toBeTruthy();
    const inputs = within(box!).getAllByLabelText(/月の分の期限/);
    expect(inputs).toHaveLength(8);
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(Array(8).fill(""));
    expect(inputs.map((i) => i.getAttribute("name"))).toEqual(seasonMonths(2026).map((m) => `due-${m}`));
    fireEvent.click(perMonth());
    expect(perMonth().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByLabelText(/年\d+月の分の期限/)).toHaveLength(0);
  });

  it("1 欄で選んだ日から 8 か月分の日付を作って保存する（selfCheckDue の形は変えない。前季の期限は残す）", async () => {
    farm = { id: "f1", ...farmFixture("u1", { selfCheckDue: { "2025-12": "2026-01-06" } }) };
    mount("/settings/notify");
    fireEvent.change(await screen.findByLabelText("各月の分の期限"), { target: { value: "5" } });
    expect(screen.getByText("例: 2026年11月の分は 12月5日まで")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({
      selfCheckDue: {
        "2025-12": "2026-01-06",
        "2026-10": "2026-11-05",
        "2026-11": "2026-12-05",
        "2026-12": "2027-01-05",
        "2027-01": "2027-02-05",
        "2027-02": "2027-03-05",
        "2027-03": "2027-04-05",
        "2027-04": "2027-05-05",
        "2027-05": "2027-06-05",
      },
    });
  });

  it("月にない日は、その月の末日にして保存する（31 日 → 11 月 30 日、2 月 28 日）", async () => {
    mount("/settings/notify");
    fireEvent.change(await screen.findByLabelText("各月の分の期限"), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    const due = (saveFarm.mock.calls[0]![0] as { selfCheckDue: Record<string, string> }).selfCheckDue;
    expect(due["2026-10"]).toBe("2026-11-30");
    expect(due["2026-11"]).toBe("2026-12-31");
    expect(due["2027-01"]).toBe("2027-02-28");
    expect(due["2027-03"]).toBe("2027-04-30");
  });

  it("全部の月が同じ日で保存済みなら、その日を選んだ状態で畳んで開く。『選ばない』で保存すると今季の期限を消す（前季は残す）", async () => {
    const five = Object.fromEntries(seasonMonths(2026).map((m) => [m, dueDateOf(m, 5)]));
    farm = { id: "f1", ...farmFixture("u1", { selfCheckDue: { ...five, "2025-12": "2026-01-06" } }) };
    mount("/settings/notify");
    await screen.findByLabelText("各月の分の期限");
    expect(dueDay().value).toBe("5");
    expect(perMonth().getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(dueDay(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({ selfCheckDue: { "2025-12": "2026-01-06" } });
  });

  it("月ごとに違う日（一部だけ入っているときも）が保存済みなら、『月ごとに変える』を開いた状態で開き、触らずに保存しても値を変えない", async () => {
    const saved = { "2026-11": "2026-12-05", "2026-12": "2027-01-06" };
    farm = { id: "f1", ...farmFixture("u1", { selfCheckDue: saved }) };
    mount("/settings/notify");
    expect(((await screen.findByLabelText("2026年11月の分の期限")) as HTMLInputElement).value).toBe("2026-12-05");
    expect((screen.getByLabelText("2026年12月の分の期限") as HTMLInputElement).value).toBe("2027-01-06");
    expect(perMonth().getAttribute("aria-expanded")).toBe("true");
    expect(dueDay().value).toBe("mixed");
    expect(dueDay().selectedOptions[0]?.textContent).toBe("月ごとに違う日");
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({ selfCheckDue: saved });
  });

  it("開いた 8 欄は 1 欄で選んだ日で埋まり、1 か月だけ直して保存できる", async () => {
    mount("/settings/notify");
    fireEvent.change(await screen.findByLabelText("各月の分の期限"), { target: { value: "5" } });
    fireEvent.click(perMonth());
    expect((screen.getByLabelText("2027年2月の分の期限") as HTMLInputElement).value).toBe("2027-03-05");
    fireEvent.change(screen.getByLabelText("2027年2月の分の期限"), { target: { value: "2027-03-08" } });
    expect(dueDay().value).toBe("mixed");
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    const due = (saveFarm.mock.calls[0]![0] as { selfCheckDue: Record<string, string> }).selfCheckDue;
    expect(due["2027-02"]).toBe("2027-03-08");
    expect(due["2027-01"]).toBe("2027-02-05");
    expect(Object.keys(due)).toHaveLength(8);
  });

  it("期限の保存は saveFarm に selfCheckDue だけ渡し、他のシーズンの期限と空の月の扱いを守る", async () => {
    farm = {
      id: "f1",
      ...farmFixture("u1", { selfCheckDue: { "2025-12": "2026-01-06", "2026-11": "2026-12-05", "2026-12": "2027-01-06" } }),
    };
    mount("/settings/notify");
    const nov = (await screen.findByLabelText("2026年11月の分の期限")) as HTMLInputElement;
    expect(nov.value).toBe("2026-12-05");
    fireEvent.change(nov, { target: { value: "" } }); // 11 月の分を消す
    fireEvent.change(screen.getByLabelText("2027年2月の分の期限"), { target: { value: "2027-03-06" } });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(saveFarm.mock.calls[0]![0]).toEqual({
      selfCheckDue: { "2025-12": "2026-01-06", "2026-12": "2027-01-06", "2027-02": "2027-03-06" },
    });
  });

  it("期限の保存は、今季と前季より古い月を残さない（6 季目でも規則の上限 40 件に当たらない）", async () => {
    const old = (y: number) => Object.fromEntries(["10", "11", "12"].map((m) => [`${y}-${m}`, `${y + 1}-01-06`]));
    const older = Object.assign({}, old(2020), old(2021), old(2022), old(2023), old(2024), { "junk": "2026-01-06", "2025-1": "2026-01-06" });
    farm = {
      id: "f1",
      ...farmFixture("u1", { selfCheckDue: { ...older, "2025-12": "2026-01-06", "2026-11": "2026-12-05" } }),
    };
    mount("/settings/notify");
    const dec = (await screen.findByLabelText("2026年12月の分の期限")) as HTMLInputElement;
    fireEvent.change(dec, { target: { value: "2027-01-06" } });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    // 今季（2026 年 6 月〜）と前季（2025 年 6 月〜）の月だけ。2025-12 は前季、2024 年以前は消える
    expect(saveFarm.mock.calls[0]![0]).toEqual({
      selfCheckDue: { "2025-12": "2026-01-06", "2026-11": "2026-12-05", "2026-12": "2027-01-06" },
    });
  });

  it("農場を読み込めなかったら『読み込めませんでした』を出し、保存を出さない", async () => {
    mount("/settings/notify", { getFarm: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/読み込めませんでした/);
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
  });

  it("配信を止めていなければ『配信を止めています』も戻すボタンも出さない", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    expect(screen.queryByText("配信を止めています")).toBeNull();
    expect(screen.queryByRole("button", { name: "配信を再開する" })).toBeNull();
  });

  it("配信を止めていれば『配信を止めています』と、基準と期限の知らせも止まること、戻すボタンを出す", async () => {
    mailStopped = true;
    const { container } = mount("/settings/notify");
    expect(await screen.findByText("配信を止めています")).toBeTruthy();
    expect(container.textContent).toContain("届け出の基準に達したときの知らせと期限の知らせも止まっています");
    expect(container.textContent).toContain("画面の表示は止まっていません");
    expect(screen.getByRole("button", { name: "配信を再開する" })).toBeTruthy();
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });

  it("戻すボタンは resumeMail をその農場で呼び、戻ったら表示を消す", async () => {
    mailStopped = true;
    mount("/settings/notify");
    fireEvent.click(await screen.findByRole("button", { name: "配信を再開する" }));
    await waitFor(() => expect(resumeCall.fn).toHaveBeenCalledWith("f1"));
    await waitFor(() => expect(screen.queryByText("配信を止めています")).toBeNull());
    expect(screen.getByText("配信を再開しました")).toBeTruthy();
  });

  it("戻せなかったら、その旨を出して表示を残す", async () => {
    mailStopped = true;
    resumeCall.fn.mockRejectedValue(new Error("x"));
    mount("/settings/notify");
    fireEvent.click(await screen.findByRole("button", { name: "配信を再開する" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/戻せませんでした/);
    expect(screen.getByText("配信を止めています")).toBeTruthy();
  });

  it("止まっているかを確かめられなくても、設定の画面は使える（止めている表示は出さない）", async () => {
    mount("/settings/notify", { isMailStopped: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect(await screen.findByRole("button", { name: "通知の設定を保存" })).toBeTruthy();
    expect(screen.queryByText("配信を止めています")).toBeNull();
  });

  it("下に /privacy へのリンクがあり、全文に禁止語がない", async () => {
    const { container } = mount("/settings/notify");
    const link = await screen.findByRole("link", { name: /プライバシー/ });
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });
});

describe("農場の所属が複数ある（fail closed）", () => {
  it.each(["/settings/farm", "/settings/notify"])("%s は所属が複数ありますと出し、保存の欄を出さない", async (at) => {
    mount(at, { getFarm: vi.fn(async () => Promise.reject(new MultipleFarmsError())) });
    expect((await screen.findByRole("alert")).textContent).toBe("農場の所属が複数あります。運営者に連絡してください");
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
  });
});

describe("近隣への説明文への入口（M-19 レビュー指摘 1）", () => {
  it("農場の設定の画面に、/settings/explainer へのリンクがある", async () => {
    mount("/settings/farm");
    const link = await screen.findByRole("link", { name: /近隣への説明文/ });
    expect(link.getAttribute("href")).toBe("/settings/explainer");
  });
});

describe("農場の設定の画面の型（2026-11-07 業務画面の作り直し）", () => {
  const tile = (label: string) =>
    within(screen.getByRole("list", { name: "登録の状況" }))
      .getAllByRole("listitem")
      .find((li) => li.querySelector(".stat-label")?.textContent === label);

  it("題、この画面では…の 1 文、切り替え、登録の状況の札の順。札は押すとその節へ移る", async () => {
    farm = { id: "f1", ...farmFixture("u1", { name: "見本農場", kahoContact: "ある家保" }) };
    mount("/settings/farm");
    await screen.findByText(/登録した地点: 千代田区/);
    const h1 = screen.getByRole("heading", { level: 1, name: "農場の設定" });
    expect(h1.nextElementSibling?.textContent).toBe("この画面では、記録と知らせに使う農場の情報を登録します。");
    await waitFor(() => expect(tile("通知")?.textContent).toContain("届きます"));
    expect(tile("地点")?.textContent).toContain("千代田区");
    expect(tile("農場名")?.textContent).toContain("見本農場");
    // 鶏舎の札は一覧を読み終えるまで「…」なので、読み終えるのを待つ（混んだ PC で揺れないように）
    await waitFor(() => expect(tile("鶏舎")?.textContent).toContain("0件"));
    expect(tile("鶏舎")?.className).toContain("is-alert");
    expect(tile("家畜保健衛生所の連絡先")?.textContent).toContain("登録済み");
    expect(tile("地点")?.querySelector("a")?.getAttribute("href")).toBe("#point");
    expect(tile("鶏舎")?.querySelector("a")?.getAttribute("href")).toBe("#houses");
    expect(tile("家畜保健衛生所の連絡先")?.querySelector("a")?.getAttribute("href")).toBe("#kaho");
    for (const id of ["point", "houses", "kaho", "farm-info"]) expect(document.getElementById(id)?.tagName).toBe("SECTION");
  });

  it("鶏舎の札は件数と合計羽数（空舎を除く）。未登録は赤くせず、農場名と家保は『未登録』", async () => {
    farm = { id: "f1", ...farmFixture("u1", { name: "", kahoContact: "" }) };
    mount("/settings/farm", {
      listHouses: vi.fn(async () => [
        { id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false },
        { id: "h2", name: "2 号舎", birdType: "採卵鶏", flockSize: 0, empty: true },
      ]),
    });
    await waitFor(() => expect(tile("鶏舎")?.textContent).toBe("鶏舎2件合計 1,200 羽"));
    expect(tile("鶏舎")?.className).not.toContain("is-alert");
    expect(tile("農場名")?.textContent).toBe("農場名未登録");
    expect(tile("家畜保健衛生所の連絡先")?.textContent).toBe("家畜保健衛生所の連絡先未登録");
  });

  it("配信を止めていれば、通知の札は『止めています』で、通知の設定へのリンクを添える。確かめられなければ札を出さない", async () => {
    mailStopped = true;
    mount("/settings/farm");
    await waitFor(() => expect(tile("通知")?.textContent).toContain("止めています"));
    expect(within(tile("通知")!).getByRole("link").getAttribute("href")).toBe("/settings/notify");
    cleanup();
    mount("/settings/farm", { isMailStopped: vi.fn(async () => Promise.reject(new Error("x"))) });
    await screen.findByText(/登録した地点: 千代田区/);
    await new Promise((r) => setTimeout(r, 20));
    expect(tile("通知")).toBeUndefined();
  });

  it("町の名前を読めなければ、地点の札は『読み込めませんでした』、本文は『町の名前を読み込めませんでした』。5 桁の市町村コードを出さない", async () => {
    // 町の一覧（mock）に津山市（33203）はない。読めなかったときと同じ扱い
    farm = { id: "f1", ...farmFixture("u1", { muniCode: "33203", prefCode: "33" }) };
    mount("/settings/farm");
    expect(await screen.findByText("登録した地点: 町の名前を読み込めませんでした（約 1km のマス目）")).toBeTruthy();
    expect(tile("地点")?.textContent).toBe("地点読み込めませんでした");
    expect(tile("地点")?.className).not.toContain("is-alert");
    expect(document.body.textContent).not.toContain("33203");
  });

  it("農場がなければ、登録の状況の札は出さず、地点の欄を一番上に開いて出す（地図を画面の上に置く）", async () => {
    farm = null;
    mount("/settings/farm");
    await screen.findByRole("button", { name: "地点を保存" });
    expect(screen.queryByRole("list", { name: "登録の状況" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["農場の地点"]);
    expect(screen.queryByRole("button", { name: "地点を変える" })).toBeNull();
  });

  it("地点を変えて保存すると、地点の欄を畳み直す", async () => {
    mount("/settings/farm");
    fireEvent.click(await screen.findByRole("button", { name: "地点を変える" }));
    fireEvent.change(await screen.findByLabelText("都道府県"), { target: { value: "33" } });
    fireEvent.change(await screen.findByLabelText("市町村"), { target: { value: "33100" } });
    clickMap(34.65, 133.9);
    const save = screen.getByRole("button", { name: "地点を保存" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect(await screen.findByText(/登録した地点: 岡山市/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "地点を変える" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "地点を保存" })).toBeNull();
  });

  it("画面の文に『足す』『つける』『おして』がなく、日付は ISO の形で出さない", async () => {
    const { container } = mount("/settings/farm");
    await screen.findByText(/登録した地点/);
    fireEvent.click(await screen.findByRole("button", { name: "鶏舎を登録する" }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/足す|足し|つけ|おして/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("農場の設定の見出しと並び（2026-11-08 レビュー）", () => {
  const tile = (label: string) =>
    within(screen.getByRole("list", { name: "登録の状況" }))
      .getAllByRole("listitem")
      .find((li) => li.querySelector(".stat-label")?.textContent === label);

  it("農場名の札は、値を『登録済み』にして折れないようにし、名前は下の小さな行に出す", async () => {
    farm = { id: "f1", ...farmFixture("u1", { name: "とても長い名前の見本の農場" }) };
    mount("/settings/farm");
    await screen.findByText(/登録した地点: 千代田区/);
    expect(tile("農場名")?.querySelector(".stat-value")?.textContent).toBe("登録済み");
    expect(tile("農場名")?.querySelector(".stat-note")?.textContent).toBe("とても長い名前の見本の農場");
  });

  it("配信を止めているときの通知の札のリンクは短く『再開する』", async () => {
    mailStopped = true;
    mount("/settings/farm");
    await waitFor(() => expect(tile("通知")?.textContent).toContain("止めています"));
    expect(within(tile("通知")!).getByRole("link").textContent).toBe("再開する");
  });

  it("最終保存は、札の下ではなく、次にすることの行の後ろに小さく出す", async () => {
    farm = { id: "f1", ...farmFixture("u1", { updatedAt: "2026-11-03T09:00:00+09:00" }) };
    mount("/settings/farm");
    const saved = await screen.findByText("最終保存 11月3日 09:00");
    const next = await screen.findByText("次にすること:");
    expect(saved.classList.contains("settings-saved")).toBe(true);
    expect(next.closest("p")?.nextElementSibling).toBe(saved);
    expect(screen.getByRole("list", { name: "登録の状況" }).nextElementSibling?.contains(saved)).toBe(true);
  });

  it("家畜保健衛生所の連絡先は、見出しだけに出し、欄の名前は読み上げに渡す", async () => {
    mount("/settings/farm");
    const box = await screen.findByLabelText("家畜保健衛生所の連絡先");
    expect(box.tagName).toBe("TEXTAREA");
    // 札の名前（登録の状況）を除くと、見出しの 1 回だけ（欄の名前は見える文にしない）
    expect(screen.getAllByText("家畜保健衛生所の連絡先").filter((el) => !el.closest(".stat-tiles"))).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "家畜保健衛生所の連絡先" })).toBeTruthy();
  });

  it("近隣への説明文とプライバシーの説明は、『関連』の小さな見出しの下にまとめ、削除の前に置く", async () => {
    mount("/settings/farm");
    const nav = await screen.findByRole("navigation", { name: "関連" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["近隣への説明文を作る", "プライバシーの説明"]);
    await screen.findByText("農場の全データを削除する", { selector: "summary" });
    expect(nav.nextElementSibling?.id).toBe("delete");
  });

  it("農場がないときも、見出し（h2）は地点だけで、関連のリンクは出す", async () => {
    farm = null;
    mount("/settings/farm");
    await screen.findByRole("button", { name: "地点を保存" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["農場の地点"]);
    expect(screen.getByRole("navigation", { name: "関連" })).toBeTruthy();
    // 農場がないときの主のボタンは「地点を保存」
    expect(screen.getByRole("button", { name: "地点を保存" }).classList.contains("btn-primary")).toBe(true);
  });
});

describe("農場の全データの削除（記録の画面から農場の設定の一番下へ移した）", () => {
  beforeEach(() => {
    farm = { id: "f1", ...farmFixture("u1", { name: "見本農場" }) };
  });
  // 2026-11-08 レビュー: 削除の節は h2 を置かず、畳んだ欄の summary『農場の全データを削除する』が見出しの役
  const deleteSection = async () => (await screen.findByText("農場の全データを削除する", { selector: "summary" })).closest("section")!;
  const openDelete = async () => {
    const section = await deleteSection();
    fireEvent.click(within(section).getByText("農場の全データを削除する"));
    return section;
  };
  const setName = (value: string) => fireEvent.change(screen.getByLabelText(RECORD_TEXT.deleteInput), { target: { value } });

  it("一番下の節で、畳んである（Fold『農場の全データを削除する』）", async () => {
    mount("/settings/farm");
    const section = await deleteSection();
    expect(section.id).toBe("delete");
    // 同じ語を h2 と summary で 2 回出さない
    expect(screen.queryByRole("heading", { name: RECORD_TEXT.deleteHeading })).toBeNull();
    expect(section.querySelector("h2")).toBeNull();
    expect(section.nextElementSibling).toBeNull();
    const details = section.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("農場の全データを削除する");
  });

  it("削除は農場の名前を入れるまで押せない。消すものと消えないものを出す", async () => {
    mount("/settings/farm");
    await openDelete();
    const button = screen.getByRole("button", { name: RECORD_TEXT.deleteButton }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(RECORD_TEXT.deleteGone)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.deleteKept)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.deleteAnyMember)).toBeTruthy();
    setName("見本");
    expect(button.disabled).toBe(true);
    setName("見本農場");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith("f1", "見本農場"));
    expect(await screen.findByText(RECORD_TEXT.deleted)).toBeTruthy();
    // 消した農場の保存と招待の欄を残さない
    expect(screen.queryByRole("button", { name: /保存|招待/ })).toBeNull();
    expect(screen.getByRole("link", { name: RECORD_TEXT.deletedTop }).getAttribute("href")).toBe("/");
  });

  it("削除に失敗したら知らせ、削除済みの表示にしない", async () => {
    deleteCall.mockRejectedValueOnce(new Error("failed"));
    mount("/settings/farm");
    await openDelete();
    setName("見本農場");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.deleteButton }));
    expect(await screen.findByText(RECORD_TEXT.deleteFailed)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.deleted)).toBeNull();
  });

  it("農場の名前が未設定なら削除できない", async () => {
    farm = { id: "f1", ...farmFixture("u1", { name: "" }) };
    mount("/settings/farm");
    await openDelete();
    expect(screen.getByText(RECORD_TEXT.deleteNameMissing)).toBeTruthy();
    expect((screen.getByRole("button", { name: RECORD_TEXT.deleteButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("見本の農場には削除を出さない", async () => {
    mount("/settings/farm", { mode: "sample" });
    await screen.findByRole("button", { name: "農場の情報を保存" });
    expect(screen.queryByText("農場の全データを削除する")).toBeNull();
    expect(document.getElementById("delete")).toBeNull();
    expect(screen.queryByRole("button", { name: RECORD_TEXT.deleteButton })).toBeNull();
    expect(screen.queryByText(RECORD_TEXT.deleteGone)).toBeNull();
  });

  it("農場がないうちは削除を出さない", async () => {
    farm = null;
    mount("/settings/farm");
    await screen.findByRole("button", { name: "地点を保存" });
    expect(screen.queryByRole("button", { name: RECORD_TEXT.deleteButton })).toBeNull();
  });

  it("#delete で開くと、削除の欄を開き、見出しに焦点を移す（プライバシーの説明の消し方のリンクの行き先）", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      mount("/settings/farm#delete");
      // 見出しの役は畳んだ欄の summary
      const heading = await screen.findByText("農場の全データを削除する", { selector: "summary" });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(heading.closest("section")?.id).toBe("delete");
      expect(heading.closest("section")?.querySelector("details")?.open).toBe(true);
      expect(scrolled).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("削除の説明は、プライバシーの説明（X-19）と食い違わない", () => {
    const privacy = PRIVACY_NOTICE.flatMap((s) => s.paragraphs).join("\n");
    expect(privacy).toContain(RECORD_TEXT.deleteAnyMember.replace("農場全体を消せます。", "農場全体を消せます"));
    for (const word of ["農場の情報", "送った知らせの記録", "招待", "ログイン用のアカウント", "メールアドレス", "Gmail", "ブラウザの設定"]) {
      expect(privacy).toContain(word);
      expect(RECORD_TEXT.deleteGone + RECORD_TEXT.deleteKept).toContain(word);
    }
    expect(privacy).toContain("消えません");
    expect(RECORD_TEXT.deleteKept).toContain("消えない");
    // 消す場所の案内は、画面の置き場と同じ（農場の設定の一番下）
    expect(privacy).toContain("農場の設定の一番下から、農場の名前を入れて削除します。");
  });
});

describe("通知の設定の画面の型（2026-11-07 業務画面の作り直し）", () => {
  const tile = (label: string) =>
    within(screen.getByRole("list", { name: "通知の状況" }))
      .getAllByRole("listitem")
      .find((li) => li.querySelector(".stat-label")?.textContent === label);

  it("題、この画面では…の 1 文、切り替え、札 3 つ（配信、メールの知らせ、自己点検の期限）", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    const h1 = screen.getByRole("heading", { level: 1, name: "通知の設定" });
    expect(h1.nextElementSibling?.textContent).toBe("この画面では、メールで知らせる内容と、自己点検の期限を決めます。");
    await waitFor(() => expect(tile("配信")?.textContent).toBe("配信届きます"));
    expect(tile("メールの知らせ")?.textContent).toBe("メールの知らせ4 / 4種類");
    expect(tile("自己点検の期限")?.textContent).toBe("自己点検の期限未登録");
  });

  it("札は保存済みの値。期限は『翌月の N 日』と、知らせる日数", async () => {
    const five = Object.fromEntries(seasonMonths(2026).map((m) => [m, dueDateOf(m, 5)]));
    farm = {
      id: "f1",
      ...farmFixture("u1", { selfCheckDue: five, notify: { ...DEFAULT_NOTIFY_FIXTURE, level2: false, selfCheckRemindDays: 3 } }),
    };
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    expect(tile("自己点検の期限")?.textContent).toBe("自己点検の期限翌月の 5 日期限の 3 日前に知らせます");
    expect(tile("メールの知らせ")?.textContent).toBe("メールの知らせ3 / 4種類");
    // 入力を変えただけでは札は動かない（保存してから）
    fireEvent.click(screen.getByLabelText(/朝のまとめ/));
    expect(tile("メールの知らせ")?.textContent).toBe("メールの知らせ3 / 4種類");
    fireEvent.click(screen.getByRole("button", { name: "通知の設定を保存" }));
    await waitFor(() => expect(tile("メールの知らせ")?.textContent).toBe("メールの知らせ2 / 4種類"));
  });

  it("配信を止めていれば札は『止めています』。確かめられなければ配信の札を出さない", async () => {
    mailStopped = true;
    mount("/settings/notify");
    await waitFor(() => expect(tile("配信")?.textContent).toBe("配信止めています"));
    cleanup();
    mount("/settings/notify", { isMailStopped: vi.fn(async () => Promise.reject(new Error("x"))) });
    await screen.findByRole("button", { name: "通知の設定を保存" });
    await new Promise((r) => setTimeout(r, 20));
    expect(tile("配信")).toBeUndefined();
  });

  it("注記は 1 行ずつ。期限の注記は dueDateOf と同じ（翌月にない日は翌月の末日）", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    expect(screen.getByText("各月の分を出す期限を、翌月の日で選びます（県の様式に合わせてください）。")).toBeTruthy();
    expect(screen.getByText("翌月にない日（31 日など）は翌月の末日にします。")).toBeTruthy();
    expect(dueDateOf("2026-10", 31)).toBe("2026-11-30");
    for (const li of document.querySelectorAll(".settings-notes li")) expect((li.textContent ?? "").split("。").filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});
