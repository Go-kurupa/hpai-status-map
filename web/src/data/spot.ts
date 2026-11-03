// 端末の中の地点。保存するのは 3 次メッシュ（約 1km のマス目）と市町村だけで、緯度経度は残さず、サーバーへ送らない
// （設計書 §12、契約 3.10）。localStorage が使えない環境（プライベートな閲覧など）でも投げない。
import { latLngToMesh3, mesh3Center } from "@hpai/shared/mesh";
import type { FarmPoint, MuniCode } from "@hpai/shared/types";

export const SPOT_KEY = "hpai.spot.v1";
export const TOWN_KEY = "hpai.town.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MESH = /^\d{8}$/;
const MUNI = /^\d{5}$/;
const MAX_FREQUENT = 50;

/** 取り出すだけで例外になる環境があるので、getter も try の中で呼ぶ */
function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validMesh(code: unknown): code is string {
  if (typeof code !== "string" || !MESH.test(code)) return false;
  try {
    mesh3Center(code); // 2 次の桁が 8 以上など、メッシュにならない値を弾く
    return true;
  } catch {
    return false;
  }
}

/** 地図で選んだ場所を地点にする。緯度経度はここで 3 次メッシュに変わり、戻り値に残らない */
export function spotFromPick(lat: number, lng: number, muniCode: MuniCode, frequent: readonly MuniCode[]): FarmPoint {
  if (!MUNI.test(muniCode)) throw new RangeError(`市町村コードは 5 桁の数字です: ${muniCode}`);
  return {
    meshCode: latLngToMesh3(lat, lng),
    muniCode,
    frequentMuniCodes: [...new Set(frequent)].filter((c) => c !== muniCode),
  };
}

/** 保存された値を地点にする。余計なキーは捨て、形が違えば null。文字列なら JSON として読む */
export function parseSpot(raw: unknown): FarmPoint | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const { meshCode, muniCode, frequentMuniCodes } = o;
  if (!validMesh(meshCode)) return null;
  if (typeof muniCode !== "string" || !MUNI.test(muniCode)) return null;
  if (!Array.isArray(frequentMuniCodes) || frequentMuniCodes.length > MAX_FREQUENT) return null;
  if (!frequentMuniCodes.every((c) => typeof c === "string" && MUNI.test(c))) return null;
  return { meshCode, muniCode, frequentMuniCodes: [...(frequentMuniCodes as string[])] };
}

export function loadSpot(storage: StorageLike | null = defaultStorage()): FarmPoint | null {
  if (!storage) return null;
  try {
    return parseSpot(storage.getItem(SPOT_KEY));
  } catch {
    return null;
  }
}

/** 3 つのキーだけを書く（渡された値に余計なキーがあっても書かない）。書けたら true */
export function saveSpot(spot: FarmPoint, storage: StorageLike | null = defaultStorage()): boolean {
  const clean = parseSpot({ meshCode: spot.meshCode, muniCode: spot.muniCode, frequentMuniCodes: spot.frequentMuniCodes });
  if (!storage || !clean) return false;
  try {
    storage.setItem(SPOT_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function clearSpot(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SPOT_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 選んだ町（市町村コードだけ）。地点がない人の「自分の町」 */
export function loadTown(storage: StorageLike | null = defaultStorage()): MuniCode | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(TOWN_KEY);
    return typeof v === "string" && MUNI.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** null で消す。書けたら true */
export function saveTown(town: MuniCode | null, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (town === null) storage.removeItem(TOWN_KEY);
    else if (MUNI.test(town)) storage.setItem(TOWN_KEY, town);
    else return false;
    return true;
  } catch {
    return false;
  }
}
