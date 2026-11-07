import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import type { FarmPoint } from "@hpai/shared/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearOazaCache } from "../../data/oaza";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickTarget } from "./pickSpot";
import { SpotPicker, type SpotPickerProps } from "./SpotPicker";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { findWordingViolations } from "@hpai/shared/wording";
import { TEXT } from "./texts";

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
  it("題は「鶏舎の場所」。決める前は、決めると何が出るかと、端末の中だけに約 1km のマス目を保存することを説明する（作者 11/7）", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "鶏舎の場所" })).toBeTruthy();
    expect(screen.getByText(/まだ決めていません。決めると、その場所を中心に距離の輪を描き、約 60 km 以内の件数を出します/)).toBeTruthy();
    expect(screen.getByText(/約 1km のマス目だけをこの端末に保存し、送信はしません/)).toBeTruthy();
  });

  it("決めた後は町の名前とマス目、ボタンは［地図で場所を合わせ直す］［場所を消す］", () => {
    const device: FarmPoint = { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] };
    render(<Harness deviceSpot={device} />);
    expect(screen.getByText("東京都 千代田区の約 1km のマス目。この端末に保存しています（送信はしません）")).toBeTruthy();
    expect(screen.getByRole("button", { name: "地図で場所を合わせ直す" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "場所を消す" })).toBeTruthy();
    expect(screen.queryByText(/まだ決めていません/)).toBeNull();
  });

  it("確かめる候補がある間を親に知らせる（町の欄が地図の前後に動いて候補が消えないよう、親が置き場を固定する）", () => {
    const onCandidateChange = vi.fn();
    render(<Harness onCandidateChange={onCandidateChange} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(onCandidateChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    expect(onCandidateChange).toHaveBeenLastCalledWith(false);
  });

  it("場所を合わせる → 町の名前で確かめる → 決める。onSet に渡るのはメッシュと市町村だけ", () => {
    const onSet = vi.fn();
    render(<Harness onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    expect(screen.getByText(/中央の十字を自分の鶏舎のある場所に合わせてください/)).toBeTruthy();
    // 合わせている間も、送信しないことを書く（ボタンの下）
    expect(screen.getByText(TEXT.spotWhy)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" }));
    expect(screen.getByText(/東京都 千代田区/)).toBeTruthy();
    expect(onSet).not.toHaveBeenCalled(); // 確かめるまで保存しない
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    expect(onSet).toHaveBeenCalledWith({ meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] }, null);
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
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせ直す" }));
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

  it("data-active は十字合わせ中と候補がある間だけ付く", () => {
    render(<Harness />);
    const sec = screen.getByRole("region", { name: TEXT.spotTitle });
    expect(sec.getAttribute("data-active")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "地図で場所を合わせる" }));
    expect(sec.getAttribute("data-active")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ここに決める" })); // 候補ができ、合わせ中は終わる
    expect(sec.getAttribute("data-active")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "決める" }));
    expect(sec.getAttribute("data-active")).toBeNull();
  });
});

describe("SpotPicker（WebGL2 が使えない端末、mapless）", () => {
  const NISHI: MuniEntry = { code: "33643", name: "西粟倉村", prefCode: "33", center: [134.33, 35.17], bbox: [134.26, 35.11, 134.42, 35.25] };
  const geo = { index: { "33643": NISHI } } as unknown as Pick<GeoStore, "index">;

  it("十字で合わせるボタンを出さず、町の中心あたりのマス目を使うボタンと短い注記を出す。確かめてから保存する", () => {
    const onSet = vi.fn();
    const onAimingChange = vi.fn();
    render(<SpotPicker getMap={() => null} geo={geo} deviceSpot={null} readOnly={false} saveFailed={false} aiming={false} onAimingChange={onAimingChange} onSet={onSet} onClear={vi.fn()} mapless town="33643" />);
    expect(screen.queryByRole("button", { name: TEXT.spotStart })).toBeNull();
    expect(screen.getByText(TEXT.spotNoMap)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TEXT.meshUseCenter }));
    expect(onSet).not.toHaveBeenCalled(); // 確かめるまで保存しない
    expect(screen.getByText(/西粟倉村/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotDecide }));
    expect(onSet).toHaveBeenCalledWith({ meshCode: latLngToMesh3(35.17, 134.33), muniCode: "33643", frequentMuniCodes: [] }, null);
    expect(onAimingChange).not.toHaveBeenCalledWith(true); // 十字は出さない
    expect(findWordingViolations(TEXT.spotNoMap + TEXT.meshUseCenter)).toEqual([]);
  });

  it("町を選ぶ前はボタンを押せない。やりなおすと十字ではなく最初に戻る", () => {
    const onAimingChange = vi.fn();
    const { rerender } = render(<Harness geo={geo} mapless town={null} onAimingChange={onAimingChange} />);
    expect((screen.getByRole("button", { name: TEXT.meshUseCenter }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Harness geo={geo} mapless town="33643" onAimingChange={onAimingChange} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.meshUseCenter }));
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotRetry }));
    expect(onAimingChange).not.toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: TEXT.meshUseCenter })).toBeTruthy();
  });
});

// 地区（大字）で地図を寄せる（2026-11-06 作者の決定）。一覧は県ごとのファイルを端末に読み、何も送らない
describe("SpotPicker: 地区（大字）で地図を寄せる", () => {
  const geo = { index: { "33643": entry("33643", "西粟倉村", "33"), "33214": entry("33214", "真庭市", "33") } } as unknown as Pick<GeoStore, "index">;
  const PREF33 = { "33643": [["大字筏津", 35.1511, 134.3236], ["大字影石", 35.187, 134.3223]], "33214": [] };
  afterEach(() => {
    clearOazaCache();
    vi.unstubAllGlobals();
  });
  const stubFetch = (body: unknown, ok = true) => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("十字を合わせている間、選んだ町の地区を並べ、選ぶと [経度, 緯度] で寄せ先を渡す。読むのは県のファイルだけ", async () => {
    const fetchMock = stubFetch(PREF33);
    const onAimAt = vi.fn();
    render(<Harness geo={geo} town="33643" onAimAt={onAimAt} />);
    expect(screen.queryByLabelText(TEXT.oazaLabel)).toBeNull(); // 十字を出す前は出さない
    expect(fetchMock).not.toHaveBeenCalled(); // 画面を開いただけでは読まない
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    const select = (await screen.findByLabelText(TEXT.oazaLabel)) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([TEXT.oazaChoose, "大字筏津", "大字影石"]);
    fireEvent.change(select, { target: { value: "1" } });
    expect(onAimAt).toHaveBeenCalledWith(134.3223, 35.187);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/oaza\/33\.json$/u);
    expect(screen.getByText(TEXT.oazaSource)).toBeTruthy();
    expect(findWordingViolations(TEXT.oazaLabel + TEXT.oazaNote + TEXT.oazaSource)).toEqual([]);
  });

  it("「やめる」で選んだ地区を空に戻す", async () => {
    stubFetch(PREF33);
    render(<Harness geo={geo} town="33643" onAimAt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    fireEvent.change(await screen.findByLabelText(TEXT.oazaLabel), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: TEXT.cancel }));
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    expect(((await screen.findByLabelText(TEXT.oazaLabel)) as HTMLSelectElement).value).toBe("");
  });

  it("町に地区がない、一覧を読み込めない、寄せ先を受け取らない、地図が描けない端末では出さない（十字で決められる）", async () => {
    stubFetch(PREF33);
    const { unmount } = render(<Harness geo={geo} town="33214" onAimAt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    await waitFor(() => expect(screen.getByText(TEXT.spotHint)).toBeTruthy());
    expect(screen.queryByLabelText(TEXT.oazaLabel)).toBeNull();
    unmount();
    clearOazaCache();
    stubFetch({}, false);
    const second = render(<Harness geo={geo} town="33643" onAimAt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    await waitFor(() => expect(screen.getByText(TEXT.spotHint)).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText(TEXT.oazaLabel)).toBeNull();
    second.unmount();
    const fetchMock = stubFetch(PREF33);
    render(<Harness geo={geo} town="33643" />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    expect(screen.queryByLabelText(TEXT.oazaLabel)).toBeNull();
    cleanup();
    render(<Harness geo={geo} mapless town="33643" onAimAt={vi.fn()} />);
    expect(screen.queryByLabelText(TEXT.oazaLabel)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("農場の設定への案内（場所は 1 回選べば済む。作者 11/7）", () => {
  const device: FarmPoint = { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] };
  it("場所を決めた後、registerHref があれば、この場所を農場の設定でそのまま使えると案内する", () => {
    render(
      <MemoryRouter>
        <Harness deviceSpot={device} registerHref="/settings/farm" />
      </MemoryRouter>,
    );
    expect(screen.getByText(TEXT.spotRegisterNote)).toBeTruthy();
    expect(screen.getByRole("link", { name: TEXT.spotRegister }).getAttribute("href")).toBe("/settings/farm");
  });

  it("場所を決める前と、registerHref がないとき（見本や再現）は案内しない", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Harness registerHref="/settings/farm" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: TEXT.spotRegister })).toBeNull();
    unmount();
    render(<Harness deviceSpot={device} />);
    expect(screen.queryByRole("link", { name: TEXT.spotRegister })).toBeNull();
  });

  it("端末の町が市町村の一覧にない（合併などで古い値）ときは案内しない（農場の設定でそのまま使えないため）", () => {
    render(
      <MemoryRouter>
        <Harness deviceSpot={{ meshCode: "53394611", muniCode: "01100", frequentMuniCodes: [] }} registerHref="/settings/farm" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: TEXT.spotRegister })).toBeNull();
  });

  it("案内の文は禁止の言い回しを含まない", () => {
    expect(findWordingViolations(`${TEXT.spotRegisterNote}${TEXT.spotRegister}`)).toEqual([]);
  });
});

// 地区名（2026-11-07 作者の決定）: 地区の一覧で選んで決めたときだけ付ける。選んだ地区の目安の点から約 3km より遠くで決めたら付けない
describe("SpotPicker: 地区名を添える", () => {
  const geo = { index: { "33643": entry("33643", "西粟倉村", "33") } } as unknown as Pick<GeoStore, "index">;
  const PREF33 = { "33643": [["大字筏津", 35.1511, 134.3236], ["大字影石", 35.187, 134.3223]] };
  afterEach(() => {
    clearOazaCache();
    vi.unstubAllGlobals();
  });
  const mapAt = (lat: number, lng: number): PickTarget => ({
    getZoom: () => 12,
    getCenter: () => ({ lat, lng }),
    project: () => ({ x: 1, y: 1 }),
    queryRenderedFeatures: () => [{ properties: { c: "33643" } }],
  });
  async function pickOazaAndDecide(map: PickTarget, oaza: string | null) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(PREF33), { status: 200 })));
    const onSet = vi.fn();
    render(<Harness geo={geo} town="33643" onAimAt={vi.fn()} map={map} onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotStart }));
    if (oaza !== null) fireEvent.change(await screen.findByLabelText(TEXT.oazaLabel), { target: { value: oaza } });
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotSet }));
    return onSet;
  }

  it("地区を選び、その目安の点の近くで決めると、候補に地区名を添え、決めると地区名を渡す", async () => {
    const onSet = await pickOazaAndDecide(mapAt(35.188, 134.323), "1");
    expect(screen.getByText("岡山県 西粟倉村 大字影石")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotDecide }));
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ muniCode: "33643", meshCode: latLngToMesh3(35.188, 134.323) }), "大字影石");
  });

  it("選んだ地区の目安の点から約 3km より遠くで決めたら、地区名を付けない", async () => {
    const onSet = await pickOazaAndDecide(mapAt(35.187 + 0.04, 134.3223), "1"); // 北へ約 4.4km
    expect(screen.getByText("岡山県 西粟倉村")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotDecide }));
    expect(onSet).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("地区を選ばずに十字だけで決めたら、地区名を付けない", async () => {
    const onSet = await pickOazaAndDecide(mapAt(35.188, 134.323), null);
    fireEvent.click(screen.getByRole("button", { name: TEXT.spotDecide }));
    expect(onSet).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("保存した場所に地区名があれば、町の名前の後ろに添える", () => {
    const device: FarmPoint = { meshCode: latLngToMesh3(35.188, 134.323), muniCode: "33643", frequentMuniCodes: [] };
    render(<Harness geo={geo} deviceSpot={device} deviceOaza="大字影石" />);
    expect(screen.getByText("岡山県 西粟倉村 大字影石の約 1km のマス目。この端末に保存しています（送信はしません）")).toBeTruthy();
  });
});
