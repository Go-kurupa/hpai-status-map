import { PREFS } from "@hpai/shared/pref";
import type { MeshCode, MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { distanceRingsOf, pxPerKmAtZoom, ringLabel, ringTop, visibleRingKms } from "../../geo/distanceRings";
import { loadJapanTopo, loadPrefAnchors, loadWebGeoStore } from "../../geo/loadGeo";
import { Marker, MlMap } from "../../geo/maplibre";
import { applyDistanceRings, applyView, applyWildBirds, type ViewTarget } from "./applyView";
import { HATCH_PIXEL_RATIO, hatchImage, hexToRgb, ringImage, squareImage } from "./hatch";
import { baseStyle, HATCH_COLORS, IMAGE_IDS, overlayLayers, PAINT } from "./mapStyle";
import { TEXT } from "./texts";
import { BADGE_ZOOM, badgeStates, JAPAN_BOUNDS, type SeasonView } from "./seasonView";

export interface MapViewProps {
  view: SeasonView;
  wildBirds: readonly WildBird[];
  failedPrefCodes: readonly PrefCode[];
  myMuniCode: MuniCode | null;
  nearMuniCodes: readonly MuniCode[];
  /** 距離の輪の中心にする地点のマス目。緯度経度はこの部品の中で作り、外へ渡さない */
  farmMeshCode?: MeshCode | null;
  /** rings は距離の輪の全体が入る広さ（輪がなければ codes の町）。代わりの地図は codes の町の県を出す */
  focus: { kind: "japan" | "muni" | "rings"; codes: MuniCode[]; nonce: number } | null;
  pickMode?: boolean;
  onSelectMuni?: (code: MuniCode) => void;
  onMapReady?: (map: MlMap) => void;
  /** 地図が描けない（WebGL2 がない、初期化に失敗）。代わりの地図に切り替えたことを親に知らせる */
  onUnsupported?: () => void;
}

type Geo = Awaited<ReturnType<typeof loadWebGeoStore>>;
type Anchors = Awaited<ReturnType<typeof loadPrefAnchors>>;
type Bounds = [number, number, number, number];

const FIT = { padding: 8 } as const;
// WebGL2 が使えない端末の、境の線だけの代わりの地図。必要なときだけ別の chunk で読む
const SvgMap = lazy(() => import("./SvgMap"));
const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/**
 * 日本全体から町まで動かせる地図。回転と傾きはできない（設計書 §2）。
 * 形は最初に 1 度だけ渡し、シーズンの切り替えは filter と paint だけで行う。
 */
export default function MapView(props: MapViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [geo, setGeo] = useState<{ store: Geo; anchors: Anchors } | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false); // WebGL2 が使えない、または地図の初期化に失敗
  const [unplaced, setUnplaced] = useState(0);
  const updateBadges = useRef<(() => void) | null>(null);

  // 1) 地図を作る（1 度だけ）
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;
    let map: MlMap;
    try {
      map = new MlMap({
        container: box,
        style: baseStyle(),
        bounds: JAPAN_BOUNDS,
        fitBoundsOptions: FIT,
        minZoom: 3,
        maxZoom: 13,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false, // 出典は MapPage が地図の外に全文を出す
      });
    } catch {
      // WebGL2 が使えない端末では、ここで投げる。画面全体を落とさず、境の線だけの代わりの地図（SvgMap）を出す
      setUnsupported(true);
      latest.current.onUnsupported?.();
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    if (import.meta.env.MODE === "e2e") (window as unknown as { __hpaiMap?: MlMap }).__hpaiMap = map;

    async function init() {
      try {
        const [topo, store, anchors] = await Promise.all([loadJapanTopo(), loadWebGeoStore(), loadPrefAnchors()]);
        if (cancelled) return;
        const obj = topo.objects["muni"] as GeometryCollection<{ p?: string }>;
        const munis = feature(topo as Topology, obj);
        // 県境 = 県が違う市町村の境と、外側の海岸
        const prefOf = (g: { properties?: unknown }) => (g.properties as { p?: string } | null | undefined)?.p;
        const prefBorders = mesh(topo as Topology, obj, (a, b) => a === b || prefOf(a) !== prefOf(b));

        for (const [id, color] of HATCH_COLORS) {
          map.addImage(id, hatchImage(hexToRgb(color)), { pixelRatio: HATCH_PIXEL_RATIO });
        }
        map.addImage(IMAGE_IDS.birdScreening, ringImage(hexToRgb(PAINT.ink)), { pixelRatio: 2 });
        map.addImage(IMAGE_IDS.birdConfirmed, squareImage(hexToRgb(PAINT.ink)), { pixelRatio: 2 });
        map.addSource("muni", { type: "geojson", data: munis, tolerance: 0.3 });
        map.addSource("pref", { type: "geojson", data: { type: "Feature", properties: {}, geometry: prefBorders } });
        map.addSource("wild-birds", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("distance-rings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const layer of overlayLayers()) map.addLayer(layer);

        map.on("click", (e) => {
          const hit = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
          const code = hit?.properties?.["c"];
          if (typeof code === "string") latest.current.onSelectMuni?.(code);
        });
        setGeo({ store, anchors });
        setReady(true);
        latest.current.onMapReady?.(map);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    // スタイルの読み込み完了を待つ（タイルが読めなくても始める）。どちらが先でも 1 度だけ
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void init();
    };
    map.once("styledata", start);
    map.once("load", start);

    return () => {
      cancelled = true;
      mapRef.current = null;
      map.remove();
      setReady(false);
      setGeo(null);
    };
  }, []);

  // 2) 層に反映する（filter と paint だけ。形の setData は呼ばない）
  const failedKey = props.failedPrefCodes.join(",");
  const nearKey = props.nearMuniCodes.join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyView(map as unknown as ViewTarget, {
      view: props.view,
      failedPrefCodes: props.failedPrefCodes,
      myMuniCode: props.myMuniCode,
      nearMuniCodes: props.nearMuniCodes,
    });
    // failedKey と nearKey が配列の中身の変化を表す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.view, failedKey, props.myMuniCode, nearKey]);

  // 3) 野鳥の点
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !geo) return;
    const { unplaced: n } = applyWildBirds(map as unknown as ViewTarget, props.wildBirds, (b) => {
      const entry = b.muniCode ? geo.store.index[b.muniCode] : undefined;
      return entry ? entry.center : (geo.anchors[b.prefCode] ?? null);
    });
    setUnplaced(n);
  }, [ready, geo, props.wildBirds]);

  // 距離の輪。ラベルは文字の層が使えない（glyphs の外部 URL が要る）ので、県のバッジと同じ Marker で出す
  const rings = useMemo(() => distanceRingsOf(props.farmMeshCode), [props.farmMeshCode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyDistanceRings(map as unknown as ViewTarget, rings);
  }, [ready, rings]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !rings) return;
    const labels = rings.features.map((f) => {
      const el = document.createElement("div");
      el.className = "ring-label";
      el.setAttribute("aria-hidden", "true");
      el.textContent = ringLabel(f.properties.km);
      const top = ringTop(f);
      return { km: f.properties.km, el, marker: new Marker({ element: el, anchor: "bottom" }).setLngLat(top).addTo(map), lat: top[1] };
    });
    const update = () => {
      const shown = new Set(visibleRingKms(pxPerKmAtZoom(map.getZoom(), labels[0]!.lat)));
      for (const l of labels) l.el.hidden = !shown.has(l.km);
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
      for (const l of labels) l.marker.remove();
    };
  }, [ready, rings]);

  // 4) 県のバッジ（Marker は 1 度だけ作り、文字と表示だけを替える）
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !geo) return;
    const badges = new Map<PrefCode, HTMLButtonElement>();
    const markers: Marker[] = [];
    for (const [code, at] of Object.entries(geo.anchors)) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pref-badge";
      el.hidden = true;
      el.addEventListener("click", () => map.easeTo({ center: at, zoom: BADGE_ZOOM }));
      markers.push(new Marker({ element: el }).setLngLat(at).addTo(map));
      badges.set(code, el);
    }
    const update = () => {
      const view = latest.current.view;
      const shown = new Map(badgeStates(view, map.getZoom()).map((s) => [s.prefCode, s.text]));
      for (const [code, el] of badges) {
        const text = shown.get(code);
        el.hidden = text === undefined;
        el.classList.toggle("is-past", !view.isCurrent); // 過去のシーズンは段階の色を使わない
        if (text !== undefined) {
          el.textContent = text;
          el.setAttribute("aria-label", `${PREF_NAME.get(code) ?? code} ${/^\d+$/.test(text) ? `${text} 件` : text}。押すと拡大します`);
        }
      }
    };
    update();
    map.on("zoom", update);
    updateBadges.current = update;
    return () => {
      map.off("zoom", update);
      updateBadges.current = null;
      for (const m of markers) m.remove();
    };
  }, [ready, geo]);
  useEffect(() => {
    updateBadges.current?.();
  }, [props.view, ready, geo]);

  // 5) 見る場所の指定（nonce が変わるたびに動かす）
  const nonce = props.focus?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    const f = latest.current.focus;
    if (!ready || !map || !geo || !f) return;
    if (f.kind === "japan") {
      map.fitBounds(JAPAN_BOUNDS, FIT);
      return;
    }
    const outer = f.kind === "rings" ? rings?.features.at(-1)?.geometry.coordinates[0] : undefined;
    if (outer) {
      const lngs = outer.map((c) => c[0]);
      const lats = outer.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 20 },
      );
      return;
    }
    const boxes = f.codes.map((c) => geo.store.index[c]?.bbox).filter((b): b is Bounds => !!b);
    if (boxes.length === 0) return;
    map.fitBounds(
      [
        [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))],
        [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))],
      ],
      { padding: 40, maxZoom: 11 },
    );
  }, [ready, geo, nonce]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = props.pickMode ? "pointer" : "";
  }, [ready, props.pickMode]);

  return (
    <div className="map-wrap">
      <div ref={boxRef} className="map-canvas" role="region" aria-label="発生状況の地図" hidden={unsupported} />
      {unsupported ? (
        <Suspense fallback={<p role="status">{TEXT.svgLoading}</p>}>
          <SvgMap
            view={props.view}
            wildBirds={props.wildBirds}
            failedPrefCodes={props.failedPrefCodes}
            myMuniCode={props.myMuniCode}
            nearMuniCodes={props.nearMuniCodes}
            farmMeshCode={props.farmMeshCode}
            focus={props.focus}
            onSelectMuni={props.onSelectMuni}
            onUnplaced={setUnplaced}
            onFailed={() => setFailed(true)}
          />
        </Suspense>
      ) : null}
      {failed ? (
        <p className="map-error" role="alert">
          {TEXT.mapLoadFailed}
        </p>
      ) : null}
      {unplaced > 0 ? <p className="map-note">場所が分からず、地図に置けなかった野鳥の記録が {unplaced} 件あります。</p> : null}
    </div>
  );
}
