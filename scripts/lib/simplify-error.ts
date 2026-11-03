// 簡略化の前と後の形の食い違い（境界のずれ）を測る。scripts/build-geo.ts が build-info.json に書く。
//
// 面（MultiPolygon の部分）を幅で分ける。簡略化は細い面や小さな島（幅がおよそ 60m 未満）を潰して消すので、消えうる面と分けて測る。
//   幅 = 2 * 面積 / 外周（円なら半径、細長い帯なら帯の幅）。幅が 100m 以上の面を「大きな面」、未満を「小さな面」とする。
//   大きな面の前→後  前の面の外側の輪の各頂点から、後の同じ市町村の輪郭までの最短距離の最大。距離の計算では
//          「後の距離 <= 前の距離 + この値」が成り立つので、MESH_MARGIN_KM に効くのはこちら（区域の判定が甘くなる向き）。
//          穴（飛び地や湖）は測らない。穴が潰れて消えると、穴の中の点は後で面の中になり、距離が小さく出る（安全な向き）。
//   後→前  後の輪郭の各点（頂点と、辺の上を約 50m ごとの点）から、前の輪郭までの最短距離の最大。
//   小さな面  数と、後の輪郭までの距離（消えたとき、市町村の残りの部分までの距離 = その面が最も近い部分だった点で距離が大きく出る分）。
// 点と線分の距離は、点を中心にした平面（緯度 1 度 = R*π/180 km、経度は cos(緯度) 倍）で測る。
// 前の形の頂点間は N03 では数十 m 以下なので、頂点だけで前→後の最大を近似できる。
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const R_KM = 6371.0088;
const KM_PER_DEG = (R_KM * Math.PI) / 180;
const CELL_DEG = 0.01;
const SAMPLE_STEP_M = 50;
const BRUTE_AFTER_RINGS = 30;

type Pt = readonly [number, number];
type Ring = readonly Pt[];

interface Grid {
  segs: Float64Array; // x1 y1 x2 y2 を 4 つずつ
  cells: Map<number, number[]>;
}

const cellKey = (cx: number, cy: number): number => cx * 100_003 + cy;

function buildGrid(rings: readonly Ring[]): Grid {
  const flat: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) flat.push(ring[i]![0], ring[i]![1], ring[i + 1]![0], ring[i + 1]![1]);
  }
  const segs = Float64Array.from(flat);
  const cells = new Map<number, number[]>();
  const put = (cx: number, cy: number, s: number): void => {
    const k = cellKey(cx, cy);
    const l = cells.get(k);
    if (l) {
      if (l[l.length - 1] !== s) l.push(s);
    } else cells.set(k, [s]);
  };
  for (let s = 0; s < segs.length / 4; s++) {
    const x1 = segs[4 * s]!, y1 = segs[4 * s + 1]!, x2 = segs[4 * s + 2]!, y2 = segs[4 * s + 3]!;
    const c1x = Math.floor(x1 / CELL_DEG), c1y = Math.floor(y1 / CELL_DEG);
    const c2x = Math.floor(x2 / CELL_DEG), c2y = Math.floor(y2 / CELL_DEG);
    if ((Math.abs(c1x - c2x) + 1) * (Math.abs(c1y - c2y) + 1) <= 16) {
      for (let cx = Math.min(c1x, c2x); cx <= Math.max(c1x, c2x); cx++) {
        for (let cy = Math.min(c1y, c2y); cy <= Math.max(c1y, c2y); cy++) put(cx, cy, s);
      }
    } else {
      // 長い線分は、セルの 1/4 ごとに点を取って、通るセルとその隣に入れる
      const len = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      const n = Math.ceil(len / (CELL_DEG / 4));
      for (let i = 0; i <= n; i++) {
        const cx = Math.floor((x1 + ((x2 - x1) * i) / n) / CELL_DEG);
        const cy = Math.floor((y1 + ((y2 - y1) * i) / n) / CELL_DEG);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) put(cx + dx, cy + dy, s);
      }
    }
  }
  return { segs, cells };
}

/** 点 (px,py) から線分 s までの距離（m）。点を中心にした平面で測る。 */
function distSegM(segs: Float64Array, s: number, px: number, py: number, kx: number): number {
  const ax = (segs[4 * s]! - px) * kx, ay = (segs[4 * s + 1]! - py) * KM_PER_DEG;
  const bx = (segs[4 * s + 2]! - px) * kx, by = (segs[4 * s + 3]! - py) * KM_PER_DEG;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : -(ax * dx + ay * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx, ey = ay + t * dy;
  return Math.sqrt(ex * ex + ey * ey) * 1000;
}

/** 点から格子の線分までの最短距離（m）。 */
function nearestM(grid: Grid, px: number, py: number): number {
  const kx = KM_PER_DEG * Math.cos((py * Math.PI) / 180);
  const cx0 = Math.floor(px / CELL_DEG), cy0 = Math.floor(py / CELL_DEG);
  const cellM = CELL_DEG * Math.min(kx, KM_PER_DEG) * 1000;
  let best = Infinity;
  for (let r = 0; r <= BRUTE_AFTER_RINGS; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const l = grid.cells.get(cellKey(cx0 + dx, cy0 + dy));
        if (!l) continue;
        for (const s of l) {
          const d = distSegM(grid.segs, s, px, py, kx);
          if (d < best) best = d;
        }
      }
    }
    // 次の輪のセルは、点から少なくとも r セル分（の短いほう）離れている
    if (best <= r * cellM) return best;
  }
  if (Number.isFinite(best) && best <= BRUTE_AFTER_RINGS * cellM) return best;
  for (let s = 0; s < grid.segs.length / 4; s++) {
    const d = distSegM(grid.segs, s, px, py, kx);
    if (d < best) best = d;
  }
  return best;
}

type Part = readonly Ring[]; // 外側の輪と穴

function partsOf(geom: { type: string; coordinates: unknown } | null): Part[] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates as Ring[]];
  if (geom.type === "MultiPolygon") return geom.coordinates as Ring[][];
  throw new Error(`Polygon でも MultiPolygon でもありません: ${geom.type}`);
}

interface MuniShape {
  name: string;
  parts: Part[];
}

function shapesOf(topo: Topology): Map<string, MuniShape> {
  const obj = topo.objects.muni as GeometryCollection<{ c: string; n: string }> | undefined;
  if (!obj) throw new Error("TopoJSON に muni がありません");
  const fc = feature(topo, obj);
  const out = new Map<string, MuniShape>();
  for (const f of fc.features) {
    const parts = partsOf(f.geometry as { type: string; coordinates: unknown } | null);
    const p = f.properties as { c: string; n: string };
    const prev = out.get(p.c);
    if (prev) prev.parts.push(...parts);
    else out.set(p.c, { name: p.n, parts: [...parts] });
  }
  return out;
}

/** 外側の輪の幅（m。2 * 面積 / 外周）。 */
function widthM(part: Part): number {
  const ring = part[0] ?? [];
  if (ring.length < 4) return 0;
  let lat = 0;
  for (const [, y] of ring) lat += y;
  lat /= ring.length;
  const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180) * 1000;
  const ky = KM_PER_DEG * 1000;
  const [x0, y0] = ring[0]!;
  let area2 = 0;
  let perimeter = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const ax = (ring[i]![0]! - x0) * kx, ay = (ring[i]![1]! - y0) * ky;
    const bx = (ring[i + 1]![0]! - x0) * kx, by = (ring[i + 1]![1]! - y0) * ky;
    area2 += ax * by - bx * ay;
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  return perimeter === 0 ? 0 : (2 * Math.abs(area2 / 2)) / perimeter;
}

/** 幅がこの値（m）未満の面は「小さな面」。-simplify の interval=30 で潰れる幅（約 60m）より大きく取る。 */
export const SMALL_WIDTH_M = 100;

export interface SimplifyError {
  /** 大きな面（幅 100m 以上）の前→後の最大（m）。MESH_MARGIN_KM の根拠に使う値 */
  maxForwardM: number;
  maxForwardAt: { code: string; name: string; at: [number, number] };
  /** 後→前の最大（m） */
  maxBackwardM: number;
  maxBackwardAt: { code: string; name: string; at: [number, number] };
  /** 大きな面の外側の輪の頂点の数と、そのうち後の輪郭まで 30m を超える点の数 */
  vertices: number;
  over30m: number;
  /** 大きな面の前→後が上位の市町村（降順） */
  worst: Array<{ code: string; name: string; forwardM: number; backwardM: number }>;
  /** 面の数（MultiPolygon の部分）。after は県ごとの形の面の数 */
  parts: { before: number; after: number; vanished: number; large: number };
  /** 簡略化の後に面が 0 になった市町村の数 */
  munisLost: number;
  /** 小さな面（幅 100m 未満）。distance = その面の頂点（間引き）から後の同じ市町村の輪郭までの最短距離。残った面なら約 30m 以下、消えた面なら残りまでの距離 */
  small: {
    count: number;
    /** 後の輪郭まで 100m、1km、10km を超える面の数 */
    farFrom100m: number;
    farFrom1km: number;
    farFrom10km: number;
    /** 最大の距離（m）と、その市町村 */
    maxDistanceM: number;
    maxDistanceAt: { code: string; name: string };
    /** 後の輪郭まで 1km を超える面を持つ市町村の数 */
    munisFarFrom1km: number;
  };
}

/** orig（簡略化の前）と simplified（後。県ごとに分かれていてよい）を市町村ごとに比べる。 */
export function measureSimplifyError(orig: Topology, simplified: readonly Topology[], opts: { worst?: number } = {}): SimplifyError {
  const before = shapesOf(orig);
  const after = new Map<string, MuniShape>();
  for (const t of simplified) for (const [c, s] of shapesOf(t)) after.set(c, s);

  const perMuni: Array<{ code: string; name: string; forwardM: number; backwardM: number; at: [number, number]; bwdAt: [number, number] }> = [];
  let vertices = 0;
  let over30m = 0;
  let partsBefore = 0;
  let partsAfter = 0;
  let large = 0;
  let munisLost = 0;
  const small = {
    count: 0, farFrom100m: 0, farFrom1km: 0, farFrom10km: 0, maxDistanceM: 0, maxDistanceAt: { code: "", name: "" }, munisFarFrom1km: 0,
  };
  for (const [code, a] of before) {
    partsBefore += a.parts.length;
    const b = after.get(code);
    partsAfter += b?.parts.length ?? 0;
    const ringsB = (b?.parts ?? []).flat();
    if (!b || ringsB.length === 0) {
      munisLost += 1;
      continue;
    }
    const gridB = buildGrid(ringsB);
    let fwd = 0;
    let at: [number, number] = [0, 0];
    let farHere = false;
    for (const part of a.parts) {
      const ext = part[0] ?? [];
      if (widthM(part) >= SMALL_WIDTH_M) {
        large += 1;
        for (const [x, y] of ext) {
          vertices += 1;
          const d = nearestM(gridB, x, y);
          if (d > 30) over30m += 1;
          if (d > fwd) {
            fwd = d;
            at = [x, y];
          }
        }
        continue;
      }
      small.count += 1;
      const stride = Math.max(1, Math.floor(ext.length / 200));
      let dmin = Infinity;
      for (let i = 0; i < ext.length; i += stride) dmin = Math.min(dmin, nearestM(gridB, ext[i]![0], ext[i]![1]));
      if (dmin > 100) small.farFrom100m += 1;
      if (dmin > 1000) {
        small.farFrom1km += 1;
        farHere = true;
      }
      if (dmin > 10_000) small.farFrom10km += 1;
      if (dmin > small.maxDistanceM) {
        small.maxDistanceM = dmin;
        small.maxDistanceAt = { code, name: a.name };
      }
    }
    if (farHere) small.munisFarFrom1km += 1;
    // 後→前: 後の輪郭の頂点と、辺の上の約 50m ごとの点を、前の輪郭と比べる
    const gridA = buildGrid(a.parts.flat());
    let bwd = 0;
    let bwdAt: [number, number] = [0, 0];
    const upd = (d: number, x: number, y: number): void => {
      if (d > bwd) {
        bwd = d;
        bwdAt = [x, y];
      }
    };
    for (const ring of ringsB) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i]!;
        upd(nearestM(gridA, x, y), x, y);
        if (i + 1 < ring.length) {
          const [x2, y2] = ring[i + 1]!;
          const kx = KM_PER_DEG * Math.cos((y * Math.PI) / 180);
          const lenM = Math.hypot((x2 - x) * kx, (y2 - y) * KM_PER_DEG) * 1000;
          const n = Math.floor(lenM / SAMPLE_STEP_M);
          for (let j = 1; j <= n; j++) {
            const t = j / (n + 1);
            upd(nearestM(gridA, x + (x2 - x) * t, y + (y2 - y) * t), x + (x2 - x) * t, y + (y2 - y) * t);
          }
        }
      }
    }
    perMuni.push({ code, name: a.name, forwardM: fwd, backwardM: bwd, at, bwdAt });
  }
  const none = { code: "", name: "", forwardM: 0, backwardM: 0, at: [0, 0] as [number, number], bwdAt: [0, 0] as [number, number] };
  const byFwd = [...perMuni].sort((p, q) => q.forwardM - p.forwardM);
  const top = byFwd[0] ?? none;
  const topB = perMuni.reduce((p, q) => (q.backwardM > p.backwardM ? q : p), none);
  return {
    maxForwardM: top.forwardM,
    maxForwardAt: { code: top.code, name: top.name, at: top.at },
    maxBackwardM: topB.backwardM,
    maxBackwardAt: { code: topB.code, name: topB.name, at: topB.bwdAt },
    vertices,
    over30m,
    worst: byFwd.slice(0, opts.worst ?? 10).map((d) => ({ code: d.code, name: d.name, forwardM: d.forwardM, backwardM: d.backwardM })),
    parts: { before: partsBefore, after: partsAfter, vanished: partsBefore - partsAfter, large },
    munisLost,
    small,
  };
}
