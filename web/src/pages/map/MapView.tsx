import { mesh3Center } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { MeshCode, MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { interiorPoint } from "../../geo/interiorPoint";
import { distanceRingsAt, distanceRingsOf, pxPerKmAtZoom, ringLabel, ringTop, visibleRingKms } from "../../geo/distanceRings";
import { FARM_MARK_PX, farmMeshFeature, farmSquareShown } from "../../geo/farmMark";
import { loadJapanTopo, loadPrefAnchors, loadWebGeoStore } from "../../geo/loadGeo";
import { Marker, MlMap } from "../../geo/maplibre";
import { applyDistanceRings, applyFarmMesh, applyLatest, applyOverlay, applyView, applyWildBirds, type LatestState, type OverlayState, type ViewTarget } from "./applyView";
import { filledHatchImage, HATCH_PIXEL_RATIO, hatchImage, hexToRgb } from "./hatch";
import { BIRD_ICON_PX, birdImage } from "./birdIcon";
import { baseStyle, codeFilter, HATCH_COLORS, IMAGE_IDS, overlayLayers, PAINT } from "./mapStyle";
import { CMP_TEXT } from "./compareTexts";
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
  /** farmMeshCode に「鶏舎の場所」の印を描く（本人の端末の場所か会員の農場のとき。再現や見本の仮の地点には描かない） */
  markFarm?: boolean;
  /** 地点がないときの距離の輪の中心（町の中心、[経度, 緯度]）。地点があればそちらを使う（設計書 2026-11-06-ui-frame 決定 6） */
  ringCenter?: [number, number] | null;
  /** rings は距離の輪の全体が入る広さ（輪がなければ codes の町）。代わりの地図は codes の町の県を出す */
  /**
   * minZoom は場所合わせ（くわしい場所を決める）のときだけ渡す。codes の町へ寄せ、拡大がこれに届かなければ最初の町の中心でこの拡大まで寄せる。
   * 場所合わせを始めると地図の箱の幅が変わるので、寄せる前に地図の大きさを測り直す
   */
  /**
   * 見る場所。point は場所合わせで選んだ地区（大字）の目安の点 at（[経度, 緯度]）へ、拡大 OAZA_ZOOM で寄せる。
   * 点は寄せる先の計算だけに使い、保存も送信もしない
   */
  focus: { kind: "japan" | "muni" | "rings" | "point"; codes: MuniCode[]; nonce: number; minZoom?: number; at?: [number, number] } | null;
  pickMode?: boolean;
  onSelectMuni?: (code: MuniCode) => void;
  /** 場所を選んでいないときに町を押したら、その町の事例を見る（設計書 2026-11-06-ui-frame 決定 4）。onSelectMuni が優先 */
  onInspectMuni?: (code: MuniCode) => void;
  onMapReady?: (map: MlMap) => void;
  /** 地図が描けない（WebGL2 がない、初期化に失敗）。代わりの地図に切り替えたことを親に知らせる */
  onUnsupported?: () => void;
  /** 比べの画面の何枚目か（0 か 1）。試験の組み立てでは 2 枚目を別の名前で window に置き、1 枚目（選んだシーズン）を上書きしない。
   *  名前の文字は試験の組み立ての中だけで作る（本番の build に試験の入口の文字を残さない。scripts/test/no-fixture-in-prod.test.ts） */
  mapIndex?: 0 | 1;
  /** 地図の領域の名前。比べの 2 枚は、比べる 1／2 とシーズンを入れて読み上げで区別する */
  ariaLabel?: string;
  /** 過去シーズンとの重ね合わせ（設計書 2026-11-06-data-explore E8、E13、E14）。あるときは view の発生の塗りと県の件数の札を出さない */
  overlay?: OverlayState | null;
  /** 3 つ以上の比べ（設計書 2026-11-06-data-explore E12）。町ごとに最後に発生したシーズンの色。あるときは overlay と同じく、view の発生の塗りと札を出さない */
  latest?: LatestState | null;
  /** 比べの画面で押した町。赤い線で囲む（作者 11/7） */
  pickedMuni?: MuniCode | null;
}

type Geo = Awaited<ReturnType<typeof loadWebGeoStore>>;
type Anchors = Awaited<ReturnType<typeof loadPrefAnchors>>;
type Bounds = [number, number, number, number];

const FIT = { padding: 8 } as const;
/** 3 つ以上の比べで、発生したシーズンの数の札を出し始める倍率（全国の広さでは重なるので出さない） */
const COUNT_ZOOM = 7;
/** 地区（大字）の目安の点へ寄せる拡大。約 1km のマス目が見分けられ、決められる拡大（SPOT_MIN_ZOOM）より大きい */
export const OAZA_ZOOM = 13;
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
  /** 町のコード → 町の形（場所合わせで十字を町の中に置くのに使う） */
  const shapesRef = useRef(new Map<MuniCode, GeoJSON.Polygon | GeoJSON.MultiPolygon>());
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
    if (import.meta.env.MODE === "e2e") (window as unknown as Record<string, MlMap>)[latest.current.mapIndex === 1 ? "__hpaiMap2" : "__hpaiMap"] = map;

    async function init() {
      try {
        const [topo, store, anchors] = await Promise.all([loadJapanTopo(), loadWebGeoStore(), loadPrefAnchors()]);
        if (cancelled) return;
        const obj = topo.objects["muni"] as GeometryCollection<{ p?: string }>;
        const munis = feature(topo as Topology, obj);
        shapesRef.current = new Map(
          munis.features.flatMap((m) => {
            const c = (m.properties as { c?: string } | null)?.c;
            return c && (m.geometry.type === "Polygon" || m.geometry.type === "MultiPolygon") ? [[c, m.geometry] as const] : [];
          }),
        );
        // 県境 = 県が違う市町村の境と、外側の海岸
        const prefOf = (g: { properties?: unknown }) => (g.properties as { p?: string } | null | undefined)?.p;
        const prefBorders = mesh(topo as Topology, obj, (a, b) => a === b || prefOf(a) !== prefOf(b));

        for (const [id, color] of HATCH_COLORS) {
          map.addImage(id, hatchImage(hexToRgb(color)), { pixelRatio: HATCH_PIXEL_RATIO });
        }
        map.addImage(PAINT.hatchCmpOne, filledHatchImage(hexToRgb(PAINT.cmpOne), "up"), { pixelRatio: HATCH_PIXEL_RATIO });
        map.addImage(PAINT.hatchCmpTwo, filledHatchImage(hexToRgb(PAINT.cmpTwo), "down"), { pixelRatio: HATCH_PIXEL_RATIO });
        map.addImage(PAINT.hatchCmpBoth, filledHatchImage(hexToRgb(PAINT.cmpBoth), "cross"), { pixelRatio: HATCH_PIXEL_RATIO });
        // 野鳥の印（作者 11/7 の決定 A）。BIRD_ICON_PX の CSS px で、どの倍率でも同じ大きさ
        map.addImage(IMAGE_IDS.birdScreening, birdImage("screening", hexToRgb(PAINT.ink), BIRD_ICON_PX * 2), { pixelRatio: 2 });
        map.addImage(IMAGE_IDS.birdConfirmed, birdImage("confirmed", hexToRgb(PAINT.ink), BIRD_ICON_PX * 2), { pixelRatio: 2 });
        map.addSource("muni", { type: "geojson", data: munis, tolerance: 0.3 });
        map.addSource("pref", { type: "geojson", data: { type: "Feature", properties: {}, geometry: prefBorders } });
        map.addSource("wild-birds", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("distance-rings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("farm-mesh", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const layer of overlayLayers()) map.addLayer(layer);

        map.on("click", (e) => {
          const hit = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
          const code = hit?.properties?.["c"];
          if (typeof code !== "string") return;
          const pick = latest.current.onSelectMuni ?? latest.current.onInspectMuni;
          pick?.(code);
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
    // 重ね合わせの間は、1 シーズン分の発生の塗りを消して 3 つの模様で塗る
    const overlay = props.overlay ?? null;
    const latestState = props.latest ?? null;
    if (overlay || latestState) {
      map.setFilter("case-suspected", codeFilter("c", []));
      map.setFilter("case-confirmed", codeFilter("c", []));
    }
    // 3 つ以上の比べでも、確認できていない県は重ね合わせと同じ灰色の層で示す
    applyOverlay(map as unknown as ViewTarget, overlay ?? (latestState ? { first: [], second: [], show: "both", unwatchedPrefCodes: latestState.unwatchedPrefCodes } : null));
    applyLatest(map as unknown as ViewTarget, latestState);
    updateBadges.current?.();
    // failedKey と nearKey が配列の中身の変化を表す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.view, failedKey, props.myMuniCode, nearKey, props.overlay, props.latest]);

  // 比べの画面で押した町を赤い線で囲む
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("picked-line", codeFilter("c", props.pickedMuni ? [props.pickedMuni] : []));
  }, [ready, props.pickedMuni]);

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
  const ringLng = props.ringCenter?.[0];
  const ringLat = props.ringCenter?.[1];
  const rings = useMemo(
    () => (props.farmMeshCode ? distanceRingsOf(props.farmMeshCode) : distanceRingsAt(ringLng !== undefined && ringLat !== undefined ? [ringLng, ringLat] : null)),
    [props.farmMeshCode, ringLng, ringLat],
  );
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

  // 鶏舎の場所（作者 11/7）。寄ったときは本当の約 1km のマス目を塗り、マス目が 14px より小さく見える広さでは一定の大きさの赤い四角に替える。
  // 「鶏舎の場所」の札はどちらでも添える。この端末の画面だけで描き、送らない
  const farmMesh = useMemo(() => (props.markFarm ? farmMeshFeature(props.farmMeshCode) : null), [props.markFarm, props.farmMeshCode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyFarmMesh(map as unknown as ViewTarget, farmMesh);
    if (!farmMesh || !props.farmMeshCode) return;
    const { lat, lng } = mesh3Center(props.farmMeshCode);
    const el = document.createElement("div");
    el.className = "farm-mark";
    el.setAttribute("aria-hidden", "true");
    const square = document.createElement("span");
    square.className = "farm-mark-square";
    const label = document.createElement("span");
    label.className = "farm-mark-label";
    label.textContent = TEXT.farmMark;
    el.append(square, label);
    const marker = new Marker({ element: el, anchor: "left", offset: [-FARM_MARK_PX / 2, 0] }).setLngLat([lng, lat]).addTo(map);
    // 3 次メッシュの幅は経度 45 秒。札は、四角のときは四角の右に、マス目のときはマス目の右の外に置く（マス目に重ねない）
    const halfWidthKm = (((45 / 3600) * Math.PI) / 180) * 6371 * Math.cos((lat * Math.PI) / 180) / 2;
    const update = () => {
      const pxPerKm = pxPerKmAtZoom(map.getZoom(), lat);
      const small = farmSquareShown(pxPerKm);
      square.hidden = !small;
      // 札の左端は、印の左端から四角の幅（14px、隠しても場所を取る）と間（4px）の先。マス目のときはマス目の右端から 4px 空ける
      marker.setOffset(small ? [-FARM_MARK_PX / 2, 0] : [halfWidthKm * pxPerKm + 4 - (FARM_MARK_PX + 4), 0]);
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
      marker.remove();
    };
    // farmMesh は farmMeshCode から作るので、コードの変化は farmMesh で拾える
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, farmMesh]);

  // 3 つ以上の比べ（設計書 2026-11-06-data-explore E12、作者 11/7）: 2 つ以上のシーズンで発生した町に、発生したシーズンの数の札を町の中心に出す。
  // 全国の広さでは札が重なるので、COUNT_ZOOM より寄ったときだけ出す
  const countsKey = JSON.stringify(props.latest?.counts ?? []);
  useEffect(() => {
    const map = mapRef.current;
    const counts = latest.current.latest?.counts ?? [];
    if (!ready || !map || !geo || counts.length === 0) return;
    const marks = counts.flatMap(([code, n]) => {
      const at = geo.store.index[code]?.center;
      if (!at) return [];
      const el = document.createElement("div");
      el.className = "cmp-count-badge";
      el.textContent = CMP_TEXT.countBadge(n);
      el.setAttribute("aria-hidden", "true");
      return [{ el, marker: new Marker({ element: el }).setLngLat(at).addTo(map) }];
    });
    const update = () => {
      const show = map.getZoom() >= COUNT_ZOOM;
      for (const m of marks) m.el.hidden = !show;
    };
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
      for (const m of marks) m.marker.remove();
    };
  }, [ready, geo, countsKey]);

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
      // 重ね合わせの間は 1 シーズン分の数の札を出さない（E13）
      const shown = new Map(latest.current.overlay || latest.current.latest ? [] : badgeStates(view, map.getZoom()).map((s) => [s.prefCode, s.text]));
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
    if (f.kind === "point") {
      // 地区の目安の点へ。今より引いた広さにはしない（十字で合わせかけている拡大を保つ）
      if (f.at) map.jumpTo({ center: f.at, zoom: Math.max(map.getZoom(), OAZA_ZOOM) });
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
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))],
      [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))],
    ];
    const fit = { padding: 40, maxZoom: 11 };
    if (f.minZoom !== undefined) {
      // 場所合わせ: 地図の箱の幅が変わった直後なので、古い幅で寄せ先を決めない（PC で十字が隣の町に来ていた。2026-11-06）
      map.resize();
      const code = f.codes[0]!;
      const entry = geo.store.index[code];
      const cam = map.cameraForBounds(bounds, fit);
      const fits = !!cam && cam.zoom !== undefined && cam.zoom >= f.minZoom;
      // 町の全体が入る広さで決められればその中心、大きな町は最大の面の中心で、決められる拡大まで寄せる
      const c = cam?.center as { lng: number; lat: number } | undefined;
      const want: [number, number] | undefined = fits && c ? [c.lng, c.lat] : entry?.center;
      if (!want) return;
      // 十字（地図の真ん中）は町の形の中に置く。コの字の町や島のある町では、中心が隣の町に出る
      const shape = shapesRef.current.get(code);
      map.jumpTo({ center: shape ? interiorPoint(shape, want) : want, zoom: fits ? cam!.zoom! : f.minZoom });
      return;
    }
    map.fitBounds(bounds, fit);
  }, [ready, geo, nonce]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = props.pickMode ? "pointer" : "";
  }, [ready, props.pickMode]);

  return (
    <div className="map-wrap">
      <div ref={boxRef} className="map-canvas" role="region" aria-label={props.ariaLabel ?? "発生状況の地図"} hidden={unsupported} />
      {unsupported ? (
        <Suspense fallback={<p role="status">{TEXT.svgLoading}</p>}>
          <SvgMap
            view={props.view}
            wildBirds={props.wildBirds}
            failedPrefCodes={props.failedPrefCodes}
            myMuniCode={props.myMuniCode}
            nearMuniCodes={props.nearMuniCodes}
            farmMeshCode={props.farmMeshCode}
            markFarm={props.markFarm}
            focus={props.focus}
            onSelectMuni={props.onSelectMuni}
            onInspectMuni={props.onInspectMuni}
            ringCenter={props.ringCenter}
            overlay={props.overlay}
            latest={props.latest}
            pickedMuni={props.pickedMuni}
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
