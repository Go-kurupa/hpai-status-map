import type { Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { measureSimplifyError } from "../lib/simplify-error";

type Pt = [number, number];

/** 座標をそのまま持つ TopoJSON（量子化なし）。面は arcs の添字の並びで、各面は外側の輪 1 つ。 */
function topo(code: string, rings: Pt[][]): Topology {
  return {
    type: "Topology",
    arcs: rings,
    objects: {
      muni: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "MultiPolygon",
            properties: { c: code, n: "試験市", p: code.slice(0, 2) },
            arcs: rings.map((_, i) => [[i]]),
          },
        ],
      },
    },
  } as unknown as Topology;
}

// 北緯 35 度の約 0.9km × 1.1km の四角。下の辺の真ん中の頂点が南へ 0.0002 度（約 22m）出ている。
const BUMPY: Pt[] = [[135, 35], [135.005, 34.9998], [135.01, 35], [135.01, 35.01], [135, 35.01], [135, 35]];
const FLAT: Pt[] = [[135, 35], [135.01, 35], [135.01, 35.01], [135, 35.01], [135, 35]];
// 約 27m × 33m の小さな島。四角から東へ約 3.6km 離れている。簡略化で消える幅。
const ISLET: Pt[] = [[135.05, 35], [135.0503, 35], [135.0503, 35.0003], [135.05, 35.0003], [135.05, 35]];

describe("measureSimplifyError", () => {
  it("頂点を 1 つ潰したずれ（約 22m）を、前→後と後→前の両方で測る", () => {
    const r = measureSimplifyError(topo("99001", [BUMPY]), [topo("99001", [FLAT])]);
    expect(r.maxForwardM).toBeGreaterThan(21);
    expect(r.maxForwardM).toBeLessThan(23);
    expect(r.maxBackwardM).toBeGreaterThan(21);
    expect(r.maxBackwardM).toBeLessThan(23);
    expect(r.maxForwardAt.code).toBe("99001");
    expect(r.parts).toEqual({ before: 1, after: 1, vanished: 0, large: 1 });
    expect(r.over30m).toBe(0);
    expect(r.small.count).toBe(0);
    expect(r.munisLost).toBe(0);
  });

  it("形が同じなら、ずれは 0", () => {
    const r = measureSimplifyError(topo("99001", [FLAT]), [topo("99001", [FLAT])]);
    expect(r.maxForwardM).toBeLessThan(0.01);
    expect(r.maxBackwardM).toBeLessThan(0.01);
  });

  it("消えた小さな島は、大きな面のずれに入れず、残りまでの距離を small に数える", () => {
    const r = measureSimplifyError(topo("99001", [BUMPY, ISLET]), [topo("99001", [FLAT])]);
    expect(r.maxForwardM).toBeLessThan(23); // 島は大きな面の最大に混ぜない
    expect(r.parts).toEqual({ before: 2, after: 1, vanished: 1, large: 1 });
    expect(r.small.count).toBe(1);
    expect(r.small.farFrom100m).toBe(1);
    expect(r.small.farFrom1km).toBe(1);
    expect(r.small.farFrom10km).toBe(0);
    expect(r.small.maxDistanceM).toBeGreaterThan(3000);
    expect(r.small.maxDistanceM).toBeLessThan(4000);
    expect(r.small.maxDistanceAt.code).toBe("99001");
    expect(r.small.munisFarFrom1km).toBe(1);
  });

  it("大きな面が消えると、ずれが大きく出る（数えそこねない）", () => {
    const farSquare: Pt[] = [[135.1, 35], [135.11, 35], [135.11, 35.01], [135.1, 35.01], [135.1, 35]];
    const r = measureSimplifyError(topo("99001", [FLAT, farSquare]), [topo("99001", [FLAT])]);
    expect(r.maxForwardM).toBeGreaterThan(5000);
  });

  it("市町村が丸ごと消えたら munisLost に数える", () => {
    const r = measureSimplifyError(topo("99001", [FLAT]), [topo("99002", [FLAT])]);
    expect(r.munisLost).toBe(1);
  });
});
