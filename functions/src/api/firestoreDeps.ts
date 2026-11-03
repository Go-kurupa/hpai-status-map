// 公開 API と公開 MCP が使う、Firestore と同梱データの読み口（X-12）。読み取りだけ。
// 農場（farms）、記録、運営者の箱は読まない。読むのは cases、wildBirds、watchStatus と同梱の過去の資料だけ。
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Case, HistoryCase, PrefCode, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { db } from "../admin";
import { loadGeoStore } from "../geo/loadGeo";
import type { ApiDeps } from "./handler";

/** 同梱の過去の資料（契約 1.3）。bundle の後は lib/data/history/cases.json。読めなければ throw（次の呼び出しでやり直す）。 */
export async function loadHistory(file: string = path.join(__dirname, "data", "history", "cases.json")): Promise<HistoryCase[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("過去の資料の形が違います");
  return parsed as HistoryCase[];
}

export const firestoreReaders = {
  async casesBySeason(season: Season, pref: PrefCode | null): Promise<Case[]> {
    const base = db.collection("cases").where("season", "==", season);
    const snap = await (pref === null ? base : base.where("prefCode", "==", pref)).get();
    return snap.docs.map((d) => d.data() as Case);
  },
  async wildBirdsBySeason(season: Season): Promise<WildBird[]> {
    return (await db.collection("wildBirds").where("season", "==", season).get()).docs.map((d) => d.data() as WildBird);
  },
  async watchStatuses(): Promise<WatchStatus[]> {
    return (await db.collection("watchStatus").get()).docs.map((d) => d.data() as WatchStatus);
  },
};

/** 実際の依存。地図の索引と過去の資料は 1 度読んで使い回す（失敗したら捨てて、次の呼び出しでやり直す）。 */
export function createFirestoreDeps(opts: { geoDir?: string; historyFile?: string } = {}): () => Promise<ApiDeps> {
  let cached: Promise<ApiDeps> | null = null;
  return () => {
    if (!cached) {
      cached = Promise.all([loadGeoStore(opts.geoDir), loadHistory(opts.historyFile)]).then(([geo, history]) => ({ ...firestoreReaders, history, geo }));
      cached.catch(() => {
        cached = null;
      });
    }
    return cached;
  };
}
