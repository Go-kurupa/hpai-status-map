// SeasonView を地図の層に反映する。シーズンの切り替えは filter と paint を替えるだけで、
// 形の source（muni）の setData は呼ばない（形は最初に 1 度だけ渡す）。
// maplibre の Map ではなく、必要な 3 つの操作だけの型を受けるので、偽の map で試験できる。
import type { MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
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

export function applyView(map: ViewTarget, s: ViewState): void {
  const { view } = s;
  map.setFilter("case-suspected", codeFilter("c", view.suspectedMuniCodes));
  map.setFilter("case-confirmed", codeFilter("c", view.confirmedMuniCodes));
  // 過去の記録は閉じた記録なので、今日の見回りの失敗は重ねない
  map.setFilter("pref-unwatched", codeFilter("p", view.isCurrent ? s.failedPrefCodes : []));
  map.setFilter("my-town", codeFilter("c", s.myMuniCode ? [s.myMuniCode] : []));
  map.setFilter("near-line", codeFilter("c", s.nearMuniCodes));
  // 野鳥の記録は今季だけ。過去のシーズンでは層の filter で隠す（点の source は替えない）
  map.setFilter("wild-bird-screening", wildBirdFilter("screening_positive", view.isCurrent));
  map.setFilter("wild-bird-confirmed", wildBirdFilter("hpai_confirmed", view.isCurrent));
  // 今季は段階の色、過去は段階を表さない事実の色（設計書 §15）
  map.setPaintProperty("case-confirmed", "fill-color", view.isCurrent ? PAINT.current : PAINT.past);
  map.setPaintProperty("case-suspected", "fill-pattern", view.isCurrent ? PAINT.hatchCurrent : PAINT.hatchPast);
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
