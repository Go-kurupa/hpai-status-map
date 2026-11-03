import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import type { FarmPoint } from "@hpai/shared/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickTarget } from "./pickSpot";
import { SpotPicker, type SpotPickerProps } from "./SpotPicker";

const entry = (code: string, name: string, prefCode: string): MuniEntry => ({ code, name, prefCode, center: [0, 0], bbox: [0, 0, 0, 0] });
const GEO = { index: { "13101": entry("13101", "千代田区", "13"), "33203": entry("33203", "津山市", "33") } } as unknown as Pick<GeoStore, "index">;

function fakeMap(o: { zoom?: number; hit?: string | null } = {}): PickTarget {
  return {
    getZoom: () => o.zoom ?? 12,
    getCenter: () => ({ lat: 35.681, lng: 139.767 }),
    project: () => ({ x: 1, y: 1 }),
    queryRenderedFeatures: () => (o.hit === null ? [] : [{ properties: { c: o.hit ?? "13101" } }]),
  };
}

function Harness(p: Partial<SpotPickerProps> & { map?: PickTarget | null }) {
  const [aiming, setAiming] = useState(false);
  const { map, ...rest } = p;
  return (
    <SpotPicker
      getMap={() => (map === undefined ? fakeMap() : map)}
      geo={GEO}
      deviceSpot={null}
      readOnly={false}
      saveFailed={false}
      aiming={aiming}
      onAimingChange={setAiming}
      onSet={vi.fn()}
      onClear={vi.fn()}
      {...rest}
    />
  );
}

afterEach(cleanup);

describe("SpotPicker", () => {
  it("端末の中だけに、約 1km のマス目と市町村だけを保存すると説明する", () => {
    render(<Harness />);
    expect(screen.getByText(/約 1km のマス目と市町村だけを、この端末の中に保存します。送信はしません/)).toBeTruthy();
  });

  it("場所を合わせる → 町の名前で確かめる → 決める。onSet に渡るのはメッシュと市町村だけ", () => {
    const onSet = vi.fn();
    render(<Harness onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    expect(screen.getByText(/中央の十字を自分の鶏舎のある場所に合わせてください/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(screen.getByText(/東京都 千代田区/)).toBeTruthy();
    expect(onSet).not.toHaveBeenCalled(); // 確かめるまで保存しない
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    expect(onSet).toHaveBeenCalledWith({ meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] });
    expect(JSON.stringify(onSet.mock.calls)).not.toMatch(/lat|lng|35\.68|139\.76/);
  });

  it("やりなおすと、また十字を合わせる状態に戻る", () => {
    const onSet = vi.fn();
    render(<Harness onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    fireEvent.click(screen.getByRole("button", { name: "やりなおす" }));
    expect(screen.getByRole("button", { name: "ここに決める" })).toBeTruthy();
    expect(onSet).not.toHaveBeenCalled();
  });

  it("海の上なら『町の上に合わせてください』。保存しない", () => {
    const onSet = vi.fn();
    render(<Harness onSet={onSet} map={fakeMap({ hit: null })} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(screen.getByRole("alert").textContent).toBe("町の上に合わせてください");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("拡大が足りなければ、拡大を促す", () => {
    render(<Harness map={fakeMap({ zoom: 5 })} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(screen.getByRole("alert").textContent).toMatch(/拡大/);
  });

  it("行き来する町を引き継ぐ。場所を消せる", () => {
    const device: FarmPoint = { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: ["33203"] };
    const onSet = vi.fn();
    const onClear = vi.fn();
    render(<Harness deviceSpot={device} onSet={onSet} onClear={onClear} />);
    expect(screen.getByText(/千代田区/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "場所を消す" }));
    expect(onClear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    expect(onSet.mock.calls[0]![0].frequentMuniCodes).toEqual(["33203"]);
  });

  it("端末に保存できなかったときは、その旨を伝える", () => {
    render(<Harness saveFailed />);
    expect(screen.getByText(/この端末では保存できませんでした/)).toBeTruthy();
  });

  it("会員の農場や再現の場所を使っているときは何も出さない", () => {
    const { container } = render(<Harness readOnly />);
    expect(container.textContent).toBe("");
  });

  it("地図がまだなければ、決められない旨を伝える", () => {
    render(<Harness map={null} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(screen.getByRole("alert").textContent).toMatch(/地図を読み込んでいます/);
  });
});
