import type { MuniEntry } from "@hpai/shared/geo";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { Farm } from "@hpai/shared/types";
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
vi.mock("../auth/callables", () => ({
  createFarmInviteCall: createInvite.fn,
  redeemInviteCall: vi.fn(),
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
    expect(screen.getByText(/登録した地点: 千代田区/)).toBeTruthy();
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
    mount("/settings/farm");
    const link = await screen.findByRole("link", { name: "通知の設定を開く" });
    expect(link.getAttribute("href")).toBe("/settings/notify");
    expect(link.className).toContain("tap-link");
  });

  it("末尾の 3 本とも .tap-link", async () => {
    mount("/settings/farm");
    const links = [
      await screen.findByRole("link", { name: "近隣への説明文を作る" }),
      screen.getByRole("link", { name: "プライバシーの説明" }),
      screen.getByRole("link", { name: "通知の設定を開く" }),
    ];
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

  it("保存のボタンは 2 つとも同じ種類（主のボタン .btn-primary）", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "通知の設定を保存" });
    const saves = screen.getAllByRole("button", { name: /を保存$/ });
    expect(saves.map((b) => b.textContent)).toEqual(["通知の設定を保存", "期限を保存"]);
    for (const b of saves) expect(b.className.split(" "), b.textContent ?? "").toContain("btn-primary");
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
    mount("/settings/notify");
    const link = await screen.findByRole("link", { name: "農場の設定を開く" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(link.className).toContain("tap-link");
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
