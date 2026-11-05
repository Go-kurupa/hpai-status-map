// 段階の校正（F-08）。小さな形で手計算した値と照らす。
import { describe, expect, it } from "vitest";
import { GeoNotLoadedError, type GeoStore, type MuniEntry, type MuniGeometry } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import type { Case, HistoryCase } from "@hpai/shared/types";
import { FIXED_TEXT, findForbiddenPhrases } from "@hpai/shared/wording";
import { historyToCase } from "@hpai/shared/history";
import { DISTANCE_BAND_KM, MESH_MARGIN_KM } from "@hpai/shared/level";
import { BBOX_SKIP_LAT_DEG, BBOX_SKIP_LNG_DEG, calibrate, calibrateHistory, centerPoints, median, nearestRankPercentile, renderCalibrationDoc } from "../lib/calibrate";

interface Rect {
  code: string;
  name: string;
  /** [西, 南, 東, 北] */
  box: [number, number, number, number];
}

/** 長方形の市町村だけの GeoStore。geometry の呼び出しを数え、ensurePrefs の前は GeoNotLoadedError。 */
function fakeGeo(rects: Rect[], adjacency: Record<string, string[]> = {}) {
  const index: Record<string, MuniEntry> = {};
  const geoms = new Map<string, MuniGeometry>();
  for (const r of rects) {
    const [w, s, e, n] = r.box;
    index[r.code] = { code: r.code, name: r.name, prefCode: r.code.slice(0, 2), center: [(w + e) / 2, (s + n) / 2], bbox: r.box };
    geoms.set(r.code, {
      type: "Feature",
      properties: { c: r.code },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    });
  }
  const loaded = new Set<string>();
  const calls: string[] = [];
  const geo: GeoStore = {
    index,
    adjacency,
    async ensurePrefs(prefs) {
      for (const p of prefs) loaded.add(p);
    },
    geometry(code) {
      const pref = code.slice(0, 2);
      if (!loaded.has(pref)) throw new GeoNotLoadedError(`県 ${pref} が未読み込み`);
      calls.push(code);
      return geoms.get(code)!;
    },
  };
  return { geo, calls };
}

// A、B は同じ県で隣り合い、B は東西に長い（A の center から B の面まで約 4.5km、B の center から A の面まで約 13.5km）。
// C は遠く（事例なし）。名前は順位に出ないことを見る。
const A: Rect = { code: "11001", name: "甲町", box: [139.0, 36.0, 139.1, 36.1] };
const B: Rect = { code: "11002", name: "乙市", box: [139.1, 36.0, 139.4, 36.1] };
const C: Rect = { code: "12001", name: "テスト村", box: [140.0, 38.0, 140.1, 38.1] };
const ADJ = { "11001": ["11002"], "11002": ["11001"] };

function mkCase(id: string, season: number, muniCode: string, extra: Partial<Case> = {}): Case {
  return {
    id,
    season,
    nationalNo: 1,
    prefNo: null,
    prefCode: muniCode.slice(0, 2),
    muniCode,
    muniName: null,
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: `${season}-12-01`, time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "national",
    sourceUrls: [],
    updatedAt: `${season}-12-01T00:00:00+09:00`,
    ...extra,
  };
}

const CASES: Case[] = [mkCase("h2020-1", 2020, "11001"), mkCase("h2020-2", 2020, "11001"), mkCase("h2021-1", 2021, "11001"), mkCase("h2021-2", 2021, "11002")];

describe("中央値と 90%", () => {
  it("中央値は真ん中（偶数個は 2 つの平均）", () => {
    expect(median([0, 0, 2])).toBe(0);
    expect(median([1, 2])).toBe(1.5);
    expect(median([])).toBe(0);
  });
  it("90% は最近順位法: sorted[ceil(0.9n)-1]", () => {
    expect(nearestRankPercentile([0, 0, 2], 0.9)).toBe(2);
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(nearestRankPercentile([5], 0.9)).toBe(5);
    expect(nearestRankPercentile([], 0.9)).toBe(0);
  });
});

describe("centerPoints", () => {
  it("各市町村の center のメッシュを地点にし、コード順。よく行く市町村は空", () => {
    const { geo } = fakeGeo([B, A]);
    const pts = centerPoints(geo);
    expect(pts.map((p) => p.muniCode)).toEqual(["11001", "11002"]);
    expect(pts[0]).toEqual({ meshCode: latLngToMesh3(36.05, 139.05), muniCode: "11001", frequentMuniCodes: [] });
  });
});

describe("calibrate（手計算）", () => {
  async function run(cases: Case[] = CASES) {
    const { geo, calls } = fakeGeo([A, B, C], ADJ);
    await geo.ensurePrefs(["11", "12"]);
    const result = calibrate(cases, centerPoints(geo), geo);
    return { result, calls };
  }

  it("地点数と事例数", async () => {
    const { result } = await run();
    expect(result.pointCount).toBe(3);
    expect(result.caseCount).toBe(4);
  });

  it("①②④の合計は 地点数 × 事例数（全体とシーズンごと）", async () => {
    const { result } = await run();
    expect(result.totals).toEqual({ level1: 5, level2: 3, level3: 0, level4: 4 });
    const t = result.totals;
    expect(t.level1 + t.level2 + t.level3 + t.level4).toBe(result.pointCount * result.caseCount);
    for (const s of result.seasons) {
      expect(s.totals.level1 + s.totals.level2 + s.totals.level3 + s.totals.level4).toBe(result.pointCount * s.caseCount);
    }
  });

  it("シーズンごとに、地点あたりの①と②の回数の中央値、90%、最大", async () => {
    const { result } = await run();
    expect(result.seasons.map((s) => s.season)).toEqual([2020, 2021]);
    const s20 = result.seasons[0]!;
    // 2020: 事例は甲町に 2 件。地点 甲=①×2、乙=②×2、テスト村=④。
    expect(s20.caseCount).toBe(2);
    expect(s20.level1).toEqual({ median: 0, p90: 2, max: 2 });
    expect(s20.level2).toEqual({ median: 0, p90: 2, max: 2 });
    const s21 = result.seasons[1]!;
    // 2021: 甲と乙に 1 件ずつ。地点 甲=①×2、乙=①×1+②×1、テスト村=なし。
    expect(s21.level1).toEqual({ median: 1, p90: 2, max: 2 });
    expect(s21.level2).toEqual({ median: 0, p90: 1, max: 1 });
  });

  it("事例ごとに①に入る市町村の数", async () => {
    const { result } = await run();
    expect(Object.fromEntries(result.cases.map((c) => [c.caseId, c.level1PointCount]))).toEqual({
      "h2020-1": 1,
      "h2020-2": 1,
      "h2021-1": 1,
      "h2021-2": 2,
    });
    expect(result.seasons[0]!.perCase).toEqual({ median: 1, p90: 1, max: 1 });
    expect(result.seasons[1]!.perCase).toEqual({ median: 1.5, p90: 2, max: 2 });
  });

  it("面積の広い発生市町村の上位（bbox の対角線の km の順）", async () => {
    const { result } = await run();
    expect(result.largestMunis.map((m) => m.muniCode)).toEqual(["11002", "11001"]);
    const [b, a] = result.largestMunis;
    expect(b!.diagonalKm).toBeGreaterThan(28);
    expect(b!.diagonalKm).toBeLessThan(30.5);
    expect(a!.diagonalKm).toBeLessThan(b!.diagonalKm);
    expect(b).toMatchObject({ name: "乙市", caseCount: 1, level1PointCount: 2 });
    expect(a).toMatchObject({ name: "甲町", caseCount: 3, level1PointCount: 1 });
  });

  it("上位は 10 件まで。対角線が同じなら市町村コードの順", () => {
    const rects: Rect[] = Array.from({ length: 12 }, (_, i) => {
      const lng = 130 + i * 0.5;
      return { code: `13${String(100 + i)}`, name: `町${i}`, box: [lng, 35, lng + 0.1, 35.1] as [number, number, number, number] };
    });
    const { geo } = fakeGeo(rects);
    const cases = rects.map((r, i) => mkCase(`h2020-${i + 1}`, 2020, r.code));
    return geo.ensurePrefs(["13"]).then(() => {
      const result = calibrate(cases, centerPoints(geo), geo);
      expect(result.largestMunis).toHaveLength(10);
      // 経度の差が同じでも緯度が同じなので、対角線は(ほぼ)同じ。並びは対角線の降順 → コード昇順で安定する。
      const diag = result.largestMunis.map((m) => m.diagonalKm);
      expect([...diag].sort((x, y) => y - x)).toEqual(diag);
    });
  });

  it("同じ（地点、市町村）の距離を 2 度計算しない。遠い組は距離を計算しない", async () => {
    const { calls } = await run();
    // 甲町の事例は 3 件だが、乙の地点から甲町までの距離は 1 回。甲の地点から乙市まで 1 回。テスト村の地点はどこも遠い。
    expect([...calls].sort()).toEqual(["11001", "11002"]);
  });

  it("遠くても隣り合う市町村は②にする（bbox で省いても隣は見る）", async () => {
    // 乙が甲の隣と宣言されている。乙の center から甲まで約 13.5km（>10.85）で、bbox の枠（経度 0.4 度）の内側。
    // 枠の外の隣を作る: 経度の幅が 2.0 度の丙（center は甲から 1.0 度離れる）。
    const wide: Rect = { code: "11003", name: "丙市", box: [139.1, 36.0, 141.1, 36.1] };
    const { geo } = fakeGeo([A, wide], { "11001": ["11003"], "11003": ["11001"] });
    await geo.ensurePrefs(["11"]);
    const result = calibrate([mkCase("h2020-1", 2020, "11001")], centerPoints(geo), geo);
    // 丙の center（140.1）は甲の東端 139.1 から 1.0 度 > 0.8 度。枠の外だが隣なので②。
    expect(result.totals).toEqual({ level1: 1, level2: 1, level3: 0, level4: 0 });
  });

  it("省く枠は距離の帯（60km と地点のずれ）を、日本の最も北の緯度でも覆う", () => {
    const kmPerDeg = (6371.0088 * Math.PI) / 180;
    const need = DISTANCE_BAND_KM + MESH_MARGIN_KM;
    expect(BBOX_SKIP_LAT_DEG * kmPerDeg).toBeGreaterThanOrEqual(need);
    expect(BBOX_SKIP_LNG_DEG * kmPerDeg * Math.cos((45.6 * Math.PI) / 180)).toBeGreaterThanOrEqual(need);
  });

  it("隣でなく約 40km 先の地点は、枠で省かず距離の帯の③。約 75km 先は④", async () => {
    // 甲の東端 139.1。丁の center は 139.55（約 40km）、戊の center は 139.95（約 75km）。前の枠（経度 0.4 度）では丁も省かれて④だった。
    const near: Rect = { code: "11004", name: "丁町", box: [139.5, 36.0, 139.6, 36.1] };
    const far: Rect = { code: "11005", name: "戊町", box: [139.9, 36.0, 140.0, 36.1] };
    const { geo } = fakeGeo([A, near, far]);
    await geo.ensurePrefs(["11"]);
    const result = calibrate([mkCase("h2020-1", 2020, "11001")], centerPoints(geo), geo);
    expect(result.totals).toEqual({ level1: 1, level2: 0, level3: 1, level4: 1 });
  });

  it("否定された事例と確認中の事例は数えない（relationToCase と同じ isCountable）", async () => {
    const { result } = await run([...CASES, mkCase("x", 2021, "11001", { negation: "negated" }), mkCase("y", 2021, "11001", { confirmState: "reviewing" })]);
    expect(result.caseCount).toBe(4);
  });

  it("半径や移動制限の解除が違う事例は、まとめずに別に計算する", async () => {
    const lifted = mkCase("z", 2020, "11001", { stages: { confirmed: { date: "2020-12-01", time: null }, movement_lifted: { date: "2020-12-30", time: null } } });
    const { result } = await run([mkCase("h2020-1", 2020, "11001"), lifted]);
    // 解除済みの事例は、乙の地点では①でなく②（隣）。同じ町の甲の地点は解除後でも②（発生した町）。
    const byId = Object.fromEntries(result.cases.map((c) => [c.caseId, c.level1PointCount]));
    expect(byId["h2020-1"]).toBe(1);
    expect(byId["z"]).toBe(0);
  });
});

describe("calibrateHistory（HistoryCase から）", () => {
  const h = (no: number, muniCode: string, related: boolean): HistoryCase => ({
    season: 2020,
    no,
    prefCode: muniCode.slice(0, 2),
    muniCode,
    muniNameThen: "x",
    date: "2020-12-01",
    birdUse: null,
    housing: null,
    headCount: null,
    sourceUrl: "https://www.maff.go.jp/x.pdf",
    related,
  });

  it("県の形を先に読み、related:true の行を数えない", async () => {
    const { geo } = fakeGeo([A, B, C], ADJ); // ensurePrefs の前の geometry は throw する
    const rows = [h(1, "11001", false), h(1, "11002", true), h(2, "11002", false)];
    const withRelated = await calibrateHistory(rows, geo);
    const { geo: geo2 } = fakeGeo([A, B, C], ADJ);
    const without = await calibrateHistory(rows.filter((r) => !r.related), geo2);
    expect(withRelated.caseCount).toBe(2);
    expect(withRelated).toEqual(without);
    expect(withRelated.cases.map((c) => c.caseId)).toEqual(rows.filter((r) => !r.related).map((r) => historyToCase(r).id));
  });
});

describe("renderCalibrationDoc（docs/level-calibration.md）", () => {
  async function doc() {
    const { geo } = fakeGeo([A, B, C], ADJ);
    await geo.ensurePrefs(["11", "12"]);
    return renderCalibrationDoc(calibrate(CASES, centerPoints(geo), geo));
  }

  it("過去の記録の断り書きと、地点の意味（農場の位置ではなく市町村の中心）がある", async () => {
    const text = await doc();
    expect(text).toContain(FIXED_TEXT.pastDisclaimer);
    expect(text).toContain("農場の位置ではなく市町村の中心");
  });

  it("基準（10km と 0.85km）と、中央値と 90% の定義を書く", async () => {
    const text = await doc();
    expect(text).toContain("10km");
    expect(text).toContain("0.85km");
    expect(text).toContain("60km 以内");
    expect(text).not.toContain("地点を置いていないので 0");
    expect(text).toContain("最近順位法");
  });

  it("禁止の語と、危険、ホットスポット、また発生を使わない", async () => {
    const text = await doc();
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(text).not.toMatch(/危険|ホットスポット|また発生/);
  });

  it("地点ごとの順位を出さない（発生のない市町村の名前は出ない）。発生した市町村の上位は出る", async () => {
    const text = await doc();
    expect(text).not.toContain("テスト村");
    expect(text).toContain("乙市");
    expect(text).toContain("甲町");
  });
});
