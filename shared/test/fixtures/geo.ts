// 他の領域の試験が使う偽の GeoStore と図形。距離の計算は本物の distanceToMuniKm を通す。
// makeGeo の geometry() は、ensurePrefs で県を読むまで GeoNotLoadedError を投げる（契約 3.2）。
import type { MeshCode, MuniCode, PrefCode } from "../../src/types";
import { GeoNotLoadedError, type GeoStore, type MuniEntry, type MuniGeometry } from "../../src/geo";
import { mesh3Center } from "../../src/mesh";

type Ring = Array<[number, number]>;
export type FakeGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const EARTH_RADIUS_KM = 6371.0088; // turf と同じ半径
const kmToLatDeg = (km: number): number => (km / EARTH_RADIUS_KM) * (180 / Math.PI);

function box(west: number, south: number, east: number, north: number): GeoJSON.Polygon {
  const ring: Ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return { type: "Polygon", coordinates: [ring] };
}

/** メッシュの中心を内側に含む箱。 */
export function boxAround(mesh: MeshCode, halfDeg = 0.02): GeoJSON.Polygon {
  const { lat, lng } = mesh3Center(mesh);
  return box(lng - halfDeg, lat - halfDeg, lng + halfDeg, lat + halfDeg);
}

/** 南の辺が、メッシュの中心から真北へ km の所にある箱（中心は箱の外）。 */
export function boxNorthOf(mesh: MeshCode, km: number, halfDeg = 0.02, heightDeg = 0.05): GeoJSON.Polygon {
  const { lat, lng } = mesh3Center(mesh);
  const south = lat + kmToLatDeg(km);
  return box(lng - halfDeg, south, lng + halfDeg, south + heightDeg);
}

export interface FakeMuni {
  code: MuniCode;
  name?: string;
  prefCode?: PrefCode; // 既定はコードの先頭 2 桁
  geometry?: FakeGeometry; // 省略は名前や隣り合いだけを見る試験（小さな箱を入れる）
  neighbors?: readonly MuniCode[]; // 片側だけ書いてよい。対称にする
}

export interface FakeGeoStore extends GeoStore {
  /** ensurePrefs で読んだ県（試験の確認用）。 */
  readonly loadedPrefs: ReadonlySet<PrefCode>;
}

function outerRings(g: FakeGeometry): Ring[] {
  return (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly) => poly[0] as Ring);
}

function entryOf(m: FakeMuni, prefCode: PrefCode, g: FakeGeometry): MuniEntry {
  const pts = outerRings(g).flat();
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const bbox: MuniEntry["bbox"] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  return {
    code: m.code,
    name: m.name ?? m.code,
    prefCode,
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    bbox,
  };
}

export function makeGeo(munis: readonly FakeMuni[], opts: { preload?: boolean } = {}): FakeGeoStore {
  const index: Record<MuniCode, MuniEntry> = {};
  const geometries = new Map<MuniCode, FakeGeometry>();
  const adjacency: Record<MuniCode, MuniCode[]> = {};
  for (const m of munis) {
    const g = m.geometry ?? box(130, 30, 130.01, 30.01);
    geometries.set(m.code, g);
    index[m.code] = entryOf(m, m.prefCode ?? m.code.slice(0, 2), g);
    adjacency[m.code] ??= [];
  }
  for (const m of munis) {
    for (const n of m.neighbors ?? []) {
      (adjacency[m.code] ??= []).includes(n) || adjacency[m.code]!.push(n);
      (adjacency[n] ??= []).includes(m.code) || adjacency[n]!.push(m.code);
    }
  }
  const loaded = new Set<PrefCode>(opts.preload ? Object.values(index).map((e) => e.prefCode) : []);
  return {
    index,
    adjacency,
    loadedPrefs: loaded,
    async ensurePrefs(prefCodes) {
      for (const p of prefCodes) loaded.add(p);
    },
    geometry(code): MuniGeometry {
      const e = index[code];
      if (!e || !loaded.has(e.prefCode)) throw new GeoNotLoadedError(`県が未読み込みです: ${code}`);
      return { type: "Feature", properties: { c: code }, geometry: geometries.get(code)! };
    },
  };
}

/** 量子化も共有弧もない素朴な TopoJSON（県ごとのファイルの代わり）。 */
export function makeTopo(munis: ReadonlyArray<{ code: MuniCode; name: string; prefCode: PrefCode; geometry: FakeGeometry }>) {
  const arcs: Ring[] = [];
  const geometries = munis.map((m) => {
    const arcOf = (ring: Ring): number[] => {
      arcs.push(ring);
      return [arcs.length - 1];
    };
    const props = { c: m.code, n: m.name, p: m.prefCode };
    return m.geometry.type === "Polygon"
      ? { type: "Polygon", arcs: m.geometry.coordinates.map((r) => arcOf(r as Ring)), properties: props }
      : {
          type: "MultiPolygon",
          arcs: m.geometry.coordinates.map((poly) => poly.map((r) => arcOf(r as Ring))),
          properties: props,
        };
  });
  return { type: "Topology", objects: { muni: { type: "GeometryCollection", geometries } }, arcs };
}
