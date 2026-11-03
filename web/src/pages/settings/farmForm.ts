// 農場の設定の純粋な部分。緯度経度はここで約 1km のマス目に直し、呼び出し元は座標を持ち続けない。
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { MuniEntry } from "@hpai/shared/geo";
import type { Farm, IsoDateTime, NotifySettings, Season } from "@hpai/shared/types";

/**
 * 新しい農場の知らせの既定【計】。段階ごとの知らせと朝のまとめは入り、期限の知らせは切れている。
 * shared/test/helpers/mFixtures.ts の DEFAULT_NOTIFY_FIXTURE と同じ値（record-store の試験が突き合わせる）。
 */
export const NEW_FARM_NOTIFY: NotifySettings = {
  level1: true,
  level2: true,
  level3: true,
  morningDigest: true,
  selfCheckRemindDays: null,
};

/**
 * 地図で指した地点を、保存する項目にする。緯度経度は返さない（メッシュと町のコードだけ）。
 * 範囲の外の座標は RangeError。
 */
export function pickToFarmPatch(
  pick: { lat: number; lng: number },
  muni: MuniEntry,
): Pick<Farm, "meshCode" | "muniCode" | "prefCode"> {
  return { meshCode: latLngToMesh3(pick.lat, pick.lng), muniCode: muni.code, prefCode: muni.prefCode };
}

/** 選んだ町の枠（西南東北）の中か。枠の外は町の外なので、取り違えを止める。 */
export function insideMuniBox(pick: { lat: number; lng: number }, muni: MuniEntry): boolean {
  const [west, south, east, north] = muni.bbox;
  return pick.lng >= west && pick.lng <= east && pick.lat >= south && pick.lat <= north;
}

/** 自己点検の期限を決める月。シーズン season の 10 月から翌年 5 月まで（"2026-10"〜"2027-05"）。 */
export function seasonMonths(season: Season): string[] {
  const months: string[] = [];
  for (const m of [10, 11, 12]) months.push(`${season}-${String(m).padStart(2, "0")}`);
  for (const m of [1, 2, 3, 4, 5]) months.push(`${season + 1}-${String(m).padStart(2, "0")}`);
  return months;
}

/** 「最終保存 12月19日 14:05」。Farm.updatedAt（JST の ISO 8601）をそのまま読む。読めなければ null */
export function savedAtLabel(updatedAt: IsoDateTime | undefined): string | null {
  const m = updatedAt ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(updatedAt) : null;
  if (!m) return null;
  try {
    return `最終保存 ${formatJaDate(m[1]!)} ${m[2]}`;
  } catch {
    return null;
  }
}
