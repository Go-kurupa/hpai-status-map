// 段階の校正（F-08、設計書 §5）。過去の事例で、各段階が何回当たるかを数える。
// 地点は農場の位置ではなく、各市町村の center を含むメッシュを仮の地点にする（1 市町村 1 地点）。
import { distanceToMuniKm, isAdjacent, type GeoStore } from "@hpai/shared/geo";
import { pastCasesOf } from "@hpai/shared/history";
import { DISTANCE_BAND_KM, MESH_MARGIN_KM, ZONE_BASE_KM, isCountable, prefsToLoad, relationToCase, zoneRadiusKm } from "@hpai/shared/level";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { Case, FarmPoint, HistoryCase, Level, MuniCode, Season } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";

/** bbox から離れすぎた地点は距離を計算しない枠（度）。緯度 0.6 度は約 66km、経度 0.8 度は北緯 45.6 度でも約 62km で、距離の帯（60km）より広い。 */
export const BBOX_SKIP_LAT_DEG = 0.6;
export const BBOX_SKIP_LNG_DEG = 0.8;
/** 面積の広い発生市町村を並べる件数。 */
export const LARGEST_COUNT = 10;

export interface Stat {
  median: number;
  p90: number;
  max: number;
}
export interface LevelTotals {
  level1: number;
  level2: number;
  level3: number;
  level4: number;
}
export interface SeasonCalibration {
  season: Season;
  caseCount: number;
  /** 地点あたりの、このシーズンの事例のうち①だった回数。 */
  level1: Stat;
  /** 地点あたりの②の回数。 */
  level2: Stat;
  /** 事例あたりの、①に入る市町村（地点）の数。 */
  perCase: Stat;
  totals: LevelTotals;
}
export interface CaseCalibration {
  caseId: string;
  season: Season;
  muniCode: MuniCode | null;
  level1PointCount: number;
}
export interface LargeMuni {
  muniCode: MuniCode;
  name: string;
  prefCode: string;
  diagonalKm: number;
  caseCount: number;
  level1PointCount: number;
}
export interface CalibrationResult {
  pointCount: number;
  caseCount: number;
  seasons: SeasonCalibration[];
  cases: CaseCalibration[];
  totals: LevelTotals;
  largestMunis: LargeMuni[];
}

/** 真ん中の値（偶数個は 2 つの平均）。空は 0。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 最近順位法: sorted[ceil(p × n) − 1]。空は 0。 */
export function nearestRankPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length, Math.max(1, Math.ceil(p * s.length))) - 1]!;
}

function statOf(values: readonly number[]): Stat {
  return { median: median(values), p90: nearestRankPercentile(values, 0.9), max: values.length === 0 ? 0 : Math.max(...values) };
}

/** 各市町村の center のメッシュを仮の地点にする（コード順。よく行く市町村は空）。 */
export function centerPoints(geo: GeoStore): FarmPoint[] {
  return Object.values(geo.index)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((e) => ({ meshCode: latLngToMesh3(e.center[1], e.center[0]), muniCode: e.code, frequentMuniCodes: [] }));
}

/** bbox の南西の角から北東の角までの距離（km、球面）。 */
function diagonalKm(bbox: readonly [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const rad = Math.PI / 180;
  const dLat = (n - s) * rad;
  const dLng = (e - w) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(s * rad) * Math.cos(n * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Group {
  muniCode: MuniCode | null;
  cases: Case[];
  /** 地点ごとの段階（points と同じ並び）。 */
  levels: Level[];
}

/**
 * 呼び出し側が先に await geo.ensurePrefs(prefsToLoad(cases)) を済ませること（calibrateHistory が行う）。
 *
 * 速さの工夫は 2 つ（結果は変えない）:
 * 1. 同じ市町村で、半径と移動制限の解除の有無が同じ事例は relationToCase の結果が同じなので、
 *    （地点、市町村）の組ごとに 1 回だけ計算し、同じ組の事例すべてに当てる。
 * 2. 地点が市町村の bbox から 緯度 0.6 度、経度 0.8 度より離れていれば、距離を計算しない。
 *    ①にも距離の帯にもならないので、②（隣）か③（登録）か④だけを見る。隣り合う市町村は bbox の外でもあるので、隣の判定は省かない。
 */
export function calibrate(cases: readonly Case[], points: readonly FarmPoint[], geo: GeoStore): CalibrationResult {
  const counted = cases.filter(isCountable);

  const groupMap = new Map<string, Group>();
  for (const c of counted) {
    const key = `${c.muniCode}|${zoneRadiusKm(c)}|${c.stages.movement_lifted === undefined}`;
    let g = groupMap.get(key);
    if (!g) groupMap.set(key, (g = { muniCode: c.muniCode, cases: [], levels: [] }));
    g.cases.push(c);
  }
  const groups = [...groupMap.values()];

  for (const g of groups) {
    const rep = g.cases[0]!;
    const entry = g.muniCode === null ? null : geo.index[g.muniCode];
    if (g.muniCode !== null && !entry) throw new RangeError(`知らない市町村コードです: ${g.muniCode}`);
    g.levels = points.map((p) => {
      if (entry && p.muniCode !== g.muniCode) {
        const pe = geo.index[p.muniCode];
        if (!pe) throw new RangeError(`知らない市町村コードです: ${p.muniCode}`);
        const [lng, lat] = pe.center;
        const [w, s, e, n] = entry.bbox;
        const far = lat < s - BBOX_SKIP_LAT_DEG || lat > n + BBOX_SKIP_LAT_DEG || lng < w - BBOX_SKIP_LNG_DEG || lng > e + BBOX_SKIP_LNG_DEG;
        if (far) {
          // 距離は計算しない（①にも帯にもならない）。relationToCase の②③④の順と同じ。
          if (isAdjacent(p.muniCode, g.muniCode!, geo)) return 2;
          if (p.frequentMuniCodes.includes(g.muniCode!)) return 3;
          return 4;
        }
      }
      return relationToCase(p, rep, geo).level;
    });
  }

  const emptyTotals = (): LevelTotals => ({ level1: 0, level2: 0, level3: 0, level4: 0 });
  const add = (t: LevelTotals, level: Level, n: number) => {
    t[`level${level}` as keyof LevelTotals] += n;
  };

  const seasonSet = [...new Set(counted.map((c) => c.season))].sort((a, b) => a - b);
  const seasons: SeasonCalibration[] = seasonSet.map((season) => {
    const l1 = new Array<number>(points.length).fill(0);
    const l2 = new Array<number>(points.length).fill(0);
    const totals = emptyTotals();
    const perCase: number[] = [];
    let caseCount = 0;
    for (const g of groups) {
      const n = g.cases.filter((c) => c.season === season).length;
      if (n === 0) continue;
      caseCount += n;
      const level1Points = g.levels.filter((l) => l === 1).length;
      for (let k = 0; k < n; k++) perCase.push(level1Points);
      g.levels.forEach((level, i) => {
        add(totals, level, n);
        if (level === 1) l1[i]! += n;
        else if (level === 2) l2[i]! += n;
      });
    }
    return { season, caseCount, level1: statOf(l1), level2: statOf(l2), perCase: statOf(perCase), totals };
  });

  const totals = emptyTotals();
  for (const s of seasons) for (const k of Object.keys(totals) as Array<keyof LevelTotals>) totals[k] += s.totals[k];

  const level1CountOf = new Map<string, number>();
  for (const g of groups) {
    const n1 = g.levels.filter((l) => l === 1).length;
    for (const c of g.cases) level1CountOf.set(c.id, n1);
  }
  const caseRows: CaseCalibration[] = counted.map((c) => ({
    caseId: c.id,
    season: c.season,
    muniCode: c.muniCode,
    level1PointCount: level1CountOf.get(c.id)!,
  }));

  const byMuni = new Map<MuniCode, { caseCount: number; level1PointCount: number }>();
  for (const row of caseRows) {
    if (row.muniCode === null) continue;
    const cur = byMuni.get(row.muniCode) ?? { caseCount: 0, level1PointCount: 0 };
    cur.caseCount++;
    cur.level1PointCount = Math.max(cur.level1PointCount, row.level1PointCount);
    byMuni.set(row.muniCode, cur);
  }
  const largestMunis: LargeMuni[] = [...byMuni]
    .map(([muniCode, v]) => {
      const e = geo.index[muniCode]!;
      return { muniCode, name: e.name, prefCode: e.prefCode, diagonalKm: diagonalKm(e.bbox), ...v };
    })
    .sort((a, b) => b.diagonalKm - a.diagonalKm || (a.muniCode < b.muniCode ? -1 : a.muniCode > b.muniCode ? 1 : 0))
    .slice(0, LARGEST_COUNT);

  return { pointCount: points.length, caseCount: counted.length, seasons, cases: caseRows, totals, largestMunis };
}

/** data/history の行から校正する。関連農場（related:true）は数えない。先に必要な県の形を読む。 */
export async function calibrateHistory(rows: readonly HistoryCase[], geo: GeoStore): Promise<CalibrationResult> {
  const cases = pastCasesOf(rows);
  await geo.ensurePrefs(prefsToLoad(cases));
  return calibrate(cases, centerPoints(geo), geo);
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const statCells = (s: Stat): string => `${fmt(s.median)} / ${fmt(s.p90)} / ${s.max}`;
const prefName = (code: string): string => PREFS.find((p) => p.code === code)?.name ?? code;

/** docs/level-calibration.md の中身。地点ごとの順位は出さない。 */
export function renderCalibrationDoc(r: CalibrationResult): string {
  const zone = `${ZONE_BASE_KM}km + ${MESH_MARGIN_KM}km`;
  const lines: string[] = [
    "# 段階の校正",
    "",
    "<!-- scripts/calibrate-levels.ts が data/history/cases.json から作る。手で直さない。 -->",
    "",
    `> ${FIXED_TEXT.pastDisclaimer}`,
    "",
    "面積の広い市町村では①が広く当たるおそれがある。過去 6 シーズンの事例で、各段階が何回当たるかを数えた結果。",
    "",
    "## 数え方",
    "",
    `- 事例は国の資料の ${r.caseCount} 件（関連農場は数えない）。`,
    `- 地点は農場の位置ではなく市町村の中心を含むメッシュで、全国 ${r.pointCount} 市町村に 1 つずつ置いた。実際の農場は市町村の中のどこにでもあるので、これは目安である。`,
    `- ①は、同じ市町村、または市町村の形までの距離が ${zone} 以内。過去の事例は県の発表の半径と移動制限の解除の記録を持たないので、すべて区域が続く扱いで、半径は ${ZONE_BASE_KM}km。`,
    `- ②は隣り合う市町村。③は市町村の形までの距離が ${DISTANCE_BAND_KM}km 以内（誤差を足さない）。よく行く市町村は地点に登録していない。④はどれにも当たらない。`,
    "- 地点あたりの回数は、1 つの地点で、そのシーズンの事例のうち①（②）に当たった件数。",
    "- 中央値は真ん中の値（偶数個は 2 つの平均）。90% は最近順位法（小さい順に並べた n 個の `sorted[ceil(0.9n)-1]`）。最大はその最大値。",
    `- ${ZONE_BASE_KM}km と ${MESH_MARGIN_KM}km は設計書 §5 の決まりで、この結果では変えない。`,
    "",
    "## シーズンごとの回数",
    "",
    "地点あたりの回数（中央値 / 90% / 最大）。",
    "",
    "| シーズン | 事例数 | ①の回数 | ②の回数 | 事例ごとに①に入る市町村の数 |",
    "|---|---|---|---|---|",
    ...r.seasons.map((s) => `| ${s.season} | ${s.caseCount} | ${statCells(s.level1)} | ${statCells(s.level2)} | ${statCells(s.perCase)} |`),
    "",
    "## 段階の合計",
    "",
    `地点 ${r.pointCount} × 事例 ${r.caseCount} = ${r.pointCount * r.caseCount} 組の内訳。`,
    "",
    "| 段階 | 組の数 |",
    "|---|---|",
    `| ① | ${r.totals.level1} |`,
    `| ② | ${r.totals.level2} |`,
    `| ③ | ${r.totals.level3} |`,
    `| ④ | ${r.totals.level4} |`,
    "",
    `## 面積の広い発生市町村（上位 ${LARGEST_COUNT}）`,
    "",
    "発生のあった市町村を、bbox の対角線（南西の角から北東の角まで、km）の長い順に並べた。同じ長さならコードの順。「①に入る市町村の数」は、その市町村の事例のうち最も多い事例の値。",
    "",
    "| 順 | 県 | 市町村 | 対角線（km） | 事例数 | ①に入る市町村の数 |",
    "|---|---|---|---|---|---|",
    ...r.largestMunis.map((m, i) => `| ${i + 1} | ${prefName(m.prefCode)} | ${m.name} | ${m.diagonalKm.toFixed(1)} | ${m.caseCount} | ${m.level1PointCount} |`),
    "",
    "地点ごとの順位は出さない。",
    "",
  ];
  return lines.join("\n");
}
