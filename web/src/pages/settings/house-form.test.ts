import { describe, expect, it } from "vitest";
import { BIRD_TYPES, parseHouseInput } from "./houseForm";

const ok = { name: "1 号舎", birdType: "採卵鶏", flockSize: "1200", empty: false };

describe("BIRD_TYPES（報告文はこの語で集計する）", () => {
  it("採卵鶏、肉用鶏、種鶏、あひる、うずら、その他の 6 つ", () => {
    expect(BIRD_TYPES).toEqual(["採卵鶏", "肉用鶏", "種鶏", "あひる", "うずら", "その他"]);
  });
});

describe("parseHouseInput", () => {
  it("正しい入力は {name, birdType, flockSize, empty} だけの House にする（入力者を持たない）", () => {
    const r = parseHouseInput(ok);
    expect(r).toEqual({ ok: true, house: { name: "1 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false } });
  });

  it("名前の前後の空白は取る。名前がなければ拒む", () => {
    expect(parseHouseInput({ ...ok, name: "  A 棟  " })).toMatchObject({ ok: true, house: { name: "A 棟" } });
    for (const name of ["", "   ", "　"]) {
      const r = parseHouseInput({ ...ok, name });
      expect(r.ok).toBe(false);
    }
  });

  it("鳥の種類がなければ拒む。BIRD_TYPES の外の語も拒む", () => {
    expect(parseHouseInput({ ...ok, birdType: "" }).ok).toBe(false);
    expect(parseHouseInput({ ...ok, birdType: "にわとり" }).ok).toBe(false);
    for (const birdType of BIRD_TYPES) expect(parseHouseInput({ ...ok, birdType }).ok).toBe(true);
  });

  it("羽数の文字、負の数、小数、空を拒む", () => {
    for (const flockSize of ["abc", "百", "12羽", "-5", "-0", "1.5", "1.0", "1e3", "", "  ", "0x10"]) {
      const r = parseHouseInput({ ...ok, flockSize });
      expect(r.ok, `flockSize=${JSON.stringify(flockSize)}`).toBe(false);
    }
  });

  it("安全に数えられない大きさの羽数を拒む", () => {
    expect(parseHouseInput({ ...ok, flockSize: "9007199254740993" }).ok).toBe(false);
    expect(parseHouseInput({ ...ok, flockSize: "99999999999" }).ok).toBe(false);
  });

  it("全角の数字は半角として読む【計】", () => {
    expect(parseHouseInput({ ...ok, flockSize: "１２００" })).toMatchObject({ ok: true, house: { flockSize: 1200 } });
  });

  it("0 羽は空舎のときだけ通す", () => {
    expect(parseHouseInput({ ...ok, flockSize: "0", empty: false }).ok).toBe(false);
    expect(parseHouseInput({ ...ok, flockSize: "0", empty: true })).toEqual({
      ok: true,
      house: { name: "1 号舎", birdType: "採卵鶏", flockSize: 0, empty: true },
    });
  });

  it("空舎の羽数を空にしない（未設定と空舎を混ぜない）。空舎に 1 羽以上も拒む", () => {
    expect(parseHouseInput({ ...ok, flockSize: "", empty: true }).ok).toBe(false);
    expect(parseHouseInput({ ...ok, flockSize: "300", empty: true }).ok).toBe(false);
  });

  it("拒むときは errors に理由を日本語で返す。複数あれば全部", () => {
    const r = parseHouseInput({ name: "", birdType: "", flockSize: "x", empty: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(3);
    for (const e of r.errors) expect(e).toMatch(/[ぁ-んァ-ン一-龥]/);
  });
});
