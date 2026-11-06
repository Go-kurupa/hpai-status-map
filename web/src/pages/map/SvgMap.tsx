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
import { loadJapanTopo, loadPrefAnchors, loadWebGeoStore } from "../../geo/loadGeo";
import { viewStyle, wildBirdFeatures, type WildBirdFeature } from "./applyView";
import { HATCH_PERIOD, HATCH_PIXEL_RATIO, HATCH_STRIPE } from "./hatch";
import { HATCH_COLORS, overlayLayers, PAINT } from "./mapStyle";
import type { MapViewProps } from "./MapView";
import { badgeStates, JAPAN_BOUNDS } from "./seasonView";
import { TEXT } from "./texts";

export interface SvgMapProps
  extends Pick<MapViewProps, "view" | "wildBirds" | "failedPrefCodes" | "myMuniCode" | "nearMuniCodes" | "farmMeshCode" | "ringCenter" | "focus" | "onSelectMuni" | "onInspectMuni"> {
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

/** 斜線の模様。hatchImage と同じ周期と太さ（右上がり） */
function Hatch({ id, color }: { id: string; color: string }) {
  const p = HATCH_PERIOD;
  const s = HATCH_STRIPE;
  const k = W / REF_WIDTH / HATCH_PIXEL_RATIO;
  return (
    <pattern id={id} data-color={color} patternUnits="userSpaceOnUse" width={p} height={p} patternTransform={`scale(${k})`}>
      <polygon points={`0,0 ${s},0 0,${s}`} fill={color} />
      <polygon points={`0,${p} ${p},0 ${p},${s} ${s},${p}`} fill={color} />
    </pattern>
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

function BirdMark({ f, proj }: { f: WildBirdFeature; proj: Projection }) {
  const [lng, lat] = f.geometry.coordinates;
  const [x, y] = proj.at(lng, lat);
  const r = W * 0.009;
  return f.properties.t === "hpai_confirmed" ? (
    <rect data-bird={f.properties.t} x={x - r} y={y - r} width={r * 2} height={r * 2} fill={PAINT.ink} stroke="#ffffff" strokeWidth={r * 0.4} />
  ) : (
    <circle data-bird={f.properties.t} cx={x} cy={y} r={r} fill="none" stroke={PAINT.ink} strokeWidth={r * 0.55} />
  );
}

export default function SvgMap(props: SvgMapProps) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [store, setStore] = useState<GeoStore | null>(null);
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const [japan, setJapan] = useState<JapanData | null>(null);
  const [prefCode, setPrefCode] = useState<PrefCode | null>(null);
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
    if (f.kind === "japan") setPrefCode(null);
    else {
      const p = f.codes.map((c) => store.index[c]?.prefCode).find((x): x is PrefCode => !!x);
      if (p) setPrefCode(p);
    }
  }, [nonce, store]);

  const style = viewStyle({
    view: props.view,
    failedPrefCodes: props.failedPrefCodes,
    myMuniCode: props.myMuniCode,
    nearMuniCodes: props.nearMuniCodes,
  });
  const sets = useMemo(
    () => ({
      suspected: new Set(style.suspectedMuniCodes),
      confirmed: new Set(style.confirmedMuniCodes),
      unwatched: new Set(style.unwatchedPrefCodes),
      mine: new Set(style.myMuniCodes),
      near: new Set(style.nearMuniCodes),
    }),
    [style.suspectedMuniCodes, style.confirmedMuniCodes, style.unwatchedPrefCodes, style.myMuniCodes, style.nearMuniCodes],
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

  // 輪のラベルの大きさと、出すかどうかは画面の px で決める。図の縮尺は幅と、図の切り替えで変わる
  const shownSvg = prefCode === null ? (japan ? "japan" : null) : pref ? prefCode : null;
  useEffect(() => {
    if (!rings || shownSvg === null) return;
    const measure = () => {
      const k = wrapRef.current?.querySelector<SVGSVGElement>("svg.svg-map")?.getScreenCTM?.()?.a;
      if (k) setScale(k);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [rings, shownSvg]);

  const hatchId = (id: string) => `${uid}-${id}`;
  const defs = (
    <defs>
      {HATCH_COLORS.map(([id, color]) => (
        <Hatch key={id} id={hatchId(id)} color={color} />
      ))}
    </defs>
  );
  // 町を押したとき: 場所を選んでいる間は選ぶ、それ以外はその町の事例を見る。「さわっても選べます」の案内は選ぶときだけ
  const select = props.onSelectMuni ?? props.onInspectMuni;
  const picking = props.onSelectMuni !== undefined;

  let body: React.ReactNode;
  if (!japan || !store) {
    body = <p role="status">{TEXT.svgLoading}</p>;
  } else if (prefCode === null) {
    const badges = new Map(badgeStates(props.view, 0).map((b) => [b.prefCode, b.text]));
    const anchorOf = (s: Shape) => (anchors?.[s.code] ? japan.proj.at(...anchors[s.code]!) : [s.box.cx, s.box.cy]);
    const labelOf = (s: Shape) => {
      const t = badges.get(s.code);
      const parts = [s.name];
      if (t !== undefined) parts.push(/^\d+$/.test(t) ? `${t} 件` : t);
      if (sets.unwatched.has(s.code)) parts.push(TEXT.svgUnwatched);
      return `${parts.join("、")}。押すと市町村の図になります`;
    };
    const lines = (codes: Set<MuniCode>) => [...codes].map((c) => japan.muniPath(c)).filter((d): d is string => !!d);
    body = (
      <>
        <p className="map-note">{TEXT.svgPrefHint}</p>
        <svg className="svg-map" viewBox={`0 0 ${W} ${japan.proj.height}`} role="group" aria-label={TEXT.svgMapAria}>
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
              .map((s) => (
                <path key={s.code} d={s.d} fill={`url(#${hatchId(PAINT.hatchMuted)})`} />
              ))}
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
            {style.showWildBirds ? birds?.features.map((f) => <BirdMark key={f.properties.id} f={f} proj={japan.proj} />) : null}
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
    const fillOf = (c: MuniCode) => (sets.confirmed.has(c) ? "confirmed" : sets.suspected.has(c) ? "suspected" : null);
    const labelOf = (s: Shape) => {
      const parts = [s.name];
      const f = fillOf(s.code);
      if (f) parts.push(f === "confirmed" ? TEXT.svgConfirmed : TEXT.svgSuspected);
      if (sets.mine.has(s.code)) parts.push(TEXT.myTown);
      if (sets.near.has(s.code)) parts.push(TEXT.svgNear);
      if (unwatched) parts.push(TEXT.svgUnwatched);
      return parts.join("、") + (picking ? "。押すとこの町を選びます" : select ? "。押すとこの町の発生を見ます" : "");
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
                {unwatched ? munis.map((s) => <path key={s.code} d={s.d} fill={`url(#${hatchId(PAINT.hatchMuted)})`} />) : null}
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
                {style.showWildBirds && store
                  ? birds?.features
                      .filter((f) => props.wildBirds.find((b) => b.id === f.properties.id)?.prefCode === prefCode)
                      .map((f) => <BirdMark key={f.properties.id} f={f} proj={pref.proj} />)
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
