import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TownPicker, type TownPickerProps } from "./TownPicker";

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
    onShowJapan: vi.fn(),
    onShowTown: vi.fn(),
    ...o,
  };
  render(<TownPicker {...p} />);
  return p;
}

afterEach(cleanup);

describe("TownPicker", () => {
  it("ボタンは『全国』と『自分の町』。全国は地図を日本全体にする", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "全国" }));
    expect(p.onShowJapan).toHaveBeenCalled();
  });

  it("町が未選択なら『自分の町』で選ぶ画面を開く。選んだ後は自分の町へ動かす", () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: "自分の町" }));
    expect(a.onPickingChange).toHaveBeenCalledWith(true);
    expect(a.onShowTown).not.toHaveBeenCalled();
    cleanup();
    const b = setup({ town: "33214" });
    fireEvent.click(screen.getByRole("button", { name: "自分の町" }));
    expect(b.onShowTown).toHaveBeenCalled();
    expect(b.onPickingChange).not.toHaveBeenCalled();
  });

  it("県を選ぶと市町村が出る。選ぶまで『この町にする』は押せない", () => {
    const p = setup({ picking: true });
    const muni = screen.getByLabelText("市町村") as HTMLSelectElement;
    const decide = screen.getByRole("button", { name: "この町にする" }) as HTMLButtonElement;
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
    expect((screen.getByRole("button", { name: "この町にする" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(screen.getByText(/地図の町をさわっても選べます/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(p.onPickingChange).toHaveBeenCalledWith(false);
  });

  it("町を選んである間は『町を変える』を出す", () => {
    const p = setup({ town: "33214" });
    fireEvent.click(screen.getByRole("button", { name: "町を変える" }));
    expect(p.onPickingChange).toHaveBeenCalledWith(true);
  });

  it("会員の農場の場所を使っているときは、変えられないと伝え、選ぶ画面を出さない", () => {
    setup({ readOnly: true, town: "33214", picking: true });
    expect(screen.getByText(/登録した農場の場所で見ています/)).toBeTruthy();
    expect(screen.queryByLabelText("都道府県")).toBeNull();
    expect(screen.queryByRole("button", { name: "町を変える" })).toBeNull();
  });

  it("市町村の一覧がまだ読めていない間は『読み込んでいます』。失敗は失敗と書く", () => {
    setup({ picking: true, geo: null });
    expect(screen.getByText(/読み込んでいます/)).toBeTruthy();
    expect(screen.queryByLabelText("都道府県")).toBeNull();
    cleanup();
    setup({ picking: true, geo: null, geoFailed: true });
    expect(screen.getByRole("alert").textContent).toContain("読めませんでした");
  });
});
