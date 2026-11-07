// 市町村の形の読み込み（画面側）。契約 3.2 の loadWebGeoStore。
// 配るファイルは web/public/geo/（scripts/copy-web-data.ts が data/geo/ から写す）。
// 全国の形・県の形・索引は、それぞれ 1 度だけ取る（Promise を持つ）。失敗したら次の呼び出しでやり直せる。
import { createGeoStore, type GeoStore, type MuniEntry } from "@hpai/shared/geo";
import type { MuniCode, PrefCode } from "@hpai/shared/types";
import type { Topology } from "topojson-specification";

const base = () => `${import.meta.env.BASE_URL}geo/`;

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${base()}${file}`);
  if (!res.ok) throw new Error(`地図のデータを読み込めませんでした（${file}: ${res.status}）`);
  return (await res.json()) as T;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      p = load().catch((e: unknown) => {
        p = null; // 失敗は覚えない
        throw e;
      });
    }
    return p;
  };
}

/** 全国の市町村の形（表示用）。地図の source にする。1 度だけ取る */
export const loadJapanTopo = once(() => getJson<Topology>("japan.topo.json"));

/** 県ごとの代表の位置（バッジの場所）。[経度, 緯度] */
export const loadPrefAnchors = once(() => getJson<Record<PrefCode, [number, number]>>("pref-anchors.json"));

/** 索引と隣り合い。県の形は ensurePrefs で必要な県だけ読む */
export const loadWebGeoStore: () => Promise<GeoStore> = once(async () => {
  const [index, adjacency] = await Promise.all([
    getJson<Record<MuniCode, MuniEntry>>("muni-index.json"),
    getJson<Record<MuniCode, MuniCode[]>>("adjacency.json"),
  ]);
  return createGeoStore({ index, adjacency, loadPrefTopo: (p) => getJson<unknown>(`pref/${p}.topo.json`) });
});
