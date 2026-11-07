// 比べの地図の広さのボタン（設計書 2026-11-06-data-explore E15）。1 段に［選択地域付近］［全国］と 8 地方。
// 押された印は、最後に押した 1 つだけ。どこへ寄せるかは地図を持つ側（MapPage）が決める
import type { MuniCode } from "@hpai/shared/types";
import { REGIONS, type RegionId } from "../../geo/regions";
import { CMP_TEXT } from "./compareTexts";
import "./compare.css";

export type Scope = "near" | "japan" | RegionId;

/** 地方の県の町。町のコードの先頭 2 桁が県のコード */
export function regionMuniCodes(id: RegionId, codes: Iterable<MuniCode>): MuniCode[] {
  const prefs = new Set(REGIONS.find((r) => r.id === id)?.prefCodes ?? []);
  return [...codes].filter((c) => prefs.has(c.slice(0, 2)));
}

export function ScopeButtons({
  hasNear,
  nearIsFarm = false,
  picked,
  onNear,
  onJapan,
  onRegion,
}: {
  /** 地域を選んでいるとき true。［選択地域付近］を出す */
  hasNear: boolean;
  /** 鶏舎の場所を決めている。［選択地域付近］を［鶏舎の付近］と呼ぶ */
  nearIsFarm?: boolean;
  picked: Scope;
  onNear: () => void;
  onJapan: () => void;
  onRegion: (id: RegionId) => void;
}) {
  return (
    <div className="cmp-scope" role="group" aria-label={CMP_TEXT.scopeAria}>
      {hasNear ? (
        <button type="button" aria-pressed={picked === "near"} onClick={onNear}>
          {nearIsFarm ? CMP_TEXT.scopeNearFarm : CMP_TEXT.scopeNear}
        </button>
      ) : null}
      <button type="button" aria-pressed={picked === "japan"} onClick={onJapan}>
        {CMP_TEXT.scopeJapan}
      </button>
      {REGIONS.map((r) => (
        <button key={r.id} type="button" aria-pressed={picked === r.id} onClick={() => onRegion(r.id)}>
          {r.name}
        </button>
      ))}
    </div>
  );
}
