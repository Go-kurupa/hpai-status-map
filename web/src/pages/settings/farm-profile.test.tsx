import type { MuniEntry } from "@hpai/shared/geo";
import type { Farm, House } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { farmFixture, houseFixture } from "../../../../shared/test/helpers/mFixtures";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import type { DataSource, RecordStore } from "../../data/types";

// 地図（WebGL）は jsdom にないので、maplibre の入口を偽物にする（この試験は地図を操作しない）
vi.mock("../../geo/maplibre", () => {
  class MlMap {
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    isStyleLoaded() {
      return true;
    }
    once() {}
    on() {}
    addSource() {}
    addLayer() {}
    getSource() {
      return undefined;
    }
    fitBounds() {}
    getCanvas() {
      return { style: {} as Record<string, string> };
    }
    remove() {}
  }
  return { MlMap, AttributionControl: class {}, Marker: class {} };
});

function muni(code: string, name: string, prefCode: string): MuniEntry {
  return { code, name, prefCode, center: [135, 35], bbox: [134.9, 34.9, 135.1, 35.1] };
}
// 札幌市は政令市（区を含まない市のコード 01100 だけが索引にある）。01201〜01225 は 20 件の上限の試験用
const INDEX = vi.hoisted(() => {
  const index: Record<string, { code: string; name: string; prefCode: string; center: [number, number]; bbox: [number, number, number, number] }> = {};
  const add = (code: string, name: string, prefCode: string) => {
    index[code] = { code, name, prefCode, center: [135, 35], bbox: [134.9, 34.9, 135.1, 35.1] };
  };
  add("01100", "札幌市", "01");
  for (let i = 1; i <= 25; i++) add(`01${200 + i}`, `北の町${i}`, "01");
  add("13101", "千代田区", "13");
  add("33100", "岡山市", "33");
  add("33203", "津山市", "33");
  return index;
});
vi.mock("../../geo/loadGeo", () => ({
  loadWebGeoStore: async () => ({
    index: INDEX,
    adjacency: {},
    ensurePrefs: async () => {},
    geometry: (c: string) => ({ type: "Feature", properties: { c }, geometry: { type: "Polygon", coordinates: [] } }),
  }),
}));

const authState = vi.hoisted(() => ({
  value: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} },
}));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => authState.value }));
vi.mock("../auth/callables", () => ({ createFarmInviteCall: vi.fn(), redeemInviteCall: vi.fn() }));

import FarmSettingsPage from "./FarmSettingsPage";

type Saved = Farm & { id: string };
type SavedHouse = House & { id: string };
let farm: Saved | null;
let houses: SavedHouse[];
let store: RecordStore;
let tick: number;
const saveFarm = vi.fn();
const saveHouse = vi.fn();
const saveDeath = vi.fn();
const listHouses = vi.fn();

const dataSource = { mode: "live", now: () => new Date("2026-11-06T10:30:00+09:00") } as unknown as DataSource;

beforeEach(() => {
  authState.value = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  farm = { id: "f1", ...farmFixture("u1", { name: "", muniCode: "13101", prefCode: "13" }) };
  houses = [];
  tick = 0;
  saveFarm.mockReset();
  saveHouse.mockReset();
  saveDeath.mockReset();
  listHouses.mockReset();
  saveFarm.mockImplementation(async (patch: Partial<Farm>) => {
    // 実物の保存と同じく、渡した項目だけを変えて updatedAt を進める
    tick += 1;
    farm = { ...farm!, ...patch, updatedAt: `2026-11-06T10:3${tick}:00+09:00` } as Saved;
  });
  saveHouse.mockImplementation(async (h: House & { id?: string }) => {
    const { id, ...data } = h;
    if (id) houses = houses.map((x) => (x.id === id ? { id, ...data } : x));
    else houses = [...houses, { id: `h${houses.length + 1}`, ...data }];
  });
  listHouses.mockImplementation(async () => houses);
  store = { mode: "firestore", getFarm: vi.fn(async () => farm), saveFarm, listHouses, saveHouse, saveDeath } as unknown as RecordStore;
});
afterEach(cleanup);

function mount(over: Partial<RecordStore> = {}) {
  const routes: RouteObject[] = [
    {
      path: "/settings/farm",
      element: (
        <DataSourceProvider value={dataSource}>
          <RecordStoreProvider value={{ ...store, ...over }}>
            <FarmSettingsPage />
          </RecordStoreProvider>
        </DataSourceProvider>
      ),
    },
  ];
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/settings/farm"] })} />);
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const lastPatch = () => saveFarm.mock.calls.at(-1)![0] as Partial<Farm>;
const section = (heading: string) => screen.getByRole("heading", { name: heading }).closest("section")!;

describe("並び（農場がないあいだは地点だけ）", () => {
  it("農場がない間は地点の欄だけを出し、他の欄の保存も出さず、saveFarm を呼ばない", async () => {
    farm = null;
    mount();
    await screen.findByRole("button", { name: "地点を保存" });
    expect(screen.queryByLabelText("農場名")).toBeNull();
    for (const name of [/農場の情報を保存/, /行き来する町を保存/, /鶏舎を足す/, /家保の連絡先を保存/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "鶏舎" })).toBeNull();
    expect(saveFarm).not.toHaveBeenCalled();
    expect(listHouses).not.toHaveBeenCalled();
  });

  it("地点、農場の情報、行き来する町、鶏舎、家保の連絡先、招待の順に並ぶ", async () => {
    mount();
    await screen.findByRole("button", { name: "農場の情報を保存" });
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order).toEqual(["農場の地点", "農場の情報", "行き来する町", "鶏舎", "家畜保健衛生所の連絡先", "会員を足す"]);
  });

  it("見出しは『農場の設定』を含まない（ページ見出しだけが持つ）", async () => {
    mount();
    await screen.findByRole("button", { name: "農場の情報を保存" });
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(h2.filter((t) => t.includes("農場の設定"))).toEqual([]);
  });

  it("起動しただけでは saveFarm も saveHouse も呼ばない", async () => {
    mount();
    await screen.findByRole("button", { name: "農場の情報を保存" });
    expect(saveFarm).not.toHaveBeenCalled();
    expect(saveHouse).not.toHaveBeenCalled();
  });
});

describe("農場名、採卵か肉用か、飼い方", () => {
  it("saveFarm に name、production、housing だけを渡す（toEqual）", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("農場名"), { target: { value: "テスト農場" } });
    fireEvent.click(screen.getByLabelText("採卵"));
    fireEvent.click(screen.getByLabelText("開放的な鶏舎"));
    click("農場の情報を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ name: "テスト農場", production: "layer", housing: "open" });
  });

  it("肉用は broiler、窓のない鶏舎は windowless、屋外に出す飼い方は free_range", async () => {
    mount();
    await screen.findByLabelText("農場名");
    fireEvent.click(screen.getByLabelText("肉用"));
    fireEvent.click(screen.getByLabelText("窓のない鶏舎"));
    click("農場の情報を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ name: "", production: "broiler", housing: "windowless" });
    fireEvent.click(screen.getByLabelText("屋外に出す飼い方"));
    click("農場の情報を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(2));
    expect(lastPatch()).toEqual({ name: "", production: "broiler", housing: "free_range" });
  });

  it("未選択は null で保存でき、確認リストは両方を出すと説明する", async () => {
    farm = { id: "f1", ...farmFixture("u1", { name: "A 農場", production: "layer", housing: "open" }) };
    mount();
    expect((await screen.findByLabelText("採卵")) as HTMLInputElement).toHaveProperty("checked", true);
    fireEvent.click(screen.getByLabelText("用途を選ばない"));
    fireEvent.click(screen.getByLabelText("飼い方を選ばない"));
    click("農場の情報を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ name: "A 農場", production: null, housing: null });
    expect(within(section("農場の情報")).getByText(/確認リストは両方を出します/)).toBeTruthy();
  });

  it("農場がまだ未選択のときは、未選択の側が選ばれて開く", async () => {
    mount();
    expect((await screen.findByLabelText("用途を選ばない")) as HTMLInputElement).toHaveProperty("checked", true);
    expect((screen.getByLabelText("飼い方を選ばない") as HTMLInputElement).checked).toBe(true);
  });

  it("飼い方の説明に『確かめておくとよいことの並びに使います』", async () => {
    mount();
    await screen.findByLabelText("農場名");
    expect(within(section("農場の情報")).getByText(/確かめておくとよいことの並びに使います/)).toBeTruthy();
  });

  it("保存すると『最終保存』が進み、保存に失敗したら知らせる", async () => {
    farm = { ...farm!, updatedAt: "" }; // まだ一度も保存していない農場
    mount();
    await screen.findByLabelText("農場名");
    expect(screen.queryByText(/最終保存/)).toBeNull();
    fireEvent.change(screen.getByLabelText("農場名"), { target: { value: "B" } });
    click("農場の情報を保存");
    expect(await screen.findByText("最終保存 11月6日 10:31")).toBeTruthy();
    saveFarm.mockRejectedValueOnce(new Error("x"));
    click("農場の情報を保存");
    expect((await screen.findByRole("alert")).textContent).toMatch(/保存できませんでした/);
  });
});

describe("行き来する町（§5 の③）", () => {
  const pickPref = (code: string) => fireEvent.change(screen.getByLabelText("足す町の県"), { target: { value: code } });
  const pickTown = (code: string) => fireEvent.change(screen.getByLabelText("足す町"), { target: { value: code } });
  const add = () => fireEvent.click(screen.getByRole("button", { name: "この町を足す" }));
  const picker = () => section("行き来する町");

  it("県から市町村を選んで足し、保存は frequentMuniCodes だけ（値は索引のコード）", async () => {
    mount();
    await screen.findByLabelText("足す町の県");
    pickPref("01");
    pickTown("01100");
    add();
    expect(within(picker()).getByRole("button", { name: "札幌市を外す" })).toBeTruthy();
    click("行き来する町を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ frequentMuniCodes: ["01100"] });
  });

  it("選べる町は索引のコードだけ（政令市は市のコード）", async () => {
    mount();
    await screen.findByLabelText("足す町の県");
    pickPref("01");
    const select = (await screen.findByLabelText("足す町")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    const codes = [...select.options].map((o) => o.value).filter(Boolean);
    expect(codes).toContain("01100");
    for (const c of codes) expect(Object.keys(INDEX)).toContain(c);
  });

  it("外せる", async () => {
    farm = { id: "f1", ...farmFixture("u1", { frequentMuniCodes: ["01100", "33100"] }) };
    mount();
    await screen.findByRole("button", { name: "札幌市を外す" });
    fireEvent.click(screen.getByRole("button", { name: "札幌市を外す" }));
    expect(screen.queryByRole("button", { name: "札幌市を外す" })).toBeNull();
    click("行き来する町を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ frequentMuniCodes: ["33100"] });
  });

  it("全部外しても保存できる（空の配列）", async () => {
    farm = { id: "f1", ...farmFixture("u1", { frequentMuniCodes: ["01100"] }) };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "札幌市を外す" }));
    click("行き来する町を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ frequentMuniCodes: [] });
  });

  it("同じ町を 2 度足せない", async () => {
    mount();
    await screen.findByLabelText("足す町の県");
    pickPref("01");
    pickTown("01100");
    add();
    pickPref("01");
    pickTown("01100");
    expect((screen.getByRole("button", { name: "この町を足す" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(picker()).getByText(/もう足してあります/)).toBeTruthy();
    expect(within(picker()).getAllByRole("button", { name: "札幌市を外す" })).toHaveLength(1);
  });

  it("農場の町は足せない", async () => {
    mount(); // 農場は千代田区（13101）
    await screen.findByLabelText("足す町の県");
    pickPref("13");
    pickTown("13101");
    expect((screen.getByRole("button", { name: "この町を足す" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(picker()).getByText(/農場の町は足せません/)).toBeTruthy();
  });

  it("20 件まで。20 件あれば足せない", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `01${201 + i}`);
    farm = { id: "f1", ...farmFixture("u1", { frequentMuniCodes: twenty }) };
    mount();
    await screen.findByLabelText("足す町の県");
    expect(within(picker()).getByText(/20 \/ 20/)).toBeTruthy();
    pickPref("01");
    pickTown("01100");
    expect((screen.getByRole("button", { name: "この町を足す" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(picker()).getByText(/20 件までです/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "北の町1を外す" }));
    expect((screen.getByRole("button", { name: "この町を足す" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("県を替えると、選んだ町は取り消す（前の県の町を足さない）", async () => {
    mount();
    await screen.findByLabelText("足す町の県");
    pickPref("01");
    pickTown("01100");
    pickPref("33");
    expect((screen.getByLabelText("足す町") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("button", { name: "この町を足す" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("住所と緯度経度の欄がなく、保存の通信にも出ない", async () => {
    const { container } = mount();
    await screen.findByLabelText("足す町の県");
    const s = picker();
    expect(within(s).queryByLabelText(/住所|緯度|経度/)).toBeNull();
    expect(s.querySelector('input[name*="address" i], input[name*="lat" i], input[name*="lng" i], input[type="text"], textarea')).toBeNull();
    pickPref("01");
    pickTown("01100");
    add();
    click("行き来する町を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalled());
    expect(JSON.stringify(saveFarm.mock.calls)).not.toMatch(/lat|lng|address|\d+\.\d{3,}/i);
    expect(container.querySelector('input[autocomplete*="address"]')).toBeNull();
  });
});

describe("鶏舎（§8）", () => {
  const h = (over: Partial<SavedHouse> = {}): SavedHouse => ({ id: "h1", ...houseFixture(), ...over });
  const form = () => section("鶏舎");

  it("一覧に名前、鳥の種類、羽数、空舎が出る。消すボタンはない", async () => {
    houses = [h({ id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 1200 }), h({ id: "h2", name: "2 号舎", birdType: "肉用鶏", flockSize: 0, empty: true })];
    mount();
    await screen.findByText("1 号舎");
    const s = form();
    expect(within(s).getByText("1 号舎")).toBeTruthy();
    expect(within(s).getByText(/採卵鶏/)).toBeTruthy();
    expect(within(s).getByText(/1200 羽/)).toBeTruthy();
    expect(within(s).getByText("2 号舎")).toBeTruthy();
    expect(within(s).getByText("空舎")).toBeTruthy();
    expect(within(s).queryByRole("button", { name: /消す|削除|取り除/ })).toBeNull();
    expect(within(s).getByText(/空舎にします/)).toBeTruthy();
  });

  it("鶏舎がなければ『まだありません』。読めなかったときは『ない』と言わず読めなかったと出す", async () => {
    mount();
    expect(await screen.findByText(/鶏舎はまだ登録していません/)).toBeTruthy();
    cleanup();
    listHouses.mockRejectedValue(new Error("permission-denied"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toMatch(/鶏舎の一覧を読めませんでした/);
    expect(screen.queryByText(/鶏舎はまだ登録していません/)).toBeNull();
    expect(screen.queryByRole("button", { name: "鶏舎を足す" })).toBeNull();
  });

  it("足す: saveHouse に {name, birdType, flockSize, empty} だけを渡す（id も入力者もない）", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "鶏舎を足す" }));
    fireEvent.change(screen.getByLabelText("鶏舎の名前"), { target: { value: "1 号舎" } });
    fireEvent.change(screen.getByLabelText("鳥の種類"), { target: { value: "採卵鶏" } });
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "1200" } });
    click("鶏舎を保存");
    await waitFor(() => expect(saveHouse).toHaveBeenCalledTimes(1));
    expect(saveHouse.mock.calls[0]![0]).toEqual({ name: "1 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false });
    expect(Object.keys(saveHouse.mock.calls[0]![0] as object).sort()).toEqual(["birdType", "empty", "flockSize", "name"]);
    expect(await within(form()).findByText(/1200 羽/)).toBeTruthy();
  });

  it("保存の後に saveFarm({}) で updatedAt を進め、『最終保存』が進む", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "鶏舎を足す" }));
    fireEvent.change(screen.getByLabelText("鶏舎の名前"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("鳥の種類"), { target: { value: "肉用鶏" } });
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "50" } });
    click("鶏舎を保存");
    expect(await screen.findByText("最終保存 11月6日 10:31")).toBeTruthy();
    expect(saveFarm).toHaveBeenCalledTimes(1);
    expect(saveFarm.mock.calls[0]).toEqual([{}]);
    expect(saveHouse.mock.invocationCallOrder[0]!).toBeLessThan(saveFarm.mock.invocationCallOrder[0]!);
  });

  it("入力が正しくなければ、理由を出して saveHouse も saveFarm も呼ばない", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "鶏舎を足す" }));
    fireEvent.change(screen.getByLabelText("鶏舎の名前"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("鳥の種類"), { target: { value: "採卵鶏" } });
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "0" } });
    click("鶏舎を保存");
    expect((await screen.findByRole("alert")).textContent).toMatch(/空舎/);
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "12.5" } });
    click("鶏舎を保存");
    expect(saveHouse).not.toHaveBeenCalled();
    expect(saveFarm).not.toHaveBeenCalled();
  });

  it("編集は同じ id に保存する。羽数を変えても saveDeath を呼ばない（過去の flockSizeAt を動かさない）", async () => {
    houses = [h({ id: "h1", name: "1 号舎", flockSize: 1200 })];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "1 号舎を編集" }));
    expect((screen.getByLabelText("鶏舎の名前") as HTMLInputElement).value).toBe("1 号舎");
    expect((screen.getByLabelText("飼養羽数") as HTMLInputElement).value).toBe("1200");
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "900" } });
    click("鶏舎を保存");
    await waitFor(() => expect(saveHouse).toHaveBeenCalledTimes(1));
    expect(saveHouse.mock.calls[0]![0]).toEqual({ id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 900, empty: false });
    expect(saveDeath).not.toHaveBeenCalled();
    expect(await within(form()).findByText(/900 羽/)).toBeTruthy();
    expect(within(form()).getAllByText(/1 号舎/)).toBeTruthy();
    expect(houses).toHaveLength(1);
  });

  it("空舎に切り替えられる。切り替えると羽数は 0 になる", async () => {
    houses = [h({ id: "h1", name: "1 号舎", flockSize: 1200 })];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "1 号舎を編集" }));
    fireEvent.click(screen.getByLabelText(/空舎/));
    expect((screen.getByLabelText("飼養羽数") as HTMLInputElement).value).toBe("0");
    click("鶏舎を保存");
    await waitFor(() => expect(saveHouse).toHaveBeenCalledTimes(1));
    expect(saveHouse.mock.calls[0]![0]).toEqual({ id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 0, empty: true });
    expect(await within(form()).findByText("空舎")).toBeTruthy();
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("空舎をやめて鶏を入れるとき、羽数は入れ直す（0 のままでは保存できない）", async () => {
    houses = [h({ id: "h1", name: "1 号舎", flockSize: 0, empty: true })];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "1 号舎を編集" }));
    fireEvent.click(screen.getByLabelText(/空舎/));
    click("鶏舎を保存");
    expect((await screen.findByRole("alert")).textContent).toMatch(/羽数/);
    expect(saveHouse).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "300" } });
    click("鶏舎を保存");
    await waitFor(() => expect(saveHouse).toHaveBeenCalledTimes(1));
    expect(saveHouse.mock.calls[0]![0]).toEqual({ id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 300, empty: false });
  });

  it("保存に失敗したら知らせ、フォームを閉じない", async () => {
    saveHouse.mockRejectedValueOnce(new Error("x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "鶏舎を足す" }));
    fireEvent.change(screen.getByLabelText("鶏舎の名前"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("鳥の種類"), { target: { value: "採卵鶏" } });
    fireEvent.change(screen.getByLabelText("飼養羽数"), { target: { value: "10" } });
    click("鶏舎を保存");
    expect((await screen.findByRole("alert")).textContent).toMatch(/保存できませんでした/);
    expect(screen.getByLabelText("鶏舎の名前")).toBeTruthy();
    expect(saveFarm).not.toHaveBeenCalled();
  });

  it("羽数を変えても過去の記録は変わらないと説明する", async () => {
    mount();
    await screen.findByRole("button", { name: "鶏舎を足す" });
    expect(within(form()).getByText(/過去の記録の羽数は変わりません/)).toBeTruthy();
  });
});

describe("家保の連絡先（§8）", () => {
  const box = () => screen.getByLabelText("家畜保健衛生所の連絡先") as HTMLTextAreaElement;

  it("saveFarm に {kahoContact} だけ渡す（toEqual）", async () => {
    mount();
    await screen.findByLabelText("家畜保健衛生所の連絡先");
    fireEvent.change(box(), { target: { value: "テスト用の連絡先" } });
    click("家保の連絡先を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ kahoContact: "テスト用の連絡先" });
  });

  it("空でも保存できる", async () => {
    farm = { id: "f1", ...farmFixture("u1", { kahoContact: "前の連絡先" }) };
    mount();
    await screen.findByLabelText("家畜保健衛生所の連絡先");
    expect(box().value).toBe("前の連絡先");
    fireEvent.change(box(), { target: { value: "" } });
    click("家保の連絡先を保存");
    await waitFor(() => expect(saveFarm).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual({ kahoContact: "" });
  });

  it("説明と入力の例に、電話番号の形がない", async () => {
    mount();
    await screen.findByLabelText("家畜保健衛生所の連絡先");
    const s = section("家畜保健衛生所の連絡先");
    const shown = [s.textContent ?? "", box().placeholder].join("\n");
    expect(box().placeholder).not.toBe("");
    expect(shown).not.toMatch(/[0-9０-９]{2,}/);
    expect(shown).not.toMatch(/[0-9０-９][-ー−‐－()（）][0-9０-９]/);
    expect(shown).not.toMatch(/@|https?:/);
  });

  it("県の案内を見て自分で書き写すこと、異状のときに画面へ出すことを説明する", async () => {
    mount();
    await screen.findByLabelText("家畜保健衛生所の連絡先");
    expect(within(section("家畜保健衛生所の連絡先")).getByText(/自分で書き写/)).toBeTruthy();
  });
});

describe("全体", () => {
  it("全文に禁止語がない", async () => {
    houses = [{ id: "h1", ...houseFixture() }];
    farm = { id: "f1", ...farmFixture("u1", { frequentMuniCodes: ["01100"], production: "layer", housing: "open", kahoContact: "x" }) };
    const { container } = mount();
    await screen.findByRole("button", { name: "札幌市を外す" });
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });

  it("『最終保存』は画面に 1 つだけ", async () => {
    mount();
    await screen.findByLabelText("農場名");
    expect(screen.getAllByText(/最終保存/)).toHaveLength(1);
  });
});
