// 地点を選ぶ地図。タップした座標は pickToFarmPatch に渡してすぐ捨てる（state にも画面にも残さない）。
// 保存するのは約 1km のマス目（3 次メッシュ）と町のコードだけ。点は描かず、選んだマス目の四角を示す。
import type { MuniEntry } from "@hpai/shared/geo";
import { mesh3Center } from "@hpai/shared/mesh";
import type { Farm, MeshCode } from "@hpai/shared/types";
import { useEffect, useRef, useState } from "react";
import { MAP_ATTRIBUTION } from "../../geo/attribution";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { MlMap } from "../../geo/maplibre";
import { baseStyle } from "../map/mapStyle";
import { TEXT } from "../map/texts";
import { Button } from "../../ui/Button";
import { insideMuniBox, pickToFarmPatch } from "./farmForm";
import "./settings.css";

export type FarmPick = Pick<Farm, "meshCode" | "muniCode" | "prefCode">;

const JAPAN_CENTER: [number, number] = [137.5, 37.5];
const CELL_SOURCE = "picker-cell";
const MUNI_SOURCE = "picker-muni";
// 3 次メッシュの半分の大きさ（緯度 30 秒、経度 45 秒の半分）
const HALF_LAT = 1 / 240;
const HALF_LNG = 1 / 160;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function cellFeature(code: MeshCode | null): GeoJSON.FeatureCollection {
  if (!code) return EMPTY;
  const { lat, lng } = mesh3Center(code);
  const ring = [
    [lng - HALF_LNG, lat - HALF_LAT],
    [lng + HALF_LNG, lat - HALF_LAT],
    [lng + HALF_LNG, lat + HALF_LAT],
    [lng - HALF_LNG, lat + HALF_LAT],
    [lng - HALF_LNG, lat - HALF_LAT],
  ];
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

type GeoSource = { setData(data: GeoJSON.GeoJSON): void };

export function MeshPicker({
  muni,
  onPick,
  onUnsupported,
}: {
  muni: MuniEntry | null;
  onPick: (patch: FarmPick) => void;
  /** 地図が描けない端末（WebGL2 がない）。親が案内の文を切り替える */
  onUnsupported?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const latest = useRef({ muni, onPick, onUnsupported });
  latest.current = { muni, onPick, onUnsupported };
  const [pickedMesh, setPickedMesh] = useState<MeshCode | null>(null);
  const [outside, setOutside] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [centerPicked, setCenterPicked] = useState(false);

  // 1) 地図を作る（1 度だけ）。回転と傾きはできない
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let map: MlMap;
    try {
      map = new MlMap({
        container: box,
        style: baseStyle(),
        center: JAPAN_CENTER,
        zoom: 4,
        minZoom: 3,
        maxZoom: 15,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false, // 出典は下の欄に全文を出す
      });
    } catch {
      setUnsupported(true); // WebGL2 が使えない端末。画面を落とさず、町の中心あたりのマス目を使うボタンを出す
      latest.current.onUnsupported?.();
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    if (import.meta.env.MODE === "e2e") (window as unknown as { __hpaiPicker?: MlMap }).__hpaiPicker = map;

    // スタイルの読み込み完了を待つ（タイルが読めなくても始める）。どちらが先でも 1 度だけ足す
    let added = false;
    readyRef.current = new Promise<void>((resolve) => {
      if (map.isStyleLoaded()) resolve();
      else {
        map.once("styledata", () => resolve());
        map.once("load", () => resolve());
      }
    }).then(() => {
      if (added) return;
      added = true;
      map.addSource(MUNI_SOURCE, { type: "geojson", data: EMPTY });
      map.addSource(CELL_SOURCE, { type: "geojson", data: EMPTY });
      map.addLayer({ id: "picker-muni-line", type: "line", source: MUNI_SOURCE, paint: { "line-color": "#00639b", "line-width": 3 } });
      map.addLayer({ id: "picker-cell-fill", type: "fill", source: CELL_SOURCE, paint: { "fill-color": "#b3261e", "fill-opacity": 0.45 } });
      map.addLayer({ id: "picker-cell-line", type: "line", source: CELL_SOURCE, paint: { "line-color": "#b3261e", "line-width": 2 } });
    });

    map.on("click", (e) => {
      const { muni: target, onPick: pick } = latest.current;
      if (!target) return;
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (!insideMuniBox(point, target)) {
        setOutside(true);
        return;
      }
      setOutside(false);
      const patch = pickToFarmPatch(point, target); // 座標はここで捨てる
      setPickedMesh(patch.meshCode);
      pick(patch);
    });

    return () => {
      mapRef.current = null;
      readyRef.current = null;
      map.remove();
    };
  }, []);

  // 2) 選んだ町へ寄せ、町の境の線を示す。町を替えたら、選んだマス目の四角を消す
  const code = muni?.code;
  useEffect(() => {
    setPickedMesh(null);
    setOutside(false);
    setCenterPicked(false);
    const map = mapRef.current;
    const target = latest.current.muni;
    if (!map || !target) return;
    map.fitBounds(
      [
        [target.bbox[0], target.bbox[1]],
        [target.bbox[2], target.bbox[3]],
      ],
      { padding: 24, maxZoom: 12, duration: 0 },
    );
    let cancelled = false;
    void (async () => {
      try {
        const [store] = await Promise.all([loadWebGeoStore(), readyRef.current]);
        await store.ensurePrefs([target.prefCode]);
        const feature = store.geometry(target.code);
        if (cancelled) return;
        (map.getSource(MUNI_SOURCE) as GeoSource | undefined)?.setData(feature);
      } catch {
        // 境の線が出なくても、地図をタップして選べる
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // 3) 選んだマス目の四角
  useEffect(() => {
    const map = mapRef.current;
    const ready = readyRef.current;
    if (!map || !ready) return;
    void ready.then(() => {
      if (mapRef.current !== map) return;
      (map.getSource(CELL_SOURCE) as GeoSource | undefined)?.setData(cellFeature(pickedMesh));
    });
  }, [pickedMesh]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = muni ? "pointer" : "";
  }, [muni]);

  return (
    <div>
      <div ref={boxRef} className="picker-canvas" role="region" aria-label="農場の地点を選ぶ地図" hidden={unsupported} />
      {unsupported ? (
        <div className="picker-fallback">
          <p className="settings-note">{TEXT.meshNoMap}</p>
          <Button
            disabled={!muni}
            onClick={() => {
              if (!muni) return;
              // 索引の町の中心（[経度, 緯度]）をマス目に直す。座標はここで捨て、マス目と町のコードだけを渡す
              const patch = pickToFarmPatch({ lat: muni.center[1], lng: muni.center[0] }, muni);
              setCenterPicked(true);
              onPick(patch);
            }}
          >
            {TEXT.meshUseCenter}
          </Button>
          {centerPicked ? <p role="status">{TEXT.meshCenterPicked}</p> : null}
        </div>
      ) : null}
      {outside ? (
        <p className="settings-error" role="alert">
          選んだ市町村の外です。地図で、選んだ町の中をおしてください。
        </p>
      ) : null}
      {unsupported ? null : (
        <p className="picker-attribution">
          {MAP_ATTRIBUTION.map((html, i) => (
            // 出典の文は geo/attribution.ts の固定の文（外からの入力を含まない）
            <span key={i} className="picker-attribution-item" dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </p>
      )}
    </div>
  );
}
