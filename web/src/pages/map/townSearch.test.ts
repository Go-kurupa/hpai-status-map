import type { MuniEntry } from "@hpai/shared/geo";
import { describe, expect, it } from "vitest";
import { searchTowns } from "./townSearch";

const entry = (code: string, name: string, prefCode: string): MuniEntry => ({ code, name, prefCode, center: [0, 0], bbox: [0, 0, 0, 0] });
const index = (list: MuniEntry[]) => Object.fromEntries(list.map((e) => [e.code, e]));
const I = index([
  entry("33203", "津山市", "33"),
  entry("33214", "真庭市", "33"),
  entry("33202", "倉敷市", "33"),
  entry("33643", "西粟倉村", "33"),
  entry("01403", "泊村", "01"),
  entry("01696", "泊村", "01"),
  entry("31201", "鳥取市", "31"),
  entry("13206", "府中市", "13"),
  entry("34208", "府中市", "34"),
]);

describe("searchTowns", () => {
  it("空の入力は候補なし", () => {
    expect(searchTowns(I, "")).toEqual({ hits: [], more: 0 });
    expect(searchTowns(I, "  ")).toEqual({ hits: [], more: 0 });
  });

  it("部分一致で県名を前に付ける", () => {
    expect(searchTowns(I, "粟倉").hits).toEqual([{ code: "33643", label: "岡山県 西粟倉村" }]);
  });

  it("県名から続けて打っても当たる", () => {
    expect(searchTowns(I, "岡山西粟倉").hits[0]?.code).toBe("33643");
  });

  it("空白と全角をそろえる", () => {
    expect(searchTowns(I, " 西粟倉　").hits[0]?.code).toBe("33643");
    expect(searchTowns(I, "岡山　西粟倉").hits[0]?.code).toBe("33643");
  });

  it("同じ名前が先、始まりが次、ほかはコード順", () => {
    const J = index([entry("33999", "美津山町", "33"), entry("33203", "津山市", "33"), entry("33100", "仮津山村", "33")]);
    expect(searchTowns(J, "津山市").hits[0]?.code).toBe("33203");
    expect(searchTowns(J, "津山").hits.map((h) => h.code)).toEqual(["33203", "33100", "33999"]);
  });

  it("同じ県の同名だけコードを付ける", () => {
    expect(searchTowns(I, "泊村").hits.map((h) => h.label)).toEqual(["北海道 泊村（01403）", "北海道 泊村（01696）"]);
    expect(searchTowns(I, "府中市").hits.map((h) => h.label)).toEqual(["東京都 府中市", "広島県 府中市"]);
  });

  it("20 件を超えた分は数だけ", () => {
    const K = index(Array.from({ length: 25 }, (_, i) => entry(`33${String(i + 100)}`, `町${i}町`, "33")));
    const r = searchTowns(K, "町");
    expect(r.hits).toHaveLength(20);
    expect(r.more).toBe(5);
  });
});
