// 地方の区分（設計書 2026-11-06-data-explore 4 章）。県のコードから決まる。「条件で見る」と比べの地図の両方が使う。
import type { PrefCode } from "@hpai/shared/types";

export type RegionId = "hokkaido" | "tohoku" | "kanto" | "chubu" | "kinki" | "chugoku" | "shikoku" | "kyushu";

const range = (from: number, to: number): PrefCode[] => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, "0"));

/** よく使われる 8 地方。北から */
export const REGIONS: ReadonlyArray<{ id: RegionId; name: string; prefCodes: readonly PrefCode[] }> = [
  { id: "hokkaido", name: "北海道", prefCodes: range(1, 1) },
  { id: "tohoku", name: "東北", prefCodes: range(2, 7) },
  { id: "kanto", name: "関東", prefCodes: range(8, 14) },
  { id: "chubu", name: "中部", prefCodes: range(15, 23) },
  { id: "kinki", name: "近畿", prefCodes: range(24, 30) },
  { id: "chugoku", name: "中国", prefCodes: range(31, 35) },
  { id: "shikoku", name: "四国", prefCodes: range(36, 39) },
  { id: "kyushu", name: "九州・沖縄", prefCodes: range(40, 47) },
];

const BY_PREF = new Map(REGIONS.flatMap((r) => r.prefCodes.map((p) => [p, r.id] as const)));

export function regionOf(prefCode: PrefCode): RegionId {
  const id = BY_PREF.get(prefCode);
  if (!id) throw new Error(`県のコードが違います: ${prefCode}`);
  return id;
}

/** URL の値（?region=）を地方にする。知らない値は null */
export function parseRegion(value: string | null): RegionId | null {
  return REGIONS.some((r) => r.id === value) ? (value as RegionId) : null;
}
