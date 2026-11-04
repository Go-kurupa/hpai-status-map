// 地図の層の定義（設計書 §15）。maplibre は型だけを読む（試験で jsdom の中でも読めるように）。
// 色は ui/theme.css の値と同じにする（試験が突き合わせる）。maplibre の paint は CSS の変数を読めない。
import type { ExpressionFilterSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { MUNI_ZOOM } from "./seasonView";

/** 淡色地図。地理院タイルをその場で読み込む（保存して配らない） */
export const GSI_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

export const PAINT = {
  /** 今季の発生。theme.css の --lv1 */
  current: "#b3261e",
  /** 過去のシーズンの発生。段階の色を使わない事実の色。--lv4 */
  past: "#4a4f57",
  /** 確認できていない県の斜線、補助の線。--muted */
  muted: "#5c6168",
  /** 文字と県境の色。--fg */
  ink: "#1b1d21",
  /** 隣の町の線。--lv2 */
  near: "#8a5a00",
  /** 自分の町の線。--accent */
  mine: "#00639b",
  hatchCurrent: "hatch-lv1",
  hatchPast: "hatch-past",
  hatchMuted: "hatch-muted",
} as const;

/** 斜線の画像の id と、その線の色。MapView が画像を登録し、代わりの地図（SvgMap）が同じ色の模様を作る */
export const HATCH_COLORS: ReadonlyArray<readonly [id: string, color: string]> = [
  [PAINT.hatchCurrent, PAINT.current],
  [PAINT.hatchPast, PAINT.past],
  [PAINT.hatchMuted, PAINT.muted],
];

export const IMAGE_IDS = { birdScreening: "bird-screening", birdConfirmed: "bird-confirmed" } as const;

export const OVERLAY_SOURCE_IDS = ["muni", "pref", "wild-birds"] as const;

export const LAYER_IDS = [
  "gsi-pale",
  "muni-fill",
  "pref-unwatched",
  "case-suspected",
  "case-confirmed",
  "muni-line",
  "near-line",
  "pref-line",
  "my-town",
  "wild-bird-screening",
  "wild-bird-confirmed",
] as const;

/** 指定の値の市町村（key "c"）か県（key "p"）だけを通す filter。空なら何も通さない */
export function codeFilter(key: "c" | "p", codes: readonly string[]): ExpressionFilterSpecification {
  return ["in", ["get", key], ["literal", [...codes]]];
}

/** 野鳥の層の filter。今季だけ点を出し、過去のシーズンでは何も通さない（点の source は替えない） */
export function wildBirdFilter(test: "screening_positive" | "hpai_confirmed", show: boolean): ExpressionFilterSpecification {
  return show ? ["==", ["get", "t"], test] : ["in", ["get", "t"], ["literal", []]];
}

/** 下地の地図だけの style。重ねる層は画像を登録した後に overlayLayers() で足す */
export function baseStyle(): StyleSpecification & { layers: LayerSpecification[] } {
  return {
    version: 8,
    sources: {
      gsi: {
        type: "raster",
        tiles: [GSI_TILE_URL],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 18,
        // 出典は AttributionControl に全文を出す（geo/attribution.ts）
      },
    },
    layers: [{ id: "gsi-pale", type: "raster", source: "gsi" }],
  };
}

/** 下から順。muni-fill はタップの受け（見えないが形は拾う） */
export function overlayLayers(): LayerSpecification[] {
  return [
    {
      id: "muni-fill",
      type: "fill",
      source: "muni",
      paint: { "fill-color": "#000000", "fill-opacity": 0.01 },
    },
    {
      // 全国の倍率でも見える（minzoom なし）。読めなかった県を「何もない」に見せない
      id: "pref-unwatched",
      type: "fill",
      source: "muni",
      filter: codeFilter("p", []),
      paint: { "fill-pattern": PAINT.hatchMuted },
    },
    {
      id: "case-suspected",
      type: "fill",
      source: "muni",
      minzoom: MUNI_ZOOM,
      filter: codeFilter("c", []),
      paint: { "fill-pattern": PAINT.hatchCurrent },
    },
    {
      id: "case-confirmed",
      type: "fill",
      source: "muni",
      minzoom: MUNI_ZOOM,
      filter: codeFilter("c", []),
      paint: { "fill-color": PAINT.current, "fill-opacity": 0.8 },
    },
    {
      id: "muni-line",
      type: "line",
      source: "muni",
      minzoom: 5.5,
      paint: { "line-color": PAINT.muted, "line-width": 0.6, "line-opacity": 0.6 },
    },
    {
      id: "near-line",
      type: "line",
      source: "muni",
      filter: codeFilter("c", []),
      paint: { "line-color": PAINT.near, "line-width": 3 },
    },
    {
      id: "pref-line",
      type: "line",
      source: "pref",
      paint: { "line-color": PAINT.ink, "line-width": 1.1, "line-opacity": 0.7 },
    },
    {
      id: "my-town",
      type: "line",
      source: "muni",
      filter: codeFilter("c", []),
      paint: { "line-color": PAINT.mine, "line-width": 4 },
    },
    {
      id: "wild-bird-screening",
      type: "symbol",
      source: "wild-birds",
      filter: wildBirdFilter("screening_positive", true),
      layout: { "icon-image": IMAGE_IDS.birdScreening, "icon-allow-overlap": true, "icon-size": 1 },
    },
    {
      id: "wild-bird-confirmed",
      type: "symbol",
      source: "wild-birds",
      filter: wildBirdFilter("hpai_confirmed", true),
      layout: { "icon-image": IMAGE_IDS.birdConfirmed, "icon-allow-overlap": true, "icon-size": 1 },
    },
  ];
}
