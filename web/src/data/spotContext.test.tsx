import type { FarmPoint } from "@hpai/shared/types";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordStoreProvider } from "./context";
import { SPOT_KEY, TOWN_KEY } from "./spot";
import { SpotProvider, useSpot, useSpotState, useTown } from "./spotContext";
import type { RecordStore } from "./types";

const DEVICE: FarmPoint = { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] };
const FARM = { meshCode: "53394612", muniCode: "13102", prefCode: "13", frequentMuniCodes: ["13103"] };
const FIXED: FarmPoint = { meshCode: "52351234", muniCode: "33622", frequentMuniCodes: [] };

function fakeStore(getFarm: () => Promise<unknown>): { store: RecordStore; getFarm: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(getFarm);
  const reject = () => Promise.reject(new Error("unused"));
  const store = {
    mode: "firestore",
    getFarm: fn,
    saveFarm: reject,
    listHouses: reject,
    saveHouse: reject,
    listDeaths: reject,
    saveDeath: reject,
    listChecks: reject,
    saveCheck: reject,
    getCaseDraft: reject,
    isMailStopped: reject,
  } as unknown as RecordStore;
  return { store, getFarm: fn };
}

function Show() {
  const spot = useSpot();
  return <p data-testid="spot">{spot ? `${spot.muniCode}/${spot.meshCode}` : "なし"}</p>;
}
function Idle() {
  return <p>公開の画面</p>;
}

const flush = () => act(async () => {});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("SpotProvider", () => {
  it("置くだけでは getFarm を呼ばない（根の Provider が公開の画面に Firebase を読ませない）", async () => {
    const { store, getFarm } = fakeStore(() => Promise.resolve(null));
    render(
      <RecordStoreProvider value={store}>
        <SpotProvider>
          <Idle />
        </SpotProvider>
      </RecordStoreProvider>,
    );
    await flush();
    expect(getFarm).not.toHaveBeenCalled();
  });

  it("useSpot が最初に呼ばれたときに 1 度だけ getFarm を呼ぶ。会員の農場が端末内より先", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    const { store, getFarm } = fakeStore(() => Promise.resolve(FARM));
    render(
      <RecordStoreProvider value={store}>
        <SpotProvider>
          <Show />
          <Show />
        </SpotProvider>
      </RecordStoreProvider>,
    );
    expect(screen.getAllByTestId("spot")[0]!.textContent).toBe("13101/53394611"); // 農場が届くまでは端末内
    await flush();
    expect(getFarm).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("spot")[0]!.textContent).toBe("13102/53394612");
  });

  it("農場がない（null）か、読めない（reject）ときは端末内の地点のまま", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    for (const getFarm of [() => Promise.resolve(null), () => Promise.reject(new Error("permission-denied"))]) {
      const { store } = fakeStore(getFarm);
      const { unmount } = render(
        <RecordStoreProvider value={store}>
          <SpotProvider>
            <Show />
          </SpotProvider>
        </RecordStoreProvider>,
      );
      await flush();
      expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
      unmount();
    }
  });

  it("fixed があれば fixed が先。getFarm を呼ばず、端末内の保存を書かない。fixed を外すと端末内の地点が使える", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    const { store, getFarm } = fakeStore(() => Promise.resolve(FARM));
    function Edit() {
      const s = useSpotState();
      const t = useTown();
      return (
        <>
          <p data-testid="s">{`${s.source}/${s.spot?.muniCode}/${s.readOnly}/${t.town}`}</p>
          <button onClick={() => { s.setDeviceSpot(DEVICE); t.setTown("13999"); }}>書く</button>
        </>
      );
    }
    render(
      <RecordStoreProvider value={store}>
        <SpotProvider fixed={FIXED}>
          <Edit />
        </SpotProvider>
      </RecordStoreProvider>,
    );
    await flush();
    expect(screen.getByTestId("s").textContent).toBe("fixed/33622/true/33622");
    act(() => screen.getByText("書く").click());
    expect(getFarm).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(SPOT_KEY)!)).toEqual(DEVICE); // 触っていない
    expect(localStorage.getItem(TOWN_KEY)).toBeNull();
  });

  it("fixed を外す（再現の『選択地域で見る』）と、端末内の地点が使える。fixed のあいだは書かない", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    const tree = (fixed: FarmPoint | null) => (
      <SpotProvider fixed={fixed}>
        <Show />
      </SpotProvider>
    );
    const { rerender } = render(tree(FIXED));
    expect(screen.getByTestId("spot").textContent).toBe("33622/52351234");
    rerender(tree(null));
    expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
  });

  it("RecordStoreProvider がなくても動く（再現）。地点は端末内だけ", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    render(
      <SpotProvider>
        <Show />
      </SpotProvider>,
    );
    await flush();
    expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
  });

  it("地点を決めると 3 つのキーだけを保存し、町も同じ市町村にする", async () => {
    function Set() {
      const s = useSpotState();
      return <button onClick={() => s.setDeviceSpot({ ...DEVICE, lat: 1 } as FarmPoint)}>決める</button>;
    }
    render(
      <SpotProvider>
        <Set />
        <Show />
      </SpotProvider>,
    );
    act(() => screen.getByText("決める").click());
    expect(Object.keys(JSON.parse(localStorage.getItem(SPOT_KEY)!)).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
    expect(localStorage.getItem(TOWN_KEY)).toBe("13101");
    expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
  });

  it("別の町を選ぶと、前のくわしい場所を消す（古い場所が新しい町を上書きしない）", async () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(DEVICE));
    let result: { clearedSpot: boolean } | null = null;
    function Pick() {
      const t = useTown();
      return (
        <>
          <button onClick={() => { result = t.setTown("33214"); }}>別の町</button>
          <button onClick={() => { result = t.setTown("13101"); }}>同じ町</button>
          <p data-testid="town">{t.town}</p>
        </>
      );
    }
    render(
      <SpotProvider>
        <Pick />
        <Show />
      </SpotProvider>,
    );
    act(() => screen.getByText("同じ町").click());
    expect(result).toEqual({ clearedSpot: false });
    expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
    act(() => screen.getByText("別の町").click());
    expect(result).toEqual({ clearedSpot: true });
    expect(screen.getByTestId("spot").textContent).toBe("なし");
    expect(screen.getByTestId("town").textContent).toBe("33214");
    expect(localStorage.getItem(SPOT_KEY)).toBeNull();
    expect(localStorage.getItem(TOWN_KEY)).toBe("33214");
  });

  it("会員の農場があるあいだは、端末内の町や場所を変えられない", async () => {
    const { store } = fakeStore(() => Promise.resolve(FARM));
    function State() {
      const s = useSpotState();
      return <p data-testid="s">{`${s.source}/${s.readOnly}`}</p>;
    }
    render(
      <RecordStoreProvider value={store}>
        <SpotProvider>
          <State />
        </SpotProvider>
      </RecordStoreProvider>,
    );
    await flush();
    expect(screen.getByTestId("s").textContent).toBe("farm/true");
  });

  it("storage が使えなくても、そのページを開いているあいだは使える。saveFailed が立つ", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    function Set() {
      const s = useSpotState();
      return (
        <>
          <button onClick={() => s.setDeviceSpot(DEVICE)}>決める</button>
          <p data-testid="f">{String(s.saveFailed)}</p>
        </>
      );
    }
    render(
      <SpotProvider>
        <Set />
        <Show />
      </SpotProvider>,
    );
    act(() => screen.getByText("決める").click());
    expect(screen.getByTestId("spot").textContent).toBe("13101/53394611");
    expect(screen.getByTestId("f").textContent).toBe("true");
    vi.restoreAllMocks();
  });
});
