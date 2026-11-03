// N03 から市町村の形と隣り合いを作る部品（scripts/build-geo.ts が使う）。
import { feature, merge, neighbors } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MuniEntry } from "../../shared/src/geo";
import type { MuniCode, PrefCode } from "../../shared/src/types";
import { DESIGNATED_CITIES } from "./designated-cities";

/** N03 の属性のうち使うもの。N03_001 県、N03_004 市区町村（政令市は市名）、N03_005 政令市の区、N03_007 コード（区のコード）。 */
export interface N03Properties {
  N03_001: string;
  N03_004: string;
  N03_005: string | null;
  N03_007: string | null;
}

/** 区のコードではなく市のコード。政令市の区は DESIGNATED_CITIES で引き、表にない政令市は throw する。 */
export function muniCodeOf(props: N03Properties): MuniCode {
  if (props.N03_005) {
    const code = DESIGNATED_CITIES[props.N03_001 + props.N03_004];
    if (!code) throw new Error(`政令市の表にありません: ${props.N03_001}${props.N03_004}（${props.N03_005}）`);
    return code;
  }
  if (!props.N03_007) throw new Error(`コードがありません: ${props.N03_001}${props.N03_004}`);
  return props.N03_007;
}

/** mapshaper の -each に渡す式。muniCodeOf と同じ規則で c（市町村コード）、n（名前）、p（県）を作る。var で表を持つので出力に残らない。 */
export function eachExpression(): string {
  return `var t=${JSON.stringify(DESIGNATED_CITIES)};c=N03_005?t[N03_001+N03_004]:N03_007;n=N03_004;p=c.slice(0,2);`;
}

type MuniProps = { c: MuniCode; n: string; p: PrefCode };
const MUNI = "muni";

function muniCollection(topo: Topology): GeometryCollection<MuniProps> {
  const obj = topo.objects[MUNI];
  if (!obj || obj.type !== "GeometryCollection") throw new Error("TopoJSON に muni の GeometryCollection がありません");
  return obj as GeometryCollection<MuniProps>;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

type Ring = ReadonlyArray<readonly number[]>;

function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  return Math.abs(s) / 2;
}

function ringBbox(ring: Ring): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring as ReadonlyArray<readonly [number, number]>) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** 最大の面（外側の輪の面積から穴を引いたもの）の bbox の中心 [経度, 緯度]。MuniEntry.center と pref-anchors.json に使う。 */
export function largestPolygonCenter(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let best: Ring | null = null;
  let bestArea = -1;
  for (const rings of polys) {
    const [outer, ...holes] = rings;
    if (!outer) continue;
    const area = ringArea(outer) - holes.reduce((a, h) => a + ringArea(h), 0);
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  if (!best) throw new Error("面のない形です");
  const [w, s, e, n] = ringBbox(best);
  return [round6((w + e) / 2), round6((s + n) / 2)];
}

function bboxOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): MuniEntry["bbox"] {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const boxes = polys.flatMap((rings) => (rings[0] ? [ringBbox(rings[0])] : []));
  return [
    round6(Math.min(...boxes.map((b) => b[0]))),
    round6(Math.min(...boxes.map((b) => b[1]))),
    round6(Math.max(...boxes.map((b) => b[2]))),
    round6(Math.max(...boxes.map((b) => b[3]))),
  ];
}

const sortedRecord = <T>(entries: Array<[string, T]>): Record<string, T> =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** 簡略化の前の全国の形から、辺を共有する市町村の対応表。対称で、隣のない形は空の配列。 */
export function buildAdjacency(topo: Topology): Record<MuniCode, MuniCode[]> {
  const geoms = muniCollection(topo).geometries;
  const nb = neighbors(geoms as never);
  const codeAt = (i: number): MuniCode => {
    const c = (geoms[i]?.properties as MuniProps | undefined)?.c;
    if (!c) throw new Error(`${i} 番目の形にコードがありません`);
    return c;
  };
  const out: Array<[MuniCode, MuniCode[]]> = geoms.map((_, i) => [
    codeAt(i),
    (nb[i] ?? []).map(codeAt).sort(),
  ]);
  if (new Set(out.map(([c]) => c)).size !== out.length) throw new Error("コードが重複しています（-dissolve のあとのはず）");
  return sortedRecord(out);
}

/** 市町村ごとの名前、県、bbox、最大の面の中心。 */
export function buildMuniIndex(topo: Topology): Record<MuniCode, MuniEntry> {
  const fc = feature(topo, muniCollection(topo));
  const out: Array<[MuniCode, MuniEntry]> = fc.features.map((f) => {
    const p = f.properties as MuniProps | null;
    const g = f.geometry;
    if (!p?.c || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) throw new Error("コードか面のない地物があります");
    return [p.c, { code: p.c, name: p.n, prefCode: p.p, center: largestPolygonCenter(g), bbox: bboxOf(g) }];
  });
  if (new Set(out.map(([c]) => c)).size !== out.length) throw new Error("コードが重複しています");
  return sortedRecord(out);
}

/** 県ごとの代表点 [経度, 緯度]。県の市町村を一つに束ね、その最大の面の bbox の中心（本土の島など）。 */
export function buildPrefAnchors(topo: Topology): Record<PrefCode, [number, number]> {
  const byPref = new Map<PrefCode, GeometryCollection<MuniProps>["geometries"]>();
  for (const g of muniCollection(topo).geometries) {
    const p = (g.properties as MuniProps | undefined)?.p;
    if (!p) throw new Error("県のない形があります");
    byPref.set(p, [...(byPref.get(p) ?? []), g]);
  }
  return sortedRecord(
    [...byPref].map(([p, geoms]): [PrefCode, [number, number]] => [
      p,
      largestPolygonCenter(merge(topo, geoms as never) as GeoJSON.MultiPolygon),
    ]),
  );
}
