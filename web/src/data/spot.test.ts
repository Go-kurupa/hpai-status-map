import type { FarmPoint } from "@hpai/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSpot,
  loadSpot,
  loadTown,
  parseSpot,
  saveSpot,
  saveTown,
  SPOT_KEY,
  spotFromPick,
  TOWN_KEY,
} from "./spot";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const throwing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

const SPOT: FarmPoint = { meshCode: "53394611", muniCode: "13101", frequentMuniCodes: ["13102"] };

afterEach(() => vi.restoreAllMocks());

describe("spotFromPick", () => {
  it("緯度経度を 3 次メッシュにし、市町村と一緒に返す。座標は残らない", () => {
    const s = spotFromPick(35.681, 139.767, "13101", []);
    expect(s).toEqual({ meshCode: "53394611", muniCode: "13101", frequentMuniCodes: [] });
    expect(Object.keys(s).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
  });

  it("行き来する町は重複と自分の町を除く", () => {
    expect(spotFromPick(35.681, 139.767, "13101", ["13102", "13102", "13101"]).frequentMuniCodes).toEqual(["13102"]);
  });

  it("市町村コードが 5 桁でなければ投げる（保存まで進めない）", () => {
    expect(() => spotFromPick(35.681, 139.767, "1310", [])).toThrow(RangeError);
  });
});

describe("parseSpot", () => {
  it("余計なキーを捨てて、3 つのキーだけにする", () => {
    const p = parseSpot({ ...SPOT, lat: 35.681, lng: 139.767, extra: 1 });
    expect(p).toEqual(SPOT);
    expect(Object.keys(p!).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
  });

  it("JSON の文字列も読める", () => {
    expect(parseSpot(JSON.stringify(SPOT))).toEqual(SPOT);
  });

  it("形が違えば null", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      "{",
      42,
      [],
      {},
      { ...SPOT, meshCode: "5339461" },
      { ...SPOT, meshCode: "53398611" }, // 2 次の桁が 8 以上
      { ...SPOT, muniCode: "1310" },
      { ...SPOT, frequentMuniCodes: "13102" },
      { ...SPOT, frequentMuniCodes: [13102] },
      { ...SPOT, frequentMuniCodes: ["abc"] },
      { meshCode: "53394611", muniCode: "13101" },
    ]) {
      expect(parseSpot(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("保存と読み出し", () => {
  it("saveSpot は 3 つのキーだけを hpai.spot.v1 に書く。緯度経度の欄がない", () => {
    const st = memoryStorage();
    expect(saveSpot({ ...SPOT, lat: 1, lng: 2 } as FarmPoint, st)).toBe(true);
    expect([...st.map.keys()]).toEqual(["hpai.spot.v1"]);
    expect(SPOT_KEY).toBe("hpai.spot.v1");
    const saved = JSON.parse(st.map.get(SPOT_KEY)!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
    expect(st.map.get(SPOT_KEY)).not.toMatch(/lat|lng|latitude|longitude/i);
    expect(loadSpot(st)).toEqual(SPOT);
  });

  it("壊れた値は null。clearSpot で消える", () => {
    const st = memoryStorage({ [SPOT_KEY]: "{broken" });
    expect(loadSpot(st)).toBeNull();
    saveSpot(SPOT, st);
    expect(clearSpot(st)).toBe(true);
    expect(loadSpot(st)).toBeNull();
    expect(st.map.has(SPOT_KEY)).toBe(false);
  });

  it("storage が例外を投げても、読みは null、書きは false（投げない）", () => {
    expect(loadSpot(throwing)).toBeNull();
    expect(loadTown(throwing)).toBeNull();
    expect(saveSpot(SPOT, throwing)).toBe(false);
    expect(saveTown("33214", throwing)).toBe(false);
    expect(clearSpot(throwing)).toBe(false);
    expect(loadSpot(null)).toBeNull();
    expect(saveSpot(SPOT, null)).toBe(false);
  });

  it("localStorage を取り出すだけで例外になる環境でも投げない", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(loadSpot()).toBeNull();
    expect(loadTown()).toBeNull();
    expect(saveSpot(SPOT)).toBe(false);
  });

  it("町は 5 桁のコードだけ hpai.town.v1 に保存する", () => {
    const st = memoryStorage();
    expect(TOWN_KEY).toBe("hpai.town.v1");
    expect(saveTown("33214", st)).toBe(true);
    expect(st.map.get(TOWN_KEY)).toBe("33214");
    expect(loadTown(st)).toBe("33214");
    expect(saveTown(null, st)).toBe(true);
    expect(loadTown(st)).toBeNull();
    expect(saveTown("33", st)).toBe(false);
    expect(loadTown(memoryStorage({ [TOWN_KEY]: "津山市" }))).toBeNull();
  });
});
