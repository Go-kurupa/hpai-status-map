// 会員の領域（M）の試験が使う見本。本番のコードは import しない（shared の exports は src だけ）。
import type { Farm, House, MeshCode, NotifySettings } from "../../src/types";
import { boxAround, makeGeo, type FakeGeoStore } from "../fixtures/geo";

/**
 * 新規の農場の notify。web/src/pages/settings/farmForm.ts の NEW_FARM_NOTIFY と同じ値にする
 * （web の試験が突き合わせる）。
 */
export const DEFAULT_NOTIFY_FIXTURE: NotifySettings = {
  level1: true,
  level2: true,
  level3: true,
  morningDigest: true,
  selfCheckRemindDays: null,
};

export const MESH_FIXTURE: MeshCode = "53394611"; // 千代田区の内

/** 偽の GeoStore の町。A、B は 33 県で隣り合い、C も 33 県、D は 34 県。 */
export const GEO_A = "33101";
export const GEO_B = "33102";
export const GEO_C = "33103";
export const GEO_D = "34101";

/** 県を読むまで geometry() が GeoNotLoadedError を投げる偽の GeoStore（契約 3.2）。 */
export function fakeGeo(opts: { preload?: boolean } = {}): FakeGeoStore {
  return makeGeo(
    [
      { code: GEO_A, name: "町A", geometry: boxAround(MESH_FIXTURE), neighbors: [GEO_B] },
      { code: GEO_B, name: "町B" },
      { code: GEO_C, name: "町C" },
      { code: GEO_D, name: "町D" },
    ],
    opts,
  );
}

/** farms/{id} の中身。キーは契約 2.3 の全部。 */
export function farmFixture(uid: string, over: Partial<Farm> = {}): Farm {
  return {
    name: "テスト農場",
    memberUids: [uid],
    unsubscribedUids: [],
    meshCode: MESH_FIXTURE,
    muniCode: "13101",
    prefCode: "13",
    frequentMuniCodes: [],
    production: null,
    housing: null,
    kahoContact: "",
    notify: { ...DEFAULT_NOTIFY_FIXTURE },
    selfCheckDue: {},
    updatedAt: "2026-11-03T09:00:00+09:00",
    ...over,
  };
}

export function houseFixture(over: Partial<House> = {}): House {
  return { name: "1 号舎", birdType: "採卵鶏", flockSize: 100, empty: false, ...over };
}
