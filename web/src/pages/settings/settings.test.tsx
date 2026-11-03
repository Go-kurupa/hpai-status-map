import type { MuniEntry } from "@hpai/shared/geo";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { Farm } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFY_FIXTURE, farmFixture } from "../../../../shared/test/helpers/mFixtures";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import type { DataSource, RecordStore } from "../../data/types";
import { MultipleFarmsError } from "../auth/firestoreRecordStore";

// 地図（WebGL）は jsdom にないので、maplibre の入口を偽物にする。クリックは偽の地図から起こす
interface FakeMap {
  options: Record<string, unknown>;
  handlers: Map<string, (e: unknown) => void>;
  sources: Map<string, { data: unknown }>;
  removed: boolean;
}
const maps: FakeMap[] = [];
vi.mock("../../geo/maplibre", () => {
  class MlMap {
    fake: FakeMap;
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    constructor(options: Record<string, unknown>) {
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

import { NEW_FARM_NOTIFY, pickToFarmPatch, savedAtLabel, seasonMonths } from "./farmForm";
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

  it("savedAtLabel は日付と時刻を出す。読めなければ null", () => {
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
    expect(maps[0]!.options["dragRotate"]).toBe(false);
  });

  it("住所の欄がなく、『約 1km のマス目で保存します』と出す。点は描かない", async () => {
    const { container } = mount("/settings/farm");
    await screen.findByRole("region", { name: "農場の地点を選ぶ地図" });
    expect(screen.getByText(/約 1km のマス目で保存します/)).toBeTruthy();
    expect(screen.queryByLabelText(/住所/)).toBeNull();
    expect(container.querySelector('input[name*="address" i], input[autocomplete*="address"]')).toBeNull();
    const m = maps[0]!;
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

  it("選んだ町の外をおすと、はじいて知らせる。保存は押せないまま", async () => {
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

  it("農場を読めなかったら『読めませんでした』を出し、保存の欄を出さない（重ねて農場を作らない）", async () => {
    mount("/settings/farm", { getFarm: vi.fn(async () => Promise.reject(new Error("permission-denied"))) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/読めませんでした/);
    expect(screen.queryByRole("button", { name: "地点を保存" })).toBeNull();
    expect(screen.queryByRole("region", { name: "農場の地点を選ぶ地図" })).toBeNull();
  });

  it("会員を足すのは『招待リンクを作る』のボタン 1 つ。押すとリンクが出る", async () => {
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

describe("MeshPicker", () => {
  it("座標を state にもサーバーにも残さない（ソースに lat/lng を持つ state がない）", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "MeshPicker.tsx"), "utf8");
    expect(src).not.toMatch(/useState<[^>]*(lat|lng|LngLat)/i);
    expect(src).not.toMatch(/new Marker|Marker\(/);
  });
});

describe("/settings/notify", () => {
  const save = () => screen.getByRole("button", { name: "知らせの設定を保存" });

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
    fireEvent.click(await screen.findByLabelText(/隣町で発生/));
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

  it("自己点検の期限は月ごとに入れる。既定の日は入れない", async () => {
    mount("/settings/notify");
    const inputs = await screen.findAllByLabelText(/月の分の期限/);
    expect(inputs).toHaveLength(8);
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(Array(8).fill(""));
    expect(inputs.map((i) => i.getAttribute("name"))).toEqual(seasonMonths(2026).map((m) => `due-${m}`));
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

  it("農場を読めなかったら『読めませんでした』を出し、保存を出さない", async () => {
    mount("/settings/notify", { getFarm: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await screen.findByRole("alert")).textContent).toMatch(/読めませんでした/);
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
  });

  it("配信を止めていなければ『配信を止めています』も戻すボタンも出さない", async () => {
    mount("/settings/notify");
    await screen.findByRole("button", { name: "知らせの設定を保存" });
    expect(screen.queryByText("配信を止めています")).toBeNull();
    expect(screen.queryByRole("button", { name: "配信を再開する" })).toBeNull();
  });

  it("配信を止めていれば『配信を止めています』と、基準と期限の知らせも止まること、戻すボタンを出す", async () => {
    mailStopped = true;
    const { container } = mount("/settings/notify");
    expect(await screen.findByText("配信を止めています")).toBeTruthy();
    expect(container.textContent).toContain("基準に当たった知らせと期限の知らせも止まっています");
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
    expect(await screen.findByRole("button", { name: "知らせの設定を保存" })).toBeTruthy();
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
