// WebGL2 が使えない端末（古い端末、管理された端末）の、境の線だけの代わりの地図。
// ブラウザの設定に頼らず、SVG で描く。背景の地理院タイルは出さない（出典は N03 の文だけ）。
// 塗り分けは MapLibre の層と同じ決まり（applyView の viewStyle、seasonView の badgeStates）を使い、ここで決まりを書かない。
// maplibre は読まない（MapView から必要なときだけ動的 import される）。
import type { GeoStore } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { MAP_ATTRIBUTION } from "../../geo/attribution";
import { distanceRingsAt, distanceRingsOf, ringLabel, ringTop, visibleRingKms, type DistanceRings } from "../../geo/distanceRings";
import { FARM_MARK_PX, farmMeshFeature, farmSquareShown, type FarmMarkSize, type FarmMeshFeature } from "../../geo/farmMark";
import { loadJapanTopo, loadPrefAnchors, loadWebGeoStore } from "../../geo/loadGeo";
import { overlayStyle, viewStyle, wildBirdFeatures, type WildBirdFeature } from "./applyView";
import { CMP_TEXT } from "./compareTexts";
import { HATCH_PERIOD, HATCH_PIXEL_RATIO, HATCH_STRIPE } from "./hatch";
import { HATCH_COLORS, overlayLayers, PAINT } from "./mapStyle";
import { BIRD_BOX, BIRD_ICON_PX, BIRD_POINTS, BIRD_R } from "./birdIcon";
import type { MapViewProps } from "./MapView";
import { badgeStates, JAPAN_BOUNDS } from "./seasonView";
import { TEXT } from "./texts";

export interface SvgMapProps
  extends Pick<MapViewProps, "view" | "wildBirds" | "failedPrefCodes" | "myMuniCode" | "nearMuniCodes" | "farmMeshCode" | "markFarm" | "farmMarkSize" | "farmOaza" | "ringCenter" | "focus" | "onSelectMuni" | "onInspectMuni" | "overlay" | "latest" | "pickedMuni"> {
  /** 場所が分からず置けなかった野鳥の数（注記は MapView が出す） */
  onUnplaced?: (n: number) => void;
  /** 形を読めなかった（知らせは MapView が出す） */
  onFailed?: () => void;
}

type Bounds = [number, number, number, number];
type Polys = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Anchors = Record<PrefCode, [number, number]>;

/** viewBox の幅。高さは範囲の縦横比で決まる */
const W = 1000;
const PAD = 12;
/** 斜線の模様の大きさの目安にする、描いたときの幅（CSS の px） */
const REF_WIDTH = 480;
/** これより小さい形には、押せる丸を重ねる（viewBox の単位） */
const SMALL = 30;
const HIT_R = 18;
/** N03 の出典（MAP_ATTRIBUTION の 3 つめ）。地理院タイルは使わないので出さない */
const N03_ATTRIBUTION = MAP_ATTRIBUTION.find((html) => html.includes("N03")) ?? "";
const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

// 線の色と太さ、確定の塗りの濃さは、MapLibre の層の定義（mapStyle の overlayLayers）から読む。数を二重に書かない
const LAYERS = new Map(overlayLayers().map((l) => [l.id, l] as const));
function lineProps(id: "muni-line" | "near-line" | "pref-line" | "my-town" | "distance-rings") {
  const paint = (LAYERS.get(id) as { paint?: Record<string, unknown> } | undefined)?.paint ?? {};
  return {
    stroke: paint["line-color"] as string,
    strokeWidth: paint["line-width"] as number,
    strokeOpacity: (paint["line-opacity"] as number | undefined) ?? 1,
  };
}
const LINE = {
  muni: lineProps("muni-line"),
  near: lineProps("near-line"),
  pref: lineProps("pref-line"),
  mine: lineProps("my-town"),
  ring: lineProps("distance-rings"),
};
/** 輪の点線（画面の px。線は vector-effect で拡大されない）。層の line-dasharray は線の太さが単位 */
const RING_DASH = (((LAYERS.get("distance-rings") as { paint?: Record<string, unknown> } | undefined)?.paint?.["line-dasharray"] as number[] | undefined) ?? [])
  .map((n) => n * LINE.ring.strokeWidth)
  .join(" ");
/** 輪のラベルの文字の大きさ（画面の px）。14px 未満にしない */
const RING_LABEL_PX = 14.4;
/** 南北 1 度の距離（km）。輪のラベルを出す縮尺の目安に使う */
const KM_PER_LAT_DEG = 111.2;
const CONFIRMED_OPACITY =
  ((LAYERS.get("case-confirmed") as { paint?: Record<string, unknown> } | undefined)?.paint?.["fill-opacity"] as number | undefined) ?? 0.8;

interface Projection {
  height: number;
  at(lng: number, lat: number): [number, number];
}

/** 正距円筒（中ほどの緯度で経度を縮める）。日本の範囲ならこれで十分 */
function projection([west, south, east, north]: Bounds): Projection {
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = (W - PAD * 2) / Math.max((east - west) * kx, 1e-6);
  return {
    height: Math.ceil((north - south) * scale + PAD * 2),
    at: (lng, lat) => [PAD + (lng - west) * kx * scale, PAD + (north - lat) * scale],
  };
}

function pathOf(g: Polys, proj: Projection): string {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) {
      let last = "";
      let n = 0;
      for (const [lng, lat] of ring) {
        const [x, y] = proj.at(lng!, lat!);
        const pt = `${x.toFixed(1)},${y.toFixed(1)}`;
        if (pt === last) continue;
        d += (n === 0 ? "M" : "L") + pt;
        last = pt;
        n++;
      }
      if (n > 0) d += "Z";
    }
  }
  return d;
}

function boxOf(g: Polys, proj: Projection): { cx: number; cy: number; size: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const [lng, lat] of poly[0] ?? []) {
      const [x, y] = proj.at(lng!, lat!);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) };
}

interface Shape {
  code: string;
  name: string;
  prefCode: PrefCode;
  d: string;
  box: { cx: number; cy: number; size: number };
}

interface JapanData {
  proj: Projection;
  prefs: Shape[];
  /** 自分の町と隣の町の線に使う、全国の図の市町村の形 */
  muniPath(code: MuniCode): string | null;
}

function buildJapan(topo: Topology): JapanData {
  const [[w, s], [e, n]] = JAPAN_BOUNDS;
  const proj = projection([w, s, e, n]);
  const obj = topo.objects["muni"] as GeometryCollection<{ p?: string; c?: string }>;
  const byPref = new Map<PrefCode, typeof obj.geometries>();
  const byCode = new Map<MuniCode, (typeof obj.geometries)[number]>();
  for (const g of obj.geometries) {
    const prop = (g.properties ?? {}) as { p?: string; c?: string };
    const p = prop.p;
    const c = prop.c;
    if (p) byPref.set(p, [...(byPref.get(p) ?? []), g]);
    if (c) byCode.set(c, g);
  }
  const prefs: Shape[] = [];
  for (const { code, name } of PREFS) {
    const geoms = byPref.get(code);
    if (!geoms) continue;
    const g = merge(topo, geoms as Parameters<typeof merge>[1]) as Polys;
    prefs.push({ code, name, prefCode: code, d: pathOf(g, proj), box: boxOf(g, proj) });
  }
  const cache = new Map<MuniCode, string | null>();
  return {
    proj,
    prefs,
    muniPath(code) {
      if (!cache.has(code)) {
        const g = byCode.get(code);
        const f = g ? (feature(topo, g as Parameters<typeof feature>[1]) as GeoJSON.Feature) : null;
        const geom = f?.geometry;
        cache.set(code, geom && (geom.type === "Polygon" || geom.type === "MultiPolygon") ? pathOf(geom, proj) : null);
      }
      return cache.get(code) ?? null;
    },
  };
}

interface PrefData {
  prefCode: PrefCode;
  proj: Projection;
  munis: Shape[];
}

async function buildPref(store: GeoStore, prefCode: PrefCode): Promise<PrefData> {
  await store.ensurePrefs([prefCode]);
  const entries = Object.values(store.index).filter((m) => m.prefCode === prefCode);
  const bounds: Bounds = [
    Math.min(...entries.map((m) => m.bbox[0])),
    Math.min(...entries.map((m) => m.bbox[1])),
    Math.max(...entries.map((m) => m.bbox[2])),
    Math.max(...entries.map((m) => m.bbox[3])),
  ];
  const proj = projection(bounds);
  const munis = entries.map((m) => {
    const g = store.geometry(m.code).geometry;
    return { code: m.code, name: m.name, prefCode, d: pathOf(g, proj), box: boxOf(g, proj) };
  });
  return { prefCode, proj, munis };
}

function activate(fn: () => void) {
  return {
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    },
  };
}

/** 斜線の模様。hatchImage と同じ周期と太さ。既定は右上がり、"down" は左右反転、"cross" は両方（重ね合わせ。設計書 2026-11-06-data-explore E8） */
// filled は重ね合わせの模様（filledHatchImage と同じ形）。色で塗りつぶし、線を白く抜く（作者 11/6 夜の決定「C」）
function Hatch({ id, color, dir = "up", filled = false }: { id: string; color: string; dir?: "up" | "down" | "cross"; filled?: boolean }) {
  const p = HATCH_PERIOD;
  const s = HATCH_STRIPE;
  const k = W / REF_WIDTH / HATCH_PIXEL_RATIO;
  const line = filled ? "#ffffff" : color;
  const up = (
    <>
      <polygon points={`0,0 ${s},0 0,${s}`} fill={line} />
      <polygon points={`0,${p} ${p},0 ${p},${s} ${s},${p}`} fill={line} />
    </>
  );
  const flipped = <g transform={`matrix(-1 0 0 1 ${p} 0)`}>{up}</g>;
  return (
    <pattern id={id} data-color={color} data-filled={filled ? "true" : undefined} patternUnits="userSpaceOnUse" width={p} height={p} patternTransform={`scale(${k})`}>
      {filled ? <rect width={p} height={p} fill={color} /> : null}
      {dir === "down" ? flipped : up}
      {dir === "cross" ? flipped : null}
    </pattern>
  );
}

/** 重ね合わせの模様の id */
const CMP_HATCH = { "cmp-one": PAINT.hatchCmpOne, "cmp-two": PAINT.hatchCmpTwo, "cmp-both": PAINT.hatchCmpBoth } as const;
const CMP_COLOR = { "cmp-one": PAINT.cmpOne, "cmp-two": PAINT.cmpTwo, "cmp-both": PAINT.cmpBoth } as const;

/**
 * 鶏舎の場所（作者 11/7）。約 1km のマス目を薄い赤で塗って赤い線で囲む。マス目が 14px より小さく見える広さでは、
 * 一定の大きさの赤い四角に替える（MapView と同じ）。「鶏舎の場所」の札を添える。scale は viewBox の 1 単位が画面の何 px か。
 * 印の大きさ（2026-11-07 作者の決定）: 中は約 1km の点線の枠と縦横半分の塗り、小は点線の枠と一定の大きさの四角。札は地区名があれば添える
 */
function FarmMark({ mesh, proj, scale, size, label }: { mesh: FarmMeshFeature; proj: Projection; scale: number; size: FarmMarkSize; label: string }) {
  const unitsPerKm = (proj.at(0, 0)[1] - proj.at(0, 1)[1]) / KM_PER_LAT_DEG;
  const ring = mesh.geometry.coordinates[0]!;
  const [x0, y0] = proj.at(ring[0]![0]!, ring[0]![1]!);
  const [x1, y1] = proj.at(ring[2]![0]!, ring[2]![1]!);
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const half = FARM_MARK_PX / scale / 2;
  const far = farmSquareShown(unitsPerKm * scale);
  const square = (
    <rect className="svg-farm-square" x={cx - half} y={cy - half} width={half * 2} height={half * 2} fill={PAINT.current} fillOpacity={0.6} stroke={PAINT.current} strokeWidth={2} vectorEffect="non-scaling-stroke" />
  );
  const frame = <path className="svg-farm-frame" d={pathOf(mesh.geometry, proj)} fill="none" stroke={PAINT.current} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />;
  let body;
  if (size === "s") body = far ? square : <>{frame}{square}</>;
  else if (far) body = square;
  else if (size === "m") {
    // 中心の縦横半分の四角（farmMarkFeatures の core と同じ形）
    const [[w0, s0], , [e0, n0]] = ring as [number[], number[], number[]];
    const [dx, dy] = [(e0! - w0!) / 4, (n0! - s0!) / 4];
    const [w, sth, e, n] = [w0! + dx, s0! + dy, e0! - dx, n0! - dy];
    const coreGeom: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[w, sth], [e, sth], [e, n], [w, n], [w, sth]]] };
    body = (
      <>
        {frame}
        <path className="svg-farm-core" d={pathOf(coreGeom, proj)} fill={PAINT.current} fillOpacity={0.45} stroke={PAINT.current} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </>
    );
  } else body = <path className="svg-farm-mesh" d={pathOf(mesh.geometry, proj)} fill={PAINT.current} fillOpacity={0.45} stroke={PAINT.current} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
  return (
    <g className="svg-farm" aria-hidden="true">
      {body}
      <text className="svg-farm-label" x={cx + half + 4 / scale} y={cy} fontSize={RING_LABEL_PX / scale}>
        {label}
      </text>
    </g>
  );
}

/** 距離の輪と km のラベル。scale は viewBox の 1 単位が画面の何 px か */
function RingMarks({ rings, proj, scale }: { rings: DistanceRings; proj: Projection; scale: number }) {
  const unitsPerKm = (proj.at(0, 0)[1] - proj.at(0, 1)[1]) / KM_PER_LAT_DEG;
  const shown = new Set(visibleRingKms(unitsPerKm * scale));
  return (
    <>
      {rings.features.map((f) => (
        <path key={f.properties.km} className="svg-ring" data-km={f.properties.km} d={pathOf(f.geometry, proj)} fill="none" {...LINE.ring} strokeDasharray={RING_DASH} />
      ))}
      {rings.features
        .filter((f) => shown.has(f.properties.km))
        .map((f) => {
          const [x, y] = proj.at(...ringTop(f));
          return (
            <text key={f.properties.km} className="svg-ring-label" x={x} y={y} fontSize={RING_LABEL_PX / scale} aria-hidden="true">
              {ringLabel(f.properties.km)}
            </text>
          );
        })}
    </>
  );
}

/** 野鳥の印（作者 11/7 の決定 A）。地図と同じ鳥の形と大きさ（画面の BIRD_ICON_PX）。確定は墨の丸に白い鳥、検査中は白地の丸に墨の縁と鳥 */
function BirdMark({ f, proj, scale }: { f: WildBirdFeature; proj: Projection; scale: number }) {
  const [lng, lat] = f.geometry.coordinates;
  const [x, y] = proj.at(lng, lat);
  const s = BIRD_ICON_PX / scale / BIRD_BOX; // 枠 28 を画面の BIRD_ICON_PX にする
  const confirmed = f.properties.t === "hpai_confirmed";
  return (
    <g data-bird={f.properties.t} transform={`translate(${x - (BIRD_BOX * s) / 2} ${y - (BIRD_BOX * s) / 2}) scale(${s})`}>
      <circle cx={BIRD_BOX / 2} cy={BIRD_BOX / 2} r={BIRD_R + 0.65} fill="#ffffff" />
      <circle cx={BIRD_BOX / 2} cy={BIRD_BOX / 2} r={confirmed ? BIRD_R : BIRD_R - 0.9} fill={confirmed ? PAINT.ink : "#ffffff"} stroke={confirmed ? "none" : PAINT.ink} strokeWidth={1.8} />
      <polygon points={BIRD_POINTS} fill={confirmed ? "#ffffff" : PAINT.ink} />
    </g>
  );
}

export default function SvgMap(props: SvgMapProps) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [store, setStore] = useState<GeoStore | null>(null);
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const [japan, setJapan] = useState<JapanData | null>(null);
  const [prefCode, setPrefCode] = useState<PrefCode | null>(null);
  // 地方の広さ（2 つ以上の県の町）を指定されたときの県。全国の図をこの県の範囲で切り取って出す（作者 11/6 夜）
  const [regionPrefs, setRegionPrefs] = useState<PrefCode[] | null>(null);
  const [pref, setPref] = useState<PrefData | null>(null);
  const [scale, setScale] = useState(REF_WIDTH / W); // viewBox の 1 単位が画面の何 px か（実測できるまでは目安）
  const wrapRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const ringLng = props.ringCenter?.[0];
  const ringLat = props.ringCenter?.[1];
  const rings = useMemo(
    () => (props.farmMeshCode ? distanceRingsOf(props.farmMeshCode) : distanceRingsAt(ringLng !== undefined && ringLat !== undefined ? [ringLng, ringLat] : null)),
    [props.farmMeshCode, ringLng, ringLat],
  );
  const farmMesh = useMemo(() => (props.markFarm ? farmMeshFeature(props.farmMeshCode) : null), [props.markFarm, props.farmMeshCode]);
  const farmLabel = props.farmOaza ? TEXT.farmMarkWith(props.farmOaza) : TEXT.farmMark;

  // 1) 全国の形、索引、県の代表の位置を読む（1 度だけ）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [topo, st, an] = await Promise.all([loadJapanTopo(), loadWebGeoStore(), loadPrefAnchors()]);
        if (cancelled) return;
        setJapan(buildJapan(topo as Topology));
        setStore(st);
        setAnchors(an);
      } catch {
        if (!cancelled) latest.current.onFailed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) 県の段の形
  useEffect(() => {
    if (!store || !prefCode) {
      setPref(null);
      return;
    }
    let cancelled = false;
    setPref(null);
    buildPref(store, prefCode).then(
      (d) => !cancelled && setPref(d),
      () => !cancelled && latest.current.onFailed?.(),
    );
    return () => {
      cancelled = true;
    };
  }, [store, prefCode]);

  // 3) 見る場所の指定（nonce が変わるたびに）。町なら、その町の県の図へ
  const nonce = props.focus?.nonce;
  useEffect(() => {
    const f = latest.current.focus;
    if (!f || !store) return;
    if (f.kind === "japan") {
      setPrefCode(null);
      setRegionPrefs(null);
      return;
    }
    const prefs = [...new Set(f.codes.map((c) => store.index[c]?.prefCode).filter((x): x is PrefCode => !!x))];
    if (prefs.length > 1) {
      // 地方: 県の図にせず、全国の図をその県の範囲で出す（1 つめの県だけの図にしない）
      setPrefCode(null);
      setRegionPrefs(prefs);
    } else if (prefs.length === 1) {
      setPrefCode(prefs[0]!);
      setRegionPrefs(null);
    }
  }, [nonce, store]);

  const style = viewStyle({
    view: props.view,
    failedPrefCodes: props.failedPrefCodes,
    myMuniCode: props.myMuniCode,
    nearMuniCodes: props.nearMuniCodes,
  });
  // 過去シーズンとの重ね合わせ（設計書 2026-11-06-data-explore E8、E14）。あるときは発生の塗りの代わりに 3 つの模様で塗る
  const overlay = props.overlay ?? null;
  // 3 つ以上の比べ（設計書 2026-11-06-data-explore E12）。町ごとの色。重ね合わせと同じく、1 シーズン分の塗りと札は出さない
  const latestColors = useMemo(() => (props.latest ? new Map(props.latest.colors) : null), [props.latest]);
  const latestCounts = useMemo(() => new Map(props.latest?.counts ?? []), [props.latest]);
  const special = overlay !== null || latestColors !== null;
  const cmp = useMemo(() => {
    if (!overlay) return null;
    const st = overlayStyle(overlay);
    return { one: new Set(st.one), two: new Set(st.two), both: new Set(st.both) };
  }, [overlay]);
  const sets = useMemo(
    () => ({
      suspected: new Set(style.suspectedMuniCodes),
      confirmed: new Set(style.confirmedMuniCodes),
      unwatched: new Set(overlay ? overlay.unwatchedPrefCodes : props.latest ? props.latest.unwatchedPrefCodes : style.unwatchedPrefCodes),
      mine: new Set(style.myMuniCodes),
      near: new Set(style.nearMuniCodes),
    }),
    [style.suspectedMuniCodes, style.confirmedMuniCodes, style.unwatchedPrefCodes, style.myMuniCodes, style.nearMuniCodes, overlay, props.latest],
  );

  // 4) 野鳥。場所の決め方は MapView と同じ（町の中心、なければ県の代表の位置）
  const birds = useMemo(() => {
    if (!store || !anchors) return null;
    return wildBirdFeatures(props.wildBirds, (b: WildBird) => {
      const entry = b.muniCode ? store.index[b.muniCode] : undefined;
      return entry ? entry.center : (anchors[b.prefCode] ?? null);
    });
  }, [store, anchors, props.wildBirds]);
  const unplaced = birds?.unplaced;
  useEffect(() => {
    if (unplaced !== undefined) latest.current.onUnplaced?.(unplaced);
  }, [unplaced]);

  // 輪のラベル、鶏舎の印、野鳥の印の大きさは画面の px で決める。図の縮尺は幅と、図の切り替えで変わる
  const shownSvg = prefCode === null ? (japan ? "japan" : null) : pref ? prefCode : null;
  useEffect(() => {
    if (shownSvg === null) return;
    const measure = () => {
      const k = wrapRef.current?.querySelector<SVGSVGElement>("svg.svg-map")?.getScreenCTM?.()?.a;
      if (k) setScale(k);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [shownSvg]);

  const hatchId = (id: string) => `${uid}-${id}`;
  const defs = (
    <defs>
      {HATCH_COLORS.map(([id, color]) => (
        <Hatch key={id} id={hatchId(id)} color={color} />
      ))}
      <Hatch id={hatchId(PAINT.hatchCmpOne)} color={PAINT.cmpOne} filled />
      <Hatch id={hatchId(PAINT.hatchCmpTwo)} color={PAINT.cmpTwo} dir="down" filled />
      <Hatch id={hatchId(PAINT.hatchCmpBoth)} color={PAINT.cmpBoth} dir="cross" filled />
    </defs>
  );
  // 確認できていない県。重ね合わせの間は斜線が「比べる 1」と同じ向きになるので、薄い灰色の塗りにする（E14）
  const unwatchedFill = (key: string, d: string) =>
    special ? (
      <path key={key} d={d} fill={PAINT.muted} fillOpacity={0.25} data-unwatched-flat="true" />
    ) : (
      <path key={key} d={d} fill={`url(#${hatchId(PAINT.hatchMuted)})`} />
    );
  // 町を押したとき: 場所を選んでいる間は選ぶ、それ以外はその町の事例を見る。「さわっても選べます」の案内は選ぶときだけ
  const select = props.onSelectMuni ?? props.onInspectMuni;
  const picking = props.onSelectMuni !== undefined;

  let body: React.ReactNode;
  if (!japan || !store) {
    body = <p role="status">{TEXT.svgLoading}</p>;
  } else if (prefCode === null) {
    // 重ね合わせの間は 1 シーズン分の数の札を出さない（E13）
    const badges = new Map(special ? [] : badgeStates(props.view, 0).map((b) => [b.prefCode, b.text]));
    const anchorOf = (s: Shape) => (anchors?.[s.code] ? japan.proj.at(...anchors[s.code]!) : [s.box.cx, s.box.cy]);
    const labelOf = (s: Shape) => {
      const t = badges.get(s.code);
      const parts = [s.name];
      if (t !== undefined) parts.push(/^\d+$/.test(t) ? `${t} 件` : t);
      if (sets.unwatched.has(s.code)) parts.push(TEXT.svgUnwatched);
      return `${parts.join("、")}。押すと市町村の図になります`;
    };
    const lines = (codes: Set<MuniCode>) => [...codes].map((c) => japan.muniPath(c)).filter((d): d is string => !!d);
    // 地方の広さなら、その県の外枠をつないだ範囲に切り取る（少し余白を足す）
    const regionShapes = regionPrefs ? japan.prefs.filter((s) => regionPrefs.includes(s.code)) : [];
    const japanViewBox = (() => {
      if (regionShapes.length === 0) return `0 0 ${W} ${japan.proj.height}`;
      const x0 = Math.min(...regionShapes.map((s) => s.box.cx - s.box.size / 2));
      const y0 = Math.min(...regionShapes.map((s) => s.box.cy - s.box.size / 2));
      const x1 = Math.max(...regionShapes.map((s) => s.box.cx + s.box.size / 2));
      const y1 = Math.max(...regionShapes.map((s) => s.box.cy + s.box.size / 2));
      const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
      return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
    })();
    // 重ね合わせの間は、全国の図にも町の模様と縁を描く（県を押さなくても見える。作者 11/6 夜）
    const cmpCodes: Array<[MuniCode, keyof typeof CMP_HATCH]> = cmp
      ? [...[...cmp.one].map((c): [MuniCode, keyof typeof CMP_HATCH] => [c, "cmp-one"]), ...[...cmp.two].map((c): [MuniCode, keyof typeof CMP_HATCH] => [c, "cmp-two"]), ...[...cmp.both].map((c): [MuniCode, keyof typeof CMP_HATCH] => [c, "cmp-both"])]
      : [];
    body = (
      <>
        <p className="map-note">{TEXT.svgPrefHint}</p>
        <svg className="svg-map" viewBox={japanViewBox} role="group" aria-label={TEXT.svgMapAria}>
          {defs}
          {japan.prefs.map((s) => (
            <path
              key={s.code}
              className="svg-area is-pressable"
              fill="#ffffff"
              d={s.d}
              data-pref={s.code}
              data-unwatched={String(sets.unwatched.has(s.code))}
              role="button"
              tabIndex={0}
              aria-label={labelOf(s)}
              {...activate(() => setPrefCode(s.code))}
            />
          ))}
          <g pointerEvents="none">
            {japan.prefs
              .filter((s) => sets.unwatched.has(s.code))
              .map((s) => unwatchedFill(s.code, s.d))}
            {latestColors
              ? [...latestColors].map(([c, color]) => {
                  const d = japan.muniPath(c);
                  return d ? <path key={c} d={d} data-code={c} data-fill="latest" fill={color} fillOpacity={0.85} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null;
                })
              : null}
            {cmpCodes.map(([c, f]) => {
              const d = japan.muniPath(c);
              return d ? <path key={c} d={d} data-code={c} data-fill={f} fill={`url(#${hatchId(CMP_HATCH[f])})`} stroke={CMP_COLOR[f]} strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null;
            })}
            {japan.prefs.map((s) => (
              <path key={s.code} className="svg-pref-line" d={s.d} fill="none" {...LINE.pref} />
            ))}
            {lines(sets.near).map((d, i) => (
              <path key={i} className="svg-near-line" d={d} fill="none" {...LINE.near} />
            ))}
            {lines(sets.mine).map((d, i) => (
              <path key={i} className="svg-mine-line" d={d} fill="none" {...LINE.mine} />
            ))}
            {rings ? <RingMarks rings={rings} proj={japan.proj} scale={scale} /> : null}
            {farmMesh ? <FarmMark mesh={farmMesh} proj={japan.proj} scale={scale} size={props.farmMarkSize ?? "l"} label={farmLabel} /> : null}
            {style.showWildBirds ? birds?.features.map((f) => <BirdMark key={f.properties.id} f={f} proj={japan.proj} scale={scale} />) : null}
            {japan.prefs
              .filter((s) => badges.has(s.code))
              .map((s) => {
                const [x, y] = anchorOf(s);
                return (
                  <text key={s.code} className={`svg-badge${props.view.isCurrent ? "" : " is-past"}`} x={x} y={y} aria-hidden="true">
                    {badges.get(s.code)}
                  </text>
                );
              })}
          </g>
          {japan.prefs
            .filter((s) => s.box.size < SMALL)
            .map((s) => (
              <circle key={s.code} className="svg-hit" fill="transparent" cx={s.box.cx} cy={s.box.cy} r={HIT_R} aria-hidden="true" onClick={() => setPrefCode(s.code)} />
            ))}
        </svg>
        <details className="svg-list">
          <summary>{TEXT.svgPrefList}</summary>
          <div role="group" aria-label={TEXT.svgPrefList}>
            {japan.prefs.map((s) => (
              <button key={s.code} type="button" className="btn" onClick={() => setPrefCode(s.code)}>
                {s.name}
              </button>
            ))}
          </div>
        </details>
      </>
    );
  } else {
    const prefName = PREF_NAME.get(prefCode) ?? prefCode;
    const unwatched = sets.unwatched.has(prefCode);
    const fillOf = (c: MuniCode) =>
      latestColors ? (latestColors.has(c) ? "latest" : null) : cmp ? (cmp.one.has(c) ? "cmp-one" : cmp.two.has(c) ? "cmp-two" : cmp.both.has(c) ? "cmp-both" : null) : sets.confirmed.has(c) ? "confirmed" : sets.suspected.has(c) ? "suspected" : null;
    const labelOf = (s: Shape) => {
      const parts = [s.name];
      const f = fillOf(s.code);
      if (f) parts.push(f === "confirmed" ? TEXT.svgConfirmed : f === "suspected" ? TEXT.svgSuspected : f === "cmp-one" ? CMP_TEXT.svgOne : f === "cmp-two" ? CMP_TEXT.svgTwo : f === "latest" ? CMP_TEXT.svgLatest : CMP_TEXT.svgBoth);
      if (sets.mine.has(s.code)) parts.push(TEXT.myTown);
      if (sets.near.has(s.code)) parts.push(TEXT.svgNear);
      if (unwatched) parts.push(TEXT.svgUnwatched);
      return parts.join("、") + (picking ? "。押すとこの町を選択地域にします" : select ? "。押すとこの町の発生を見ます" : "");
    };
    const munis = pref?.munis ?? [];
    body = (
      <>
        <button type="button" className="btn svg-back" onClick={() => setPrefCode(null)}>
          {TEXT.svgBack}
        </button>
        {!pref ? (
          <p role="status">{TEXT.svgLoading}</p>
        ) : (
          <>
            {picking ? <p className="map-note">{TEXT.mapTapHint}</p> : null}
            <svg className="svg-map" viewBox={`0 0 ${W} ${pref.proj.height}`} role="group" aria-label={`発生状況の地図（${prefName}の市町村）`}>
              {defs}
              {munis.map((s) => (
                <path
                  key={s.code}
                  className={`svg-area${select ? " is-pressable" : ""}`}
                  fill="#ffffff"
                  d={s.d}
                  data-code={s.code}
                  data-mine={String(sets.mine.has(s.code))}
                  data-near={String(sets.near.has(s.code))}
                  role={select ? "button" : "img"}
                  tabIndex={select ? 0 : undefined}
                  aria-label={labelOf(s)}
                  {...(select ? activate(() => select(s.code)) : {})}
                />
              ))}
              <g pointerEvents="none">
                {unwatched ? munis.map((s) => unwatchedFill(s.code, s.d)) : null}
                {latestColors
                  ? munis
                      .filter((s) => latestColors.has(s.code))
                      .map((s) => {
                        const color = latestColors.get(s.code)!;
                        return <path key={s.code} d={s.d} data-code={s.code} data-fill="latest" fill={color} fillOpacity={0.85} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
                      })
                  : null}
                {cmp
                  ? munis
                      .filter((s) => fillOf(s.code) !== null)
                      .map((s) => {
                        const f = fillOf(s.code) as keyof typeof CMP_HATCH;
                        // 町の縁は塗りと同じ色（地図の cmp-*-line と同じ）
                        return <path key={s.code} d={s.d} data-code={s.code} data-fill={f} fill={`url(#${hatchId(CMP_HATCH[f])})`} stroke={CMP_COLOR[f]} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                      })
                  : null}
                {munis
                  .filter((s) => fillOf(s.code) === "suspected")
                  .map((s) => (
                    <path key={s.code} d={s.d} data-code={s.code} data-fill="suspected" fill={`url(#${hatchId(style.suspectedHatch)})`} />
                  ))}
                {munis
                  .filter((s) => fillOf(s.code) === "confirmed")
                  .map((s) => (
                    <path key={s.code} d={s.d} data-code={s.code} data-fill="confirmed" fill={style.confirmedColor} fillOpacity={CONFIRMED_OPACITY} />
                  ))}
                {munis.map((s) => (
                  <path key={s.code} className="svg-muni-line" d={s.d} fill="none" {...LINE.muni} />
                ))}
                {/* 押した町を赤い線で囲む（作者 11/7） */}
                {props.pickedMuni
                  ? munis
                      .filter((s) => s.code === props.pickedMuni)
                      .map((s) => <path key={`p-${s.code}`} d={s.d} data-picked={s.code} fill="none" stroke={PAINT.current} strokeWidth={4} vectorEffect="non-scaling-stroke" />)
                  : null}
                {/* 選んだシーズン全体で 2 回以上発生した町は、「計◯回」を真ん中に書く（作者 11/7） */}
                {munis
                  .filter((s) => latestCounts.has(s.code))
                  .map((s) => (
                    <text key={`n-${s.code}`} className="svg-cmp-count" data-count-code={s.code} x={s.box.cx} y={s.box.cy} aria-hidden="true">
                      {CMP_TEXT.countBadge(latestCounts.get(s.code)!)}
                    </text>
                  ))}
                {munis
                  .filter((s) => sets.near.has(s.code))
                  .map((s) => (
                    <path key={s.code} className="svg-near-line" d={s.d} fill="none" {...LINE.near} />
                  ))}
                {munis
                  .filter((s) => sets.mine.has(s.code))
                  .map((s) => (
                    <path key={s.code} className="svg-mine-line" d={s.d} fill="none" {...LINE.mine} />
                  ))}
                {rings ? <RingMarks rings={rings} proj={pref.proj} scale={scale} /> : null}
                {farmMesh ? <FarmMark mesh={farmMesh} proj={pref.proj} scale={scale} size={props.farmMarkSize ?? "l"} label={farmLabel} /> : null}
                {style.showWildBirds && store
                  ? birds?.features
                      .filter((f) => props.wildBirds.find((b) => b.id === f.properties.id)?.prefCode === prefCode)
                      .map((f) => <BirdMark key={f.properties.id} f={f} proj={pref.proj} scale={scale} />)
                  : null}
              </g>
              {select
                ? munis
                    .filter((s) => s.box.size < SMALL)
                    .map((s) => (
                      <circle key={s.code} className="svg-hit" fill="transparent" cx={s.box.cx} cy={s.box.cy} r={HIT_R} aria-hidden="true" onClick={() => select(s.code)} />
                    ))
                : null}
            </svg>
            {select ? (
              <details className="svg-list">
                <summary>{picking ? TEXT.svgMuniList : TEXT.svgMuniListInspect}</summary>
                <div role="group" aria-label={picking ? TEXT.svgMuniList : TEXT.svgMuniListInspect}>
                  {munis.map((s) => (
                    <button key={s.code} type="button" className="btn" onClick={() => select(s.code)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <div className="svg-map-wrap" ref={wrapRef}>
      {body}
      <p className="svg-map-note">
        {TEXT.svgMapNote}{" "}
        {/* 出典の文は geo/attribution.ts の固定の文（外からの入力を含まない） */}
        <span dangerouslySetInnerHTML={{ __html: N03_ATTRIBUTION }} />
      </p>
    </div>
  );
}
