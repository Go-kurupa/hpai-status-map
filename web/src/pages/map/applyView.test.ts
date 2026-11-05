import type { Case, HistoryCase, WildBird } from "@hpai/shared/types";
import { describe, expect, it, vi } from "vitest";
import historyJson from "../../../../data/history/cases.json";
import { distanceRingsOf } from "../../geo/distanceRings";
import { applyDistanceRings, applyView, applyWildBirds, wildBirdFeatures, type ViewTarget } from "./applyView";
import { PAINT } from "./mapStyle";
import { buildSeasonView } from "./seasonView";

const history = historyJson as HistoryCase[];

function fakeMap() {
  const filters = new Map<string, unknown>();
  const paints = new Map<string, unknown>();
  const setData = vi.fn();
  const map: ViewTarget = {
    setFilter: (id, f) => void filters.set(id, f),
    setPaintProperty: (id, prop, v) => void paints.set(`${id}/${prop}`, v),
    getSource: (id) => (id === "wild-birds" || id === "muni" || id === "distance-rings" ? { setData } : undefined),
  };
  return { map, filters, paints, setData };
}

function mkCase(o: Partial<Case> = {}): Case {
  return {
    id: "c1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-20T12:00:00+09:00",
    ...o,
  };
}

const IN = (key: string, codes: string[]) => ["in", ["get", key], ["literal", codes]];

describe("applyView", () => {
  it("シーズンの切り替えは setFilter だけで、setData を 1 回も呼ばない", () => {
    const { map, filters, setData } = fakeMap();
    const cur = buildSeasonView({ season: 2026, current: 2026, currentCases: [mkCase()], history });
    const last = buildSeasonView({ season: 2025, current: 2026, currentCases: [mkCase()], history });
    applyView(map, { view: cur, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect(filters.get("case-confirmed")).toEqual(IN("c", ["33203"]));
    applyView(map, { view: last, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect((filters.get("case-confirmed") as unknown[][])[2]![1]).toContain("33203");
    expect(setData).toHaveBeenCalledTimes(0);
  });

  it("疑いと確定を別の層の filter に分ける", () => {
    const { map, filters } = fakeMap();
    const sus = mkCase({ id: "a", muniCode: "33204", stages: { suspected: { date: "2026-11-19", time: null } } });
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [mkCase(), sus], history: [] });
    applyView(map, { view: v, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect(filters.get("case-suspected")).toEqual(IN("c", ["33204"]));
    expect(filters.get("case-confirmed")).toEqual(IN("c", ["33203"]));
  });

  it("読めなかった県は pref-unwatched の filter に入る（今季）", () => {
    const { map, filters } = fakeMap();
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [], history: [] });
    applyView(map, { view: v, failedPrefCodes: ["33"], myMuniCode: null, nearMuniCodes: [] });
    expect(filters.get("pref-unwatched")).toEqual(["in", ["get", "p"], ["literal", ["33"]]]);
  });

  it("過去のシーズンには今日の見回りの失敗を重ねない", () => {
    const { map, filters } = fakeMap();
    const v = buildSeasonView({ season: 2025, current: 2026, currentCases: [], history });
    applyView(map, { view: v, failedPrefCodes: ["33"], myMuniCode: null, nearMuniCodes: [] });
    expect(filters.get("pref-unwatched")).toEqual(["in", ["get", "p"], ["literal", []]]);
  });

  it("自分の町と隣の町の線を filter で出す。なければ空", () => {
    const { map, filters } = fakeMap();
    const v = buildSeasonView({ season: 2026, current: 2026, currentCases: [], history: [] });
    applyView(map, { view: v, failedPrefCodes: [], myMuniCode: "33203", nearMuniCodes: ["33204", "33205"] });
    expect(filters.get("my-town")).toEqual(IN("c", ["33203"]));
    expect(filters.get("near-line")).toEqual(IN("c", ["33204", "33205"]));
    applyView(map, { view: v, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect(filters.get("my-town")).toEqual(IN("c", []));
    expect(filters.get("near-line")).toEqual(IN("c", []));
  });

  it("今季は段階の色、過去は事実の色で塗る", () => {
    const { map, paints } = fakeMap();
    const cur = buildSeasonView({ season: 2026, current: 2026, currentCases: [], history: [] });
    const old = buildSeasonView({ season: 2025, current: 2026, currentCases: [], history });
    applyView(map, { view: cur, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect(paints.get("case-confirmed/fill-color")).toBe(PAINT.current);
    expect(paints.get("case-suspected/fill-pattern")).toBe(PAINT.hatchCurrent);
    applyView(map, { view: old, failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] });
    expect(paints.get("case-confirmed/fill-color")).toBe(PAINT.past);
    expect(paints.get("case-suspected/fill-pattern")).toBe(PAINT.hatchPast);
  });
});

describe("野鳥の層", () => {
  it("過去のシーズンに切り替えると、野鳥の 2 層は何も通さず、setData は呼ばない。今季に戻せば出る", () => {
    const { map, filters, setData } = fakeMap();
    const cur = buildSeasonView({ season: 2026, current: 2026, currentCases: [], history });
    const old = buildSeasonView({ season: 2025, current: 2026, currentCases: [], history });
    const st = { failedPrefCodes: [], myMuniCode: null, nearMuniCodes: [] };
    applyView(map, { view: cur, ...st });
    expect(filters.get("wild-bird-screening")).toEqual(["==", ["get", "t"], "screening_positive"]);
    expect(filters.get("wild-bird-confirmed")).toEqual(["==", ["get", "t"], "hpai_confirmed"]);
    applyView(map, { view: old, ...st });
    expect(filters.get("wild-bird-screening")).toEqual(["in", ["get", "t"], ["literal", []]]);
    expect(filters.get("wild-bird-confirmed")).toEqual(["in", ["get", "t"], ["literal", []]]);
    applyView(map, { view: cur, ...st });
    expect(filters.get("wild-bird-confirmed")).toEqual(["==", ["get", "t"], "hpai_confirmed"]);
    expect(setData).toHaveBeenCalledTimes(0);
  });
});

const bird = (o: Partial<WildBird>): WildBird => ({
  id: "w1",
  season: 2026,
  date: "2026-11-10",
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  species: null,
  test: "hpai_confirmed",
  focusZone: { from: null, to: null },
  sourceUrl: "https://example.test/x",
  ...o,
});

describe("野鳥", () => {
  const locate = (b: WildBird): [number, number] | null => (b.muniCode === "33203" ? [134, 35] : null);

  it("否定を除き、検査中と確定を t で分ける", () => {
    const { features, unplaced } = wildBirdFeatures(
      [
        bird({ id: "a", test: "screening_positive" }),
        bird({ id: "b", test: "hpai_confirmed" }),
        bird({ id: "c", test: "negative" }),
      ],
      locate,
    );
    expect(features.map((f) => [f.properties.id, f.properties.t])).toEqual([
      ["a", "screening_positive"],
      ["b", "hpai_confirmed"],
    ]);
    expect(unplaced).toBe(0);
  });

  it("場所が分からない野鳥は点にせず unplaced に数える", () => {
    const { features, unplaced } = wildBirdFeatures([bird({ id: "a", muniCode: null })], locate);
    expect(features).toHaveLength(0);
    expect(unplaced).toBe(1);
  });

  it("applyWildBirds は wild-birds の source にだけ setData する", () => {
    const { map, setData } = fakeMap();
    applyWildBirds(map, [bird({})], locate);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0]![0]).toMatchObject({ type: "FeatureCollection" });
  });
});

describe("applyDistanceRings", () => {
  it("輪があれば source に渡し、なければ空にする（地点を消したら輪も消える）", () => {
    const { map, setData } = fakeMap();
    const rings = distanceRingsOf("53340000")!;
    applyDistanceRings(map, rings);
    expect(setData).toHaveBeenLastCalledWith(rings);
    applyDistanceRings(map, null);
    expect(setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] });
  });
});
