// 町の形の中に必ず入る点。場所合わせで地図の真ん中（十字）に置く点に使う。
// 町の外枠の四角の中心は、コの字の町や島のある町では町の外に出て、十字が隣の町に乗る（2026-11-06）。
// 点はその場の計算にだけ使い、保存も送信もしない。

type Pos = [number, number];
type Ring = readonly (readonly number[])[];
type Area = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const polygonsOf = (g: Area): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

/** 偶奇則。輪をまたぐ回数が奇数なら中 */
function insideRings(p: Pos, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** 点が形（穴を除く）の中にあるか */
export function insideGeometry(p: Pos, g: Area): boolean {
  return polygonsOf(g).some((rings) => insideRings(p, rings));
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0]! * ring[i]![1]!) - (ring[i]![0]! * ring[j]![1]!);
  return Math.abs(a / 2);
}

/**
 * want が形の中ならそのまま返す。外なら、いちばん大きな面を、その面の高さの真ん中で横に切り、
 * 形の中にある区間のうち、いちばん長い区間の真ん中を返す（必ず形の中）。
 */
export function interiorPoint(g: Area, want: Pos): Pos {
  if (insideGeometry(want, g)) return want;
  const polys = polygonsOf(g);
  const largest = polys.reduce((a, b) => (ringArea(b[0]!) > ringArea(a[0]!) ? b : a));
  const ys = largest[0]!.map((c) => c[1]!);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs: number[] = [];
  for (const ring of largest) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
  }
  xs.sort((a, b) => a - b);
  let best: Pos = want;
  let width = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1]! - xs[k]!;
    if (w > width) {
      width = w;
      best = [(xs[k]! + xs[k + 1]!) / 2, y];
    }
  }
  return best;
}
