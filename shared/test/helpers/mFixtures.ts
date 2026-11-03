// 会員の領域（M）の試験が使う見本。本番のコードは import しない（shared の exports は src だけ）。
import { latLngToMesh3, mesh3Center } from "../../src/mesh";
import type { Case, Farm, House, MeshCode, NotifySettings, WildBird } from "../../src/types";
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

// ── 通知（M-02）の試験が使う見本 ──

/** 農場のメッシュ。IN_A は町 A の箱の内、FAR_B は A から数百 km 離れた所（町 B と隣り合うが A とは遠い）、IN_D は町 D の箱の内。 */
export const IN_A: MeshCode = MESH_FIXTURE;
export const FAR_B: MeshCode = latLngToMesh3(34.9, 133.0);
export const IN_D: MeshCode = latLngToMesh3(30.005, 130.005);

/** 町 A（33101）で確定した事例。上書きできる。 */
export function caseFixture(over: Partial<Case> = {}): Case {
  return {
    id: "33101-2026-11-05-1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: GEO_A,
    muniName: "町A",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2026-11-05", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.test/pref/1.html"],
    updatedAt: "2026-11-05T12:00:00+09:00",
    ...over,
  };
}

/** 農場に id を足したもの（planCaseNotices に渡す形）。 */
export function farmWithId(id: string, uid: string, over: Partial<Farm> = {}): Farm & { id: string } {
  return { id, ...farmFixture(uid, over) };
}

const EARTH_RADIUS_KM = 6371.0088; // turf と同じ半径

/**
 * メッシュの中心から真東へ km の所に西の辺がある箱（中心は箱の外）。
 * 中心から子午線までの測地線の距離 d は sin(d/R) = cos(緯度)·sin(Δ経度) なので、そこから Δ経度を逆算する。
 */
export function boxEastOfMesh(mesh: MeshCode, km: number, widthDeg = 0.05, halfHeightDeg = 0.05): GeoJSON.Polygon {
  const { lat, lng } = mesh3Center(mesh);
  const dLng = (Math.asin(Math.sin(km / EARTH_RADIUS_KM) / Math.cos((lat * Math.PI) / 180)) * 180) / Math.PI;
  const west = lng + dLng;
  const ring: Array<[number, number]> = [
    [west, lat - halfHeightDeg],
    [west + widthDeg, lat - halfHeightDeg],
    [west + widthDeg, lat + halfHeightDeg],
    [west, lat + halfHeightDeg],
    [west, lat - halfHeightDeg],
  ];
  return { type: "Polygon", coordinates: [ring] };
}

// ── 野鳥、期限、死亡率の知らせ（M-13）の試験が使う見本 ──

/** 町 A の箱から北へ約 3km。町 A の野鳥は 10km 以内（FAR_B は遠い）。 */
export const NEAR_B: MeshCode = latLngToMesh3(mesh3Center(IN_A).lat + 0.05, mesh3Center(IN_A).lng);

/** 町 A で高病原性が確定した野鳥。上書きできる。 */
export function wildBirdFixture(over: Partial<WildBird> = {}): WildBird {
  return {
    id: "wb-2026-1",
    season: 2026,
    date: "2026-11-04",
    prefCode: "33",
    muniCode: GEO_A,
    muniName: "町A",
    species: "オオハクチョウ",
    test: "hpai_confirmed",
    focusZone: { from: null, to: null },
    sourceUrl: "https://example.test/moe/1.html",
    ...over,
  };
}
