// 市町村の形と隣り合い（契約 3.2、§5）。純粋な計算だけで、ファイルも fetch も読まない。
// 県ごとの形は createGeoStore に渡す loadPrefTopo が読む（サーバーは fs、画面は fetch）。
import pointToPolygonDistance from "@turf/point-to-polygon-distance";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { mesh3Center } from "./mesh";
import { normalizeForMatch } from "./text";
import type { MeshCode, MuniCode, PrefCode } from "./types";

export interface MuniEntry {
  code: MuniCode;
  name: string;
  prefCode: PrefCode;
  /** [経度, 緯度]。最大の面の bbox の中心。 */
  center: [number, number];
  /** [西, 南, 東, 北]。 */
  bbox: [number, number, number, number];
}

export type MuniGeometry = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { c: MuniCode }>;

export interface GeoStore {
  index: Readonly<Record<MuniCode, MuniEntry>>;
  adjacency: Readonly<Record<MuniCode, readonly MuniCode[]>>;
  ensurePrefs(prefCodes: readonly PrefCode[]): Promise<void>;
  /** 県を読み込む前は GeoNotLoadedError。 */
  geometry(code: MuniCode): MuniGeometry;
}

export class GeoNotLoadedError extends Error {
  constructor(message = "市町村の形が未読み込みです。先に ensurePrefs を待ってください") {
    super(message);
    this.name = "GeoNotLoadedError";
  }
}

/** 県のファイルの object 名（data/geo/pref/NN.topo.json）。 */
const MUNI_OBJECT = "muni";

function isMuniTopology(x: unknown): x is Topology {
  const t = x as Topology | null;
  const obj = t?.objects?.[MUNI_OBJECT];
  return !!t && t.type === "Topology" && Array.isArray(t.arcs) && !!obj && obj.type === "GeometryCollection";
}

/** TopoJSON（object は muni、properties は {c,n,p}）を、コードごとの形に直す。 */
function decodePref(prefCode: PrefCode, topo: unknown): Map<MuniCode, MuniGeometry> {
  if (!isMuniTopology(topo)) throw new Error(`県 ${prefCode} のファイルが TopoJSON の muni ではありません`);
  const fc = feature(topo, topo.objects[MUNI_OBJECT] as GeometryCollection<{ c: MuniCode }>);
  const out = new Map<MuniCode, MuniGeometry>();
  for (const f of fc.features) {
    const g = f.geometry;
    const c = f.properties?.c;
    if (typeof c !== "string" || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
      throw new Error(`県 ${prefCode} のファイルに、コードか面のない地物があります`);
    }
    out.set(c, { type: "Feature", properties: { c }, geometry: g });
  }
  return out;
}

export function createGeoStore(input: {
  index: GeoStore["index"];
  adjacency: GeoStore["adjacency"];
  loadPrefTopo: (p: PrefCode) => Promise<unknown>;
}): GeoStore {
  const loaded = new Map<PrefCode, Map<MuniCode, MuniGeometry>>();
  const loading = new Map<PrefCode, Promise<void>>(); // 結果でなく Promise を持つ（同時の呼び出しでも 1 度だけ読む）

  function load(prefCode: PrefCode): Promise<void> {
    if (loaded.has(prefCode)) return Promise.resolve();
    let p = loading.get(prefCode);
    if (!p) {
      p = input
        .loadPrefTopo(prefCode)
        .then((topo) => {
          loaded.set(prefCode, decodePref(prefCode, topo));
        })
        .finally(() => loading.delete(prefCode)); // 失敗したら次の呼び出しでやり直せる
      loading.set(prefCode, p);
    }
    return p;
  }

  return {
    index: input.index,
    adjacency: input.adjacency,
    async ensurePrefs(prefCodes) {
      await Promise.all([...new Set(prefCodes)].map(load));
    },
    geometry(code) {
      const prefCode = input.index[code]?.prefCode ?? code.slice(0, 2);
      const pref = loaded.get(prefCode);
      if (!pref) throw new GeoNotLoadedError(`県 ${prefCode} が未読み込みです（${code}）`);
      const g = pref.get(code);
      if (!g) throw new Error(`県 ${prefCode} のファイルに ${code} の形がありません`);
      return g;
    },
  };
}

/** a と b が隣り合う（辺を共有する）。自分とは隣でない。 */
export function isAdjacent(a: MuniCode, b: MuniCode, geo: GeoStore): boolean {
  return a !== b && (geo.adjacency[a]?.includes(b) ?? false);
}

/** メッシュの中心から市町村の形までの距離（km、測地線）。内側は 0。県が未読み込みなら GeoNotLoadedError。 */
export function distanceToMuniKm(mesh: MeshCode, muni: MuniCode, geo: GeoStore): number {
  const { lat, lng } = mesh3Center(mesh);
  const d = pointToPolygonDistance([lng, lat], geo.geometry(muni), { units: "kilometers", method: "geodesic" });
  return d <= 0 ? 0 : d;
}

const nameIndexCache = new WeakMap<object, Map<string, MuniCode[]>>();

function nameIndexOf(geo: GeoStore): Map<string, MuniCode[]> {
  let m = nameIndexCache.get(geo.index);
  if (!m) {
    m = new Map();
    for (const e of Object.values(geo.index)) {
      const key = `${e.prefCode}|${normalizeForMatch(e.name)}`;
      const list = m.get(key);
      if (list) list.push(e.code);
      else m.set(key, [e.code]);
    }
    nameIndexCache.set(geo.index, m);
  }
  return m;
}

/** 県の中で名前が一致する市町村。normalizeForMatch で比べ（ヶ と ケ は同じ）、同名が複数なら null。 */
export function findMuniByName(prefCode: PrefCode, name: string, geo: GeoStore): MuniCode | null {
  const hit = nameIndexOf(geo).get(`${prefCode}|${normalizeForMatch(name)}`);
  return hit && hit.length === 1 ? hit[0]! : null;
}
