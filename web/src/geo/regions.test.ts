import { describe, expect, it } from "vitest";
import { REGIONS, regionOf } from "./regions";

describe("regions", () => {
  it("県から地方が決まる", () => {
    expect(regionOf("33")).toBe("chugoku");
    expect(regionOf("01")).toBe("hokkaido");
    expect(regionOf("47")).toBe("kyushu");
    expect(regionOf("15")).toBe("chubu");
  });

  it("47 県がちょうど 1 回ずつ現れる。並びは北から", () => {
    const all = REGIONS.flatMap((r) => r.prefCodes);
    expect(all).toHaveLength(47);
    expect(new Set(all).size).toBe(47);
    expect(REGIONS.map((r) => r.name)).toEqual(["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"]);
  });
});
