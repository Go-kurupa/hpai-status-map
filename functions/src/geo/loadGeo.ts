// data/geo/ から GeoStore を作る（サーバー用）。県の形は ensurePrefs が呼ばれるまで読まない。
// bundle の後は lib/data/geo/ に置かれるので、既定は path.join(__dirname, "data", "geo")（契約 1.3）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGeoStore, type GeoStore } from "@hpai/shared/geo";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

const stores = new Map<string, Promise<GeoStore>>();

/** 同じフォルダなら同じ GeoStore を返す（読んだ県を使い回す）。読めなければ throw し、次の呼び出しでやり直す。 */
export function loadGeoStore(baseDir: string = path.join(__dirname, "data", "geo")): Promise<GeoStore> {
  const dir = path.resolve(baseDir);
  let p = stores.get(dir);
  if (!p) {
    p = (async () => {
      const [index, adjacency] = await Promise.all([
        readJson(path.join(dir, "muni-index.json")),
        readJson(path.join(dir, "adjacency.json")),
      ]);
      return createGeoStore({
        index: index as GeoStore["index"],
        adjacency: adjacency as GeoStore["adjacency"],
        loadPrefTopo: (prefCode) => readJson(path.join(dir, "pref", `${prefCode}.topo.json`)),
      });
    })();
    p.catch(() => stores.delete(dir));
    stores.set(dir, p);
  }
  return p;
}
