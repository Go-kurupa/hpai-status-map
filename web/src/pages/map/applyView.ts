// SeasonView を地図の層に反映する。シーズンの切り替えは filter と paint を替えるだけで、
// 形の source（muni）の setData は呼ばない（形は最初に 1 度だけ渡す）。
// maplibre の Map ではなく、必要な 3 つの操作だけの型を受けるので、偽の map で試験できる。
import type { MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
import type { DistanceRings } from "../../geo/distanceRings";
import type { FarmMarkFeature } from "../../geo/farmMark";
import { codeFilter, PAINT, wildBirdFilter } from "./mapStyle";
import type { SeasonView } from "./seasonView";

export interface ViewTarget {
  setFilter(layerId: string, filter: unknown): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
  getSource(id: string): { setData(data: unknown): unknown } | undefined;
}

export interface ViewState {
  view: SeasonView;
  /** 見回りで確認できていない県。今季の表示にだけ重ねる */
  failedPrefCodes: readonly PrefCode[];
  myMuniCode: MuniCode | null;
  nearMuniCodes: readonly MuniCode[];
}

/**
 * 地図の塗り分けの決まり。MapLibre の層（applyView）と、WebGL がない端末の代わりの地図（SvgMap）の両方がこれを使う。
 * 決まりはここだけに書く。
 */
export interface ViewStyle {
  suspectedMuniCodes: readonly MuniCode[];
  confirmedMuniCodes: readonly MuniCode[];
  /** 斜線の灰色を引く県 */
  unwatchedPrefCodes: readonly PrefCode[];
  myMuniCodes: readonly MuniCode[];
  nearMuniCodes: readonly MuniCode[];
  /** 野鳥の印を出すか */
  showWildBirds: boolean;
  /** 確定の塗りの色 */
  confirmedColor: string;
  /** 疑いの斜線の画像の id（mapStyle の HATCH_COLORS で色が分かる） */
  suspectedHatch: string;
}

export function viewStyle(s: ViewState): ViewStyle {
  const { view } = s;
  return {
    suspectedMuniCodes: view.suspectedMuniCodes,
    confirmedMuniCodes: view.confirmedMuniCodes,
    // 過去の記録は閉じた記録なので、今日の見回りの失敗は重ねない
    unwatchedPrefCodes: view.isCurrent ? s.failedPrefCodes : [],
    myMuniCodes: s.myMuniCode ? [s.myMuniCode] : [],
    nearMuniCodes: s.nearMuniCodes,
    // 野鳥の記録は今季だけ
    showWildBirds: view.isCurrent,
    // 今季は段階の色、過去は段階を表さない事実の色（設計書 §15）
    confirmedColor: view.isCurrent ? PAINT.current : PAINT.past,
    suspectedHatch: view.isCurrent ? PAINT.hatchCurrent : PAINT.hatchPast,
  };
}

export function applyView(map: ViewTarget, s: ViewState): void {
  const st = viewStyle(s);
  map.setFilter("case-suspected", codeFilter("c", st.suspectedMuniCodes));
  map.setFilter("case-confirmed", codeFilter("c", st.confirmedMuniCodes));
  map.setFilter("pref-unwatched", codeFilter("p", st.unwatchedPrefCodes));
  map.setFilter("my-town", codeFilter("c", st.myMuniCodes));
  map.setFilter("near-line", codeFilter("c", st.nearMuniCodes));
  // 過去のシーズンでは層の filter で隠す（点の source は替えない）
  map.setFilter("wild-bird-screening", wildBirdFilter("screening_positive", st.showWildBirds));
  map.setFilter("wild-bird-confirmed", wildBirdFilter("hpai_confirmed", st.showWildBirds));
  map.setPaintProperty("case-confirmed", "fill-color", st.confirmedColor);
  map.setPaintProperty("case-suspected", "fill-pattern", st.suspectedHatch);
}

/** 過去シーズンとの重ね合わせ（設計書 2026-11-06-data-explore E8、E14）。first と second は発生のあった町 */
export type OverlayShow = "both" | "one" | "two";
export interface OverlayState {
  first: readonly MuniCode[];
  second: readonly MuniCode[];
  show: OverlayShow;
  /** 確認できていない県。今季を比べに選んだときだけ入る */
  unwatchedPrefCodes: readonly PrefCode[];
}

/** 1 だけ、2 だけ、両方に分ける。見せ方が「1 だけ」「2 だけ」なら、その片方を全部 one か two に入れる */
export function overlayStyle(s: OverlayState): { one: MuniCode[]; two: MuniCode[]; both: MuniCode[] } {
  if (s.show === "one") return { one: [...s.first], two: [], both: [] };
  if (s.show === "two") return { one: [], two: [...s.second], both: [] };
  const second = new Set(s.second);
  const first = new Set(s.first);
  return {
    one: s.first.filter((c) => !second.has(c)),
    two: s.second.filter((c) => !first.has(c)),
    both: s.first.filter((c) => second.has(c)),
  };
}

/** 重ね合わせの 3 層と、確認できていない県の灰色の層を塗る。null なら全部を空にする（斜線の pref-unwatched は applyView に任せる） */
export function applyOverlay(map: ViewTarget, s: OverlayState | null): void {
  const st = s ? overlayStyle(s) : { one: [], two: [], both: [] };
  map.setFilter("cmp-one", codeFilter("c", st.one));
  map.setFilter("cmp-two", codeFilter("c", st.two));
  map.setFilter("cmp-both", codeFilter("c", st.both));
  map.setFilter("cmp-one-line", codeFilter("c", st.one));
  map.setFilter("cmp-two-line", codeFilter("c", st.two));
  map.setFilter("cmp-both-line", codeFilter("c", st.both));
  map.setFilter("pref-unwatched-flat", codeFilter("p", s ? s.unwatchedPrefCodes : []));
  if (s) map.setFilter("pref-unwatched", codeFilter("p", []));
}

/** 3 つ以上の比べ（設計書 2026-11-06-data-explore E12）。町ごとの色と、確認できていない県（今季を選んだときだけ） */
export interface LatestState {
  colors: ReadonlyArray<readonly [MuniCode, string]>;
  /** 選んだシーズン全体で 2 回以上発生した町と、その回数（事例の数。地図に「計◯回」の札。作者 11/7） */
  counts: ReadonlyArray<readonly [MuniCode, number]>;
  unwatchedPrefCodes: readonly PrefCode[];
}

/** 町ごとの色を cmp-latest の層に当てる。null なら空にする */
export function applyLatest(map: ViewTarget, s: LatestState | null): void {
  const colors = s?.colors ?? [];
  const codes = colors.map(([c]) => c);
  map.setFilter("cmp-latest", codeFilter("c", codes));
  map.setFilter("cmp-latest-line", codeFilter("c", codes));
  // match は組が 1 つ以上要る。空なら色は使われない（filter で何も通さない）
  const paint = colors.length > 0 ? ["match", ["get", "c"], ...colors.flatMap(([c, color]) => [c, color]), "#000000"] : "#000000";
  map.setPaintProperty("cmp-latest", "fill-color", paint);
  map.setPaintProperty("cmp-latest-line", "line-color", paint);
}

export interface WildBirdFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; t: WildBird["test"] };
}

/** 検査で否定された野鳥は除く。場所が分からないものは点にせず数だけ返す */
export function wildBirdFeatures(
  birds: readonly WildBird[],
  locate: (b: WildBird) => [number, number] | null,
): { features: WildBirdFeature[]; unplaced: number } {
  const features: WildBirdFeature[] = [];
  let unplaced = 0;
  for (const b of birds) {
    if (b.test === "negative") continue;
    const at = locate(b);
    if (!at) {
      unplaced++;
      continue;
    }
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { id: b.id, t: b.test } });
  }
  return { features, unplaced };
}

/** 野鳥の点を wild-birds の source に渡す（形の source には触らない） */
export function applyWildBirds(
  map: ViewTarget,
  birds: readonly WildBird[],
  locate: (b: WildBird) => [number, number] | null,
): { unplaced: number } {
  const { features, unplaced } = wildBirdFeatures(birds, locate);
  map.getSource("wild-birds")?.setData({ type: "FeatureCollection", features });
  return { unplaced };
}

/** 距離の輪を distance-rings の source に渡す。地点がなければ空にする */
export function applyDistanceRings(map: ViewTarget, rings: DistanceRings | null): void {
  map.getSource("distance-rings")?.setData(rings ?? { type: "FeatureCollection", features: [] });
}

/** 鶏舎の場所の印（印の大きさごとの形、farmMarkFeatures）を farm-mesh の source に渡す。場所がなければ空にする */
export function applyFarmMesh(map: ViewTarget, features: readonly FarmMarkFeature[]): void {
  map.getSource("farm-mesh")?.setData({ type: "FeatureCollection", features: [...features] });
}
