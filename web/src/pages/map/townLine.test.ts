import { createGeoStore, GeoNotLoadedError, type GeoStore } from "@hpai/shared/geo";
import { computeAreaStatus, computeLevel } from "@hpai/shared/level";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import type { AreaStatus, Case, FarmPoint, LevelResult, WildBird } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { areaLine, levelLine, neighborPrefsOf, resolveTown, resolveTownLine, withWatchState, type TownLine } from "./townLine";
import { SURVEILLANCE_NOTE, TEXT } from "./texts";

const SEASON = 2026;
const ASOF = "2026-11-10T09:00:00+09:00";

function mkCase(o: Partial<Case> & { id: string }): Case {
  return {
    season: SEASON,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-12-20T12:00:00+09:00",
    ...o,
  };
}
const lifted = (d: string) => ({ date: d, time: null });

function textOf(l: TownLine): string {
  return [l.main, ...l.details].join("\n");
}

function result(o: Partial<LevelResult> & Pick<LevelResult, "level" | "reasons">): LevelResult {
  return { shipmentLifted: false, inSurveillanceNote: false, ...o };
}
const reason = (caseId: string, level: 1 | 2 | 3, kind: "within_radius" | "same_muni" | "adjacent" | "frequent") => ({
  caseId,
  level,
  kind,
  distanceKm: null,
  radiusKm: null,
});
const band = (caseId: string, distanceKm: number) => ({ caseId, level: 3 as const, kind: "distance_band" as const, distanceKm, radiusKm: null });

describe("levelLine（§5 の文）", () => {
  const c1 = mkCase({ id: "c1" });

  it("① 区域に入っている可能性。色は lv1。事例の行は『津山市で確定（12 月 20 日）』", () => {
    const l = levelLine(result({ level: 1, reasons: [reason("c1", 1, "within_radius")] }), [c1]);
    expect(l.tone).toBe("lv1");
    expect(l.main).toBe("区域に入っている可能性があります。県の連絡を確かめてください");
    expect(l.details).toContain("津山市で確定（12 月 20 日）");
  });

  it("疑いだけの事例は『津山市で疑い（12 月 19 日）』", () => {
    const c = mkCase({ id: "c2", stages: { suspected: { date: "2026-12-19", time: null } } });
    const l = levelLine(result({ level: 1, reasons: [reason("c2", 1, "same_muni")] }), [c]);
    expect(l.details).toContain("津山市で疑い（12 月 19 日）");
  });

  it("② 隣町で発生しました（lv2）", () => {
    const l = levelLine(result({ level: 2, reasons: [reason("c1", 2, "adjacent")] }), [c1]);
    expect(l).toMatchObject({ tone: "lv2", main: "隣町で発生しました" });
  });

  it("移動制限の解除の後の同じ市町村（level 2、same_muni）は sameMuniLifted で、どこにも『隣町』がない", () => {
    const l = levelLine(
      result({ level: 2, reasons: [reason("c1", 2, "same_muni"), reason("c3", 2, "adjacent")] }),
      [c1, mkCase({ id: "c3", muniCode: "33214", muniName: "真庭市" })],
    );
    expect(l.main).toBe(FIXED_TEXT.sameMuniLifted);
    expect(l.tone).toBe("lv2");
    expect(textOf(l)).not.toMatch(/隣町/);
  });

  it("③ 登録した町で発生しました（lv3）", () => {
    const l = levelLine(result({ level: 3, reasons: [reason("c1", 3, "frequent")] }), [c1]);
    expect(l).toMatchObject({ tone: "lv3", main: "登録した町で発生しました" });
  });

  it("③ 距離の帯は『約 N km 先で発生しました』（N は最も近い発生の四捨五入。lv3）。『区域』『登録』の語を使わない", () => {
    const c2 = mkCase({ id: "c2", muniCode: "33214", muniName: "真庭市" });
    const l = levelLine(result({ level: 3, reasons: [band("c1", 42.6), band("c2", 30.5)] }), [c1, c2]);
    expect(l).toMatchObject({ tone: "lv3", main: "約 31 km 先で発生しました" });
    expect(l.details).toEqual(["津山市で確定（12 月 20 日）", "真庭市で確定（12 月 20 日）"]);
    expect(textOf(l)).not.toMatch(/区域|登録/);
    expect(levelLine(result({ level: 3, reasons: [band("c1", 30.4)] }), [c1]).main).toBe("約 30 km 先で発生しました");
  });

  it("帯の距離が 1km 未満でも『約 0 km』と書かない", () => {
    expect(levelLine(result({ level: 3, reasons: [band("c1", 0.2)] }), [c1]).main).toBe("約 1 km 先で発生しました");
  });

  it("帯と登録した町の両方に当たると、主文は帯で、登録した町で発生したことも詳細に残す", () => {
    const c2 = mkCase({ id: "c2", muniCode: "01100", muniName: "札幌市", prefCode: "01" });
    const l = levelLine(result({ level: 3, reasons: [band("c1", 30), reason("c2", 3, "frequent")] }), [c1, c2]);
    expect(l.main).toBe("約 30 km 先で発生しました");
    expect(l.details).toEqual([TEXT.frequent, "津山市で確定（12 月 20 日）", "札幌市で確定（12 月 20 日）"]);
  });

  it("1 つの事例が帯の中の登録した町でも、詳細に登録した町の文を残す", () => {
    const l = levelLine(result({ level: 3, reasons: [band("c1", 30)] }), [c1], ["33203"]);
    expect(l.main).toBe("約 30 km 先で発生しました");
    expect(l.details[0]).toBe(TEXT.frequent);
  });

  it("④ 全国の動きをお知らせしています。riskAnywhere を添える（『何もない』と読ませない）", () => {
    const l = levelLine(result({ level: 4, reasons: [] }), []);
    expect(l.tone).toBe("lv4");
    expect(l.main).toBe("全国の動きをお知らせしています");
    expect(l.details).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("搬出制限の解除済みでも色は lv1 のまま。『搬出制限は解除されました』を添える", () => {
    const l = levelLine(result({ level: 1, reasons: [reason("c1", 1, "within_radius")], shipmentLifted: true }), [c1]);
    expect(l.tone).toBe("lv1");
    expect(l.main).toBe("区域に入っている可能性があります。県の連絡を確かめてください");
    expect(l.details).toContain("搬出制限は解除されました");
  });

  it("搬出制限が解除されていなければ、解除と書かない", () => {
    const l = levelLine(result({ level: 1, reasons: [reason("c1", 1, "within_radius")] }), [c1]);
    expect(textOf(l)).not.toContain("搬出制限は解除");
  });

  it("監視強化区域の説明は SURVEILLANCE_NOTE。色は変えない", () => {
    const a = levelLine(result({ level: 1, reasons: [reason("c1", 1, "within_radius")] }), [c1]);
    const b = levelLine(result({ level: 1, reasons: [reason("c1", 1, "within_radius")], inSurveillanceNote: true }), [c1]);
    expect(b.details).toContain(SURVEILLANCE_NOTE);
    expect(a.details).not.toContain(SURVEILLANCE_NOTE);
    expect(b.tone).toBe(a.tone);
    expect(SURVEILLANCE_NOTE).toBe("監視強化区域は、制限が解除された後も監視を続ける区域です。段階には数えません。県の発表を確かめてください");
  });

  it("事例が多いときは 5 件までで、残りは件数にする", () => {
    const cases = Array.from({ length: 8 }, (_, i) => mkCase({ id: `m${i}`, stages: { confirmed: { date: `2026-12-${10 + i}`, time: null } } }));
    const l = levelLine(result({ level: 1, reasons: cases.map((c) => reason(c.id, 1, "within_radius")) }), cases);
    expect(l.details.filter((d) => d.startsWith("津山市で確定"))).toHaveLength(5);
    expect(l.details).toContain("ほか 3 件");
  });

  it("全段階で禁じた語がない", () => {
    for (const r of [
      result({ level: 1, reasons: [reason("c1", 1, "within_radius")], shipmentLifted: true, inSurveillanceNote: true }),
      result({ level: 2, reasons: [reason("c1", 2, "adjacent")] }),
      result({ level: 2, reasons: [reason("c1", 2, "same_muni")] }),
      result({ level: 3, reasons: [reason("c1", 3, "frequent")] }),
      result({ level: 3, reasons: [band("c1", 45)] }),
      result({ level: 4, reasons: [] }),
    ]) {
      expect(findForbiddenPhrases(textOf(levelLine(r, [c1])))).toEqual([]);
    }
  });
});

function area(o: Partial<AreaStatus> & Pick<AreaStatus, "level">): AreaStatus {
  return {
    muniCode: "33214",
    muniName: "真庭市",
    prefCode: "33",
    asOf: ASOF,
    sameMuniCases: [],
    adjacentCases: [],
    wildBirds: [],
    sourceUrls: [],
    ...o,
  };
}

describe("areaLine（/area と町だけを選んだとき。距離を見ない）", () => {
  const tsuyama = mkCase({ id: "c1" });

  it("level 1: 同じ町の発生。『区域に入っている』と断定しない。色は lv1", () => {
    const l = areaLine(area({ level: 1, muniCode: "33203", muniName: "津山市", sameMuniCases: [tsuyama] }));
    expect(l.tone).toBe("lv1");
    expect(l.main).toBe(TEXT.areaSame);
    expect(l.main).not.toMatch(/区域に入っている/);
    expect(l.details).toContain("津山市で確定（12 月 20 日）");
  });

  it("level 2 隣町: 『隣町で発生しました』", () => {
    const l = areaLine(area({ level: 2, adjacentCases: [tsuyama] }));
    expect(l).toMatchObject({ tone: "lv2", main: "隣町で発生しました" });
  });

  it("level 2 で sameMuniCases がある（移動制限の解除の後の同じ町）は sameMuniLifted で、隣町と書かない", () => {
    const lifted1 = mkCase({ id: "c1", stages: { confirmed: { date: "2026-12-20", time: null }, movement_lifted: lifted("2027-01-20") } });
    const l = areaLine(area({ level: 2, muniCode: "33203", sameMuniCases: [lifted1], adjacentCases: [mkCase({ id: "c9", muniCode: "33214", muniName: "真庭市" })] }));
    expect(l.main).toBe(FIXED_TEXT.sameMuniLifted);
    expect(textOf(l)).not.toMatch(/隣町/);
  });

  it("level 4: 全国の動きをお知らせしています", () => {
    expect(areaLine(area({ level: 4 }))).toMatchObject({ tone: "lv4", main: "全国の動きをお知らせしています" });
  });

  it("level 1、2、4 のすべてで areaNoDistance と riskAnywhere を出す（契約 8）", () => {
    for (const a of [
      area({ level: 1, sameMuniCases: [tsuyama] }),
      area({ level: 2, adjacentCases: [tsuyama] }),
      area({ level: 2, sameMuniCases: [mkCase({ id: "c1", stages: { confirmed: { date: "2026-12-20", time: null }, movement_lifted: lifted("2027-01-20") } })] }),
      area({ level: 4 }),
    ]) {
      const l = areaLine(a);
      expect(l.details, `level ${a.level}`).toContain(FIXED_TEXT.areaNoDistance);
      expect(l.details, `level ${a.level}`).toContain(FIXED_TEXT.riskAnywhere);
      expect(findForbiddenPhrases(textOf(l))).toEqual([]);
    }
  });

  it("搬出制限の解除と監視強化の説明を、同じ町の level 1 でも出す。色は lv1 のまま", () => {
    const shipped = mkCase({ id: "c1", stages: { confirmed: { date: "2026-12-20", time: null }, shipment_lifted: lifted("2027-01-05") } });
    const l = areaLine(area({ level: 1, sameMuniCases: [shipped] }));
    expect(l.tone).toBe("lv1");
    expect(l.details).toContain("搬出制限は解除されました");
    expect(l.details).toContain(SURVEILLANCE_NOTE);
  });

  it("野鳥があれば、検査中と確定を分けて行にする。色は変えない", () => {
    const bird = (o: Partial<WildBird>): WildBird => ({
      id: "b1",
      season: SEASON,
      date: "2026-12-05",
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      species: null,
      test: "screening_positive",
      focusZone: { from: null, to: null },
      sourceUrl: "https://example.invalid/b",
      ...o,
    });
    const l = areaLine(area({ level: 4, wildBirds: [bird({}), bird({ id: "b2", test: "hpai_confirmed", date: "2026-12-06" })] }));
    expect(l.tone).toBe("lv4");
    expect(l.details).toContain("津山市で野鳥の検査中（12 月 5 日）");
    expect(l.details).toContain("津山市で野鳥の高病原性の確定（12 月 6 日）");
  });
});

// ── resolveTownLine: 実データの形（県の形は fs から読む。県を読む前の geometry は GeoNotLoadedError） ──
function realGeo(): { geo: GeoStore; loaded: string[] } {
  const loaded: string[] = [];
  const geo = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => {
      loaded.push(p);
      return JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown;
    },
  });
  return { geo, loaded };
}

describe("resolveTownLine", () => {
  const tsuyamaCenter = (indexJson as unknown as Record<string, { center: [number, number] }>)["33203"]!.center;
  const spot: FarmPoint = { meshCode: latLngToMesh3(tsuyamaCenter[1], tsuyamaCenter[0]), muniCode: "33203", frequentMuniCodes: [] };
  const tottori = mkCase({ id: "t1", prefCode: "31", muniCode: "31201", muniName: "鳥取市" });
  const base = { birds: [] as WildBird[], season: SEASON, asOf: ASOF };

  it("津山市の center のメッシュと鳥取市の事例（県をまたぐ）。冷えた状態でも投げず、県を読んでから距離を見る", async () => {
    const { geo, loaded } = realGeo();
    expect(() => geo.geometry("31201")).toThrow(GeoNotLoadedError); // 前提: 読む前は投げる偽の GeoStore と同じ
    const line = await resolveTownLine({ ...base, spot, town: null, cases: [tottori], geo });
    expect(loaded).toContain("31");
    expect(["lv1", "lv2"]).toContain(line.tone); // 隣り合う県の市町村なので、少なくとも②
    expect(findForbiddenPhrases(textOf(line))).toEqual([]);
  });

  it("spot の結果は computeLevel と同じ（県を読んだ後）", async () => {
    const { geo } = realGeo();
    const line = await resolveTownLine({ ...base, spot, town: null, cases: [tottori], geo });
    const expected = levelLine(computeLevel(spot, [tottori], SEASON, geo), [tottori]);
    expect(line).toEqual(expected);
  });

  it("spot がなければ town で computeAreaStatus。真庭市の隣の津山市の事例は『隣町で発生しました』", async () => {
    const { geo } = realGeo();
    const cases = [mkCase({ id: "c1" })];
    const line = await resolveTownLine({ ...base, spot: null, town: "33214", cases, geo });
    expect(line).toEqual(areaLine(computeAreaStatus({ muniCode: "33214", cases, wildBirds: [], geo, asOf: ASOF, season: SEASON })));
    expect(line.main).toBe("隣町で発生しました");
  });

  it("spot も town もなければ『町を選んでください』（色なし）", async () => {
    const { geo } = realGeo();
    const line = await resolveTownLine({ ...base, spot: null, town: null, cases: [], geo });
    expect(line).toEqual({ tone: "none", main: "町を選んでください", details: [] });
  });

  it("知らない町のコードは RangeError にせず、選び直しを促す（色なし）", async () => {
    const { geo } = realGeo();
    const line = await resolveTownLine({ ...base, spot: null, town: "99999", cases: [], geo });
    expect(line.tone).toBe("none");
    expect(line.main).toBe(TEXT.unknownTown);
  });

  it("索引にない市町村コードの地点は、④にせず『読めませんでした』の趣旨（色なし）。県を読みにも行かない", async () => {
    const { geo, loaded } = realGeo();
    const lost: FarmPoint = { meshCode: spot.meshCode, muniCode: "99999", frequentMuniCodes: [] };
    const line = await resolveTownLine({ ...base, spot: lost, town: null, cases: [tottori], geo });
    expect(line).toEqual({ tone: "none", main: TEXT.unknownTown, details: [] });
    expect(loaded).toEqual([]);
  });

  it("今季でない事例では計算しない（常に今季の事例だけ）", async () => {
    const { geo } = realGeo();
    const old = mkCase({ id: "old", season: 2025 });
    const line = await resolveTownLine({ ...base, spot: null, town: "33214", cases: [old], geo });
    expect(line.tone).toBe("lv4");
  });

  it("県の形を読めないときは投げる（④に倒して『何もない』と見せない）", async () => {
    const geo = createGeoStore({
      index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
      adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
      loadPrefTopo: () => Promise.reject(new Error("net")),
    });
    await expect(resolveTownLine({ ...base, spot, town: null, cases: [tottori], geo })).rejects.toThrow();
  });

  it("resolveTown: 地図に縁を描く町は、事例のある町（自分の町を除く）", async () => {
    const { geo } = realGeo();
    const r = await resolveTown({ ...base, spot: null, town: "33214", cases: [mkCase({ id: "c1" })], geo });
    expect(r.nearMuniCodes).toEqual(["33203"]);
    const s = await resolveTown({ ...base, spot, town: null, cases: [mkCase({ id: "c1" }), mkCase({ id: "c2", muniCode: "33214", muniName: "真庭市" })], geo });
    expect(s.nearMuniCodes).toEqual(["33214"]); // 自分の町（33203）の縁は my-town で描くので入れない
  });

  it("resolveTown: 距離の帯の町には縁を付けない。帯の中でも登録した町には付ける", async () => {
    const { geo } = realGeo();
    const kurashiki = mkCase({ id: "k", muniCode: "33202", muniName: "倉敷市" });
    const s = await resolveTown({ ...base, spot, town: null, cases: [kurashiki], geo });
    expect(s.line.tone).toBe("lv3");
    expect(s.line.main).toMatch(/^約 \d+ km 先で発生しました$/);
    expect(s.nearMuniCodes).toEqual([]);
    const registered = await resolveTown({ ...base, spot: { ...spot, frequentMuniCodes: ["33202"] }, town: null, cases: [kurashiki], geo });
    expect(registered.line.main).toMatch(/^約 \d+ km 先で発生しました$/);
    expect(registered.line.details[0]).toBe(TEXT.frequent);
    expect(registered.nearMuniCodes).toEqual(["33202"]);
  });

  it("野鳥の高病原性の確定が 10km 以内なら行に出る（段階は変えない）", async () => {
    const { geo } = realGeo();
    const bird: WildBird = {
      id: "b1",
      season: SEASON,
      date: "2026-12-06",
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      species: null,
      test: "hpai_confirmed",
      focusZone: { from: null, to: null },
      sourceUrl: "https://example.invalid/b",
    };
    const line = await resolveTownLine({ ...base, birds: [bird], spot, town: null, cases: [], geo });
    expect(line.tone).toBe("lv4");
    expect(line.details).toContain("津山市で野鳥の高病原性の確定（12 月 6 日）");
  });
});

// ── 自分の町の県が未確認（W-06 追加の範囲 1）。④の「全国の動き」だけで済ませない ──
describe("withWatchState（自分の町の県が未確認のとき）", () => {
  const lv4: TownLine = { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.riskAnywhere] };
  const lv1: TownLine = { tone: "lv1", main: TEXT.zone, details: ["津山市で確定（11 月 2 日）"] };

  it("④で県が未確認: main が『この県のホームページを読み込めていません』になり、色は段階ではなくなる。riskAnywhere は残る", () => {
    const l = withWatchState(lv4, "33", ["33"]);
    expect(l.main).toBe(TEXT.prefUnwatched);
    expect(l.main).toBe("この県のホームページを読み込めていません。発生がないとは言えません");
    expect(l.main).not.toContain("見回り");
    expect(l.main).not.toBe(TEXT.national);
    expect(l.tone).toBe("none");
    expect(l.details).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("①②③で県が未確認: 段階の文と色は保ち、先頭の詳細に『この県は確認できていません』を足す", () => {
    const l = withWatchState(lv1, "33", ["33", "13"]);
    expect(l.main).toBe(TEXT.zone);
    expect(l.tone).toBe("lv1");
    expect(l.details).toEqual([TEXT.prefUnwatched, "津山市で確定（11 月 2 日）"]);
  });

  it("県が確認できているときは、そのまま（同じ参照）", () => {
    expect(withWatchState(lv4, "33", ["13"])).toBe(lv4);
    expect(withWatchState(lv4, "33", [])).toBe(lv4);
  });

  it("町が未選択、読めなかったとき（色なし）は足さない。県が分からなくても足さない", () => {
    const none: TownLine = { tone: "none", main: TEXT.noTown, details: [] };
    expect(withWatchState(none, "33", ["33"])).toBe(none);
    expect(withWatchState(lv4, null, ["33"])).toBe(lv4);
  });

  it("禁止語がなく、元の line を書き換えない", () => {
    const before = JSON.stringify(lv1);
    const l = withWatchState(lv1, "33", ["33"]);
    expect(findForbiddenPhrases(textOf(l))).toEqual([]);
    expect(JSON.stringify(lv1)).toBe(before);
  });
});

// ── 隣の県が未確認（W-06 レビュー I-1）。区域は県をまたぐので、④で何も出ないと安全と読める ──
describe("neighborPrefsOf / withWatchState（隣の県）", () => {
  const { geo } = realGeo();
  const lv4: TownLine = { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.riskAnywhere] };
  const lv2: TownLine = { tone: "lv2", main: TEXT.adjacent, details: ["津山市で確定（11 月 2 日）"] };

  it("真庭市（岡山県）は鳥取県と接する。自分の県は含めない", () => {
    expect(neighborPrefsOf("33214", geo)).toEqual(["31"]);
  });

  it("県境に接しない町や、知らない町は空", () => {
    expect(neighborPrefsOf("33202", geo)).not.toContain("33"); // 倉敷市: 自分の県は含めない
    expect(neighborPrefsOf("99999", geo)).toEqual([]);
  });

  it("自分の県は確認できていて、隣の県（鳥取県）だけ未確認: ④は主文を『隣の県（鳥取県）のホームページを読み込めていません』にする", () => {
    const l = withWatchState(lv4, "33", ["31"], ["31"]);
    expect(l.main).toBe("隣の県（鳥取県）のホームページを読み込めていません。発生がないとは言えません");
    expect(l.main).not.toBe(TEXT.national);
    expect(l.tone).toBe("none");
    expect(l.details).toContain(FIXED_TEXT.riskAnywhere);
  });

  it("②でも、詳細の先頭に足す。段階の文と色は保つ", () => {
    const l = withWatchState(lv2, "33", ["31"], ["31"]);
    expect(l.main).toBe(TEXT.adjacent);
    expect(l.tone).toBe("lv2");
    expect(l.details[0]).toContain("隣の県（鳥取県）");
    expect(l.details).toContain("津山市で確定（11 月 2 日）");
  });

  it("自分の県と隣の県の両方が未確認なら、両方を伝える（④の主文は自分の県）", () => {
    const l = withWatchState(lv4, "33", ["33", "31"], ["31"]);
    expect(l.main).toBe(TEXT.prefUnwatched);
    expect(l.details.join("\n")).toContain("隣の県（鳥取県）");
  });

  it("隣の県が複数なら県名を並べる。確認できている隣の県は入れない", () => {
    const l = withWatchState(lv2, "33", ["28", "31"], ["28", "31", "34"]);
    expect(l.details[0]).toContain("兵庫県、鳥取県");
    expect(l.details[0]).not.toContain("広島県");
  });

  it("1 回目に読めなかった時刻があれば「〇月〇日 〇:〇〇 から」を添える（日本時間）。時刻は県ごと", () => {
    const own = withWatchState(lv4, "33", ["33"], [], { "33": "2026-11-07T09:29:19+09:00" });
    expect(own.main).toBe("この県のホームページを、11 月 7 日 9:29 から読み込めていません。発生がないとは言えません");
    const one = withWatchState(lv4, "33", ["28"], ["28"], { "28": "2026-11-07T00:29:19Z" });
    expect(one.main).toBe("隣の県（兵庫県）のホームページを、11 月 7 日 9:29 から読み込めていません。発生がないとは言えません");
    const two = withWatchState(lv2, "33", ["28", "31"], ["28", "31"], { "28": "2026-11-07T09:29:00+09:00", "31": "2026-11-07T06:13:00+09:00" });
    expect(two.details[0]).toBe("隣の県（兵庫県、鳥取県）のホームページを読み込めていません（兵庫県は 11 月 7 日 9:29 から、鳥取県は 11 月 7 日 6:13 から）。発生がないとは言えません");
    const partly = withWatchState(lv2, "33", ["28", "31"], ["28", "31"], { "28": "2026-11-07T09:29:00+09:00" });
    expect(partly.details[0]).toBe("隣の県（兵庫県、鳥取県）のホームページを読み込めていません（兵庫県は 11 月 7 日 9:29 から）。発生がないとは言えません");
    // 確認できている県の時刻は使わない、読めない時刻は付けない
    expect(withWatchState(lv4, "33", ["33"], [], { "33": "not-a-date" }).main).toBe(TEXT.prefUnwatched);
  });

  it("④で時刻つきの文が主文になるときは、スマホの地図の前に出す短い文（時刻なし）と、地図の下に添える時刻の行を持つ", () => {
    const own = withWatchState(lv4, "33", ["33"], [], { "33": "2026-11-04T01:00:00+09:00" });
    expect(own.lead).toEqual({ main: TEXT.prefUnwatched, note: "読み込めなくなったのは 11 月 4 日 1:00 からです" });
    const nb = withWatchState(lv4, "33", ["28"], ["28"], { "28": "2026-11-07T09:29:00+09:00" });
    expect(nb.lead).toEqual({ main: "隣の県（兵庫県）のホームページを読み込めていません。発生がないとは言えません", note: "読み込めなくなったのは 11 月 7 日 9:29 からです" });
    const two = withWatchState(lv4, "33", ["28", "31"], ["28", "31"], { "28": "2026-11-07T09:29:00+09:00", "31": "2026-11-07T06:13:00+09:00" });
    expect(two.lead?.note).toBe("読み込めなくなったのは、兵庫県が 11 月 7 日 9:29 から、鳥取県が 11 月 7 日 6:13 からです");
    // 時刻がなければ、短い文も時刻の行も要らない（主文がそのまま短い）
    expect(withWatchState(lv4, "33", ["33"]).lead).toBeUndefined();
    // ①②③は段階の文が主文で、未確認の文は地図の下の行なので、短い文は要らない
    expect(withWatchState(lv2, "33", ["31"], ["31"], { "31": "2026-11-07T06:13:00+09:00" }).lead).toBeUndefined();
  });

  it("隣の県が確認できていれば、そのまま（同じ参照）。禁止語もない", () => {
    expect(withWatchState(lv4, "33", ["13"], ["31"])).toBe(lv4);
    expect(findForbiddenPhrases(textOf(withWatchState(lv4, "33", ["31"], ["31"])))).toEqual([]);
  });
});
