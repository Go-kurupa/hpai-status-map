import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TownPicker, type TownPickerProps } from "./TownPicker";
import { TEXT } from "./texts";

const entry = (code: string, name: string, prefCode: string): MuniEntry => ({ code, name, prefCode, center: [0, 0], bbox: [0, 0, 0, 0] });
const GEO = {
  index: {
    "33203": entry("33203", "津山市", "33"),
    "33214": entry("33214", "真庭市", "33"),
    "33202": entry("33202", "倉敷市", "33"),
    "01403": entry("01403", "泊村", "01"),
    "01404": entry("01404", "泊村", "01"),
    "31201": entry("31201", "鳥取市", "31"),
  },
} as unknown as Pick<GeoStore, "index">;

function setup(o: Partial<TownPickerProps> = {}) {
  const p: TownPickerProps = {
    geo: GEO,
    geoFailed: false,
    town: null,
    readOnly: false,
    picking: false,
    onPickingChange: vi.fn(),
    onChoose: vi.fn(),
    ...o,
  };
  render(
    <MemoryRouter>
      <TownPicker {...p} />
    </MemoryRouter>,
  );
  return p;
}

afterEach(cleanup);

describe("TownPicker", () => {
  it("地図の見る場所のボタンは持たない（切り替えは地図のすぐ上にある）", () => {
    setup();
    expect(screen.queryByRole("button", { name: "全国" })).toBeNull();
    cleanup();
    setup({ town: "33214" });
    expect(screen.queryByRole("button", { name: "全国" })).toBeNull();
    expect(screen.queryByRole("button", { name: TEXT.myTown })).toBeNull();
    cleanup();
    setup({ readOnly: true, town: "33214" });
    expect(screen.queryByRole("button", { name: "全国" })).toBeNull();
    expect(screen.queryByRole("button", { name: TEXT.myTown })).toBeNull();
  });

  it("町が未選択なら『地域を選択』で選ぶ画面を開く", () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: TEXT.pickTown }));
    expect(a.onPickingChange).toHaveBeenCalledWith(true);
  });

  it("県を選ぶと市町村が出る。選ぶまで『この地域にする』は押せない", () => {
    const p = setup({ picking: true });
    const muni = screen.getByLabelText("市町村") as HTMLSelectElement;
    const decide = screen.getByRole("button", { name: TEXT.decideTown }) as HTMLButtonElement;
    expect(muni.disabled).toBe(true);
    expect(decide.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "33" } });
    expect(muni.disabled).toBe(false);
    expect([...muni.options].map((o) => o.textContent)).toEqual(["市町村を選んでください", "倉敷市", "津山市", "真庭市"]);
    expect(decide.disabled).toBe(true);
    fireEvent.change(muni, { target: { value: "33214" } });
    expect(decide.disabled).toBe(false);
    fireEvent.click(decide);
    expect(p.onChoose).toHaveBeenCalledWith("33214");
    expect(p.onPickingChange).toHaveBeenCalledWith(false);
  });

  it("県を変えたら市町村の選びをやり直す（別の県のコードを送らない）", () => {
    const p = setup({ picking: true });
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "33" } });
    fireEvent.change(screen.getByLabelText("市町村"), { target: { value: "33214" } });
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "31" } });
    expect((screen.getByRole("button", { name: TEXT.decideTown }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("市町村") as HTMLSelectElement).value).toBe("");
    expect(p.onChoose).not.toHaveBeenCalled();
  });

  it("同じ県に同じ名前が 2 つあれば、コードで見分ける", () => {
    setup({ picking: true });
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "01" } });
    const names = [...(screen.getByLabelText("市町村") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(names).toEqual(["市町村を選んでください", "泊村（01403）", "泊村（01404）"]);
  });

  it("開いたとき、いまの町の県を初めから選んでおく。地図をさわっても選べると書く。やめられる", () => {
    const p = setup({ picking: true, town: "33214" });
    expect((screen.getByLabelText("都道府県") as HTMLSelectElement).value).toBe("33");
    expect((screen.getByLabelText("市町村") as HTMLSelectElement).value).toBe("33214");
    expect(screen.getByText(TEXT.mapTapHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(p.onPickingChange).toHaveBeenCalledWith(false);
  });

  it("町を選んである間は『地域を選択』を出す", () => {
    const p = setup({ town: "33214" });
    fireEvent.click(screen.getByRole("button", { name: TEXT.changeTown }));
    expect(p.onPickingChange).toHaveBeenCalledWith(true);
  });

  it("会員の農場の場所を使っているときは、変えられないと伝え、選ぶ画面を出さない", () => {
    setup({ readOnly: true, town: "33214", picking: true });
    expect(screen.getByText(/登録した農場の場所で見ています/)).toBeTruthy();
    expect(screen.queryByLabelText("都道府県")).toBeNull();
    expect(screen.queryByRole("button", { name: TEXT.changeTown })).toBeNull();
  });

  it("市町村の一覧がまだ読み込めていない間は『読み込んでいます』。失敗は失敗と書く", () => {
    setup({ picking: true, geo: null });
    expect(screen.getByText(/読み込んでいます/)).toBeTruthy();
    expect(screen.queryByLabelText("都道府県")).toBeNull();
    cleanup();
    setup({ picking: true, geo: null, geoFailed: true });
    expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした");
  });

  it("未選択では『地域を選択』が btn-primary", () => {
    setup();
    expect(screen.getByRole("button", { name: TEXT.pickTown }).className).toContain("btn-primary");
  });

  it("市町村を選ぶまで『県と市町村を選ぶと押せます』が出て、ボタンを結ぶ。選ぶと消える", () => {
    setup({ picking: true });
    const decide = screen.getByRole("button", { name: TEXT.decideTown }) as HTMLButtonElement;
    const hint = screen.getByText(TEXT.decideHint);
    expect(hint.tagName).toBe("P");
    expect(hint.id).not.toBe("");
    expect(decide.getAttribute("aria-describedby")).toBe(hint.id);
    expect(decide.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("都道府県"), { target: { value: "33" } });
    expect(screen.queryByText(TEXT.decideHint)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("市町村"), { target: { value: "33214" } });
    expect(screen.queryByText(TEXT.decideHint)).toBeNull();
    expect(decide.disabled).toBe(false);
  });

  it("新しい文言（選ぶ操作は『地域を選択』、選んだ町は『選んだ地域』）", () => {
    expect(TEXT.pickTown).toBe("地域を選択");
    expect(TEXT.changeTown).toBe("地域を選択");
    expect(TEXT.decideTown).toBe("この地域にする");
    expect(TEXT.mapTapHint).toBe("地図の町を押しても選べます");
  });

  it("入力で探して候補を押すとすぐ決まる", () => {
    const p = setup({ picking: true });
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "津山" } });
    fireEvent.click(screen.getByRole("button", { name: "岡山県 津山市" }));
    expect(p.onChoose).toHaveBeenCalledWith("33203");
    expect(p.onPickingChange).toHaveBeenCalledWith(false);
  });

  it("候補がないと伝える", () => {
    setup({ picking: true });
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "ああ" } });
    expect(screen.getByText("見つかりません。下の県と市町村からも選べます")).toBeTruthy();
  });

  it("変換の途中は見つかりませんを出さない", () => {
    setup({ picking: true });
    const input = screen.getByLabelText(TEXT.searchLabel);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "つ" } });
    expect(screen.queryByText(TEXT.searchNone)).toBeNull();
    fireEvent.compositionEnd(input);
    expect(screen.getByText(TEXT.searchNone)).toBeTruthy();
  });

  it("多いときは数を伝える", () => {
    const many = Object.fromEntries(
      Array.from({ length: 23 }, (_, i) => {
        const code = `33${String(i + 300)}`;
        return [code, entry(code, `町${i}町`, "33")];
      }),
    );
    setup({ picking: true, geo: { index: many } as unknown as Pick<GeoStore, "index"> });
    fireEvent.change(screen.getByLabelText(TEXT.searchLabel), { target: { value: "町" } });
    expect(screen.getByText("ほかに 3 件あります。もう少しくわしく入力してください")).toBeTruthy();
  });

  it("select は入力欄の下に残る", () => {
    setup({ picking: true });
    const input = screen.getByLabelText(TEXT.searchLabel);
    const pref = screen.getByLabelText("都道府県");
    expect(input.compareDocumentPosition(pref) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("場所があるときだけ予告を出す", () => {
    setup({ picking: true, town: "33214", hasSpot: true });
    expect(screen.getByText("別の町にすると、くわしい場所は消えます（あとで決め直せます）")).toBeTruthy();
    cleanup();
    setup({ picking: true, town: "33214" });
    expect(screen.queryByText(TEXT.spotWillClear)).toBeNull();
  });

  it("読み取り専用で農場の場所のときは、設定への道を添える。再現の固定では添えない", () => {
    setup({ readOnly: true, town: "33214" });
    const link = screen.getByRole("link", { name: TEXT.openFarmSettings });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(link.className).toContain("tap-link");
    cleanup();
    setup({ readOnly: true, readOnlyNote: TEXT.spotFixed });
    expect(screen.getByText(TEXT.spotFixed).tagName).toBe("P");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
