// 公開 API と公開 MCP が使う、Firestore と同梱データの読み口（X-12）。読み取りだけ。
// 農場（farms）、記録、運営者の箱は読まない。読むのは cases、wildBirds、watchStatus と同梱の過去の資料だけ。
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Case, HistoryCase, PrefCode, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { db } from "../admin";
import { loadGeoStore } from "../geo/loadGeo";
import { createCache } from "./cache";
import type { ApiDeps } from "./handler";

/** 同梱の過去の資料（契約 1.3）。bundle の後は lib/data/history/cases.json。読めなければ throw（次の呼び出しでやり直す）。 */
export async function loadHistory(file: string = path.join(__dirname, "data", "history", "cases.json")): Promise<HistoryCase[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("過去の資料の形が違います");
  return parsed as HistoryCase[];
}

/** 公開の答えが使う項目だけを読む（文書にほかの項目があっても読まない。.select()）。 */
const CASE_FIELDS = [
  "id", "season", "nationalNo", "prefNo", "prefCode", "muniCode", "muniName", "birdUse", "housing", "headCount",
  "stages", "radiiKm", "prefEstimates", "negation", "negatedAt", "confirmState", "sourceUrls", "updatedAt",
] as const;
const BIRD_FIELDS = ["id", "season", "date", "prefCode", "muniCode", "muniName", "species", "test", "focusZone", "sourceUrl"] as const;
const WATCH_FIELDS = ["prefCode", "checkedAt", "ok", "lastOkAt", "failingSince"] as const;

/** 読み取りを Firestore へ出す口（キャッシュなし）。 */
export const firestoreReaders = {
  async casesBySeason(season: Season, pref: PrefCode | null): Promise<Case[]> {
    const base = db.collection("cases").where("season", "==", season);
    const snap = await (pref === null ? base : base.where("prefCode", "==", pref)).select(...CASE_FIELDS).get();
    return snap.docs.map((d) => d.data() as Case);
  },
  async wildBirdsBySeason(season: Season): Promise<WildBird[]> {
    return (await db.collection("wildBirds").where("season", "==", season).select(...BIRD_FIELDS).get()).docs.map((d) => d.data() as WildBird);
  },
  async watchStatuses(): Promise<WatchStatus[]> {
    return (await db.collection("watchStatus").select(...WATCH_FIELDS).get()).docs.map((d) => d.data() as WatchStatus);
  },
};

/** 認証なしの API が Firestore の読み取りの費用を食われないよう、プロセス内で 60 秒だけ使い回す（鍵: season、pref）。 */
export const READ_CACHE_MS = 60_000;
/**
 * (cacheOnly) => 読み口。cacheOnly のときは、期限が過ぎていてもキャッシュにあれば返し、Firestore を読まない
 * （インスタンス全体の上限のとき。キャッシュが無い最初の 1 回だけ読む）。
 */
export function cachedReaders(readers: typeof firestoreReaders, nowMs: () => number = Date.now): (cacheOnly: boolean) => typeof firestoreReaders {
  const cache = createCache(READ_CACHE_MS, nowMs);
  return (cacheOnly) => {
    const o = { staleOk: cacheOnly };
    return {
      casesBySeason: (season, pref) => cache(`cases:${season}:${pref ?? "all"}`, () => readers.casesBySeason(season, pref), o),
      wildBirdsBySeason: (season) => cache(`birds:${season}`, () => readers.wildBirdsBySeason(season), o),
      watchStatuses: () => cache("watch", () => readers.watchStatuses(), o),
    };
  };
}

/** 実際の依存。地図の索引と過去の資料は 1 度読んで使い回す（失敗したら捨てて、次の呼び出しでやり直す）。 */
export function createFirestoreDeps(opts: { geoDir?: string; historyFile?: string; readers?: (cacheOnly: boolean) => typeof firestoreReaders } = {}): (o?: { cacheOnly?: boolean }) => Promise<ApiDeps> {
  const readers = opts.readers ?? cachedReaders(firestoreReaders);
  let base: Promise<Pick<ApiDeps, "history" | "geo">> | null = null;
  return async (o) => {
    if (!base) {
      const p = Promise.all([loadGeoStore(opts.geoDir), loadHistory(opts.historyFile)]).then(([geo, history]) => ({ geo, history }));
      p.catch(() => {
        if (base === p) base = null;
      });
      base = p;
    }
    return { ...(await base), ...readers(o?.cacheOnly === true) };
  };
}
