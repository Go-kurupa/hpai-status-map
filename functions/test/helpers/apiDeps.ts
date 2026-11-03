// 公開 API と公開 MCP の試験の道具（X-12）。本物の地図の索引と過去の資料に、偽の Firestore の読み口を組み合わせる。
import { readFileSync } from "node:fs";
import path from "node:path";
import type { GeoStore } from "@hpai/shared/geo";
import type { Case, HistoryCase, WatchStatus, WildBird } from "@hpai/shared/types";
import { PREFS } from "@hpai/shared/pref";
import { loadGeoStore } from "../../src/geo/loadGeo";
import type { ApiDeps } from "../../src/api/handler";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const GEO_DIR = path.join(ROOT, "data/geo");
export const HISTORY_FILE = path.join(ROOT, "data/history/cases.json");
export const HISTORY: HistoryCase[] = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as HistoryCase[];

/** 2026 年 11 月は 2026 シーズン。過去の資料（2020〜2025）は Firestore を読まない。 */
export const NOW = new Date("2026-11-04T03:00:00Z"); // JST 12:00

export const loadGeo = (): Promise<GeoStore> => loadGeoStore(GEO_DIR);

export function makeCase(over: Partial<Case> = {}): Case {
  return {
    id: "c1",
    season: 2026,
    nationalNo: 1,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: "採卵鶏",
    housing: "ウインドレス",
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://www.maff.go.jp/example/c1"],
    updatedAt: "2026-11-02T12:00:00+09:00",
    ...over,
  };
}

export function makeBird(over: Partial<WildBird> = {}): WildBird {
  return {
    id: "b1",
    season: 2026,
    date: "2026-11-01",
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    species: "ハクチョウ",
    test: "hpai_confirmed",
    focusZone: { from: null, to: null },
    sourceUrl: "https://www.env.go.jp/example/b1",
    ...over,
  };
}

/** 全県が直近に確認できている状態。overrides で県ごとに変える。 */
export function freshStatuses(over: Record<string, Partial<WatchStatus>> = {}): WatchStatus[] {
  return PREFS.map((p) => ({
    prefCode: p.code,
    checkedAt: "2026-11-04T11:00:00+09:00",
    ok: true,
    lastOkAt: "2026-11-04T11:00:00+09:00",
    failingSince: null,
    ...over[p.code],
  }));
}

export interface FakeSpec {
  cases?: Case[];
  birds?: WildBird[];
  statuses?: WatchStatus[];
  history?: HistoryCase[];
}

/** geometry の呼び出しを数える。calls.geometry が 0 のままであることを確かめる。 */
export async function makeDeps(spec: FakeSpec = {}): Promise<{ deps: ApiDeps; calls: { geometry: number; cases: number; birds: number; statuses: number } }> {
  const real = await loadGeo();
  const calls = { geometry: 0, cases: 0, birds: 0, statuses: 0 };
  const geo: GeoStore = {
    index: real.index,
    adjacency: real.adjacency,
    ensurePrefs: (p) => real.ensurePrefs(p),
    geometry: (code) => {
      calls.geometry++;
      return real.geometry(code);
    },
  };
  const deps: ApiDeps = {
    casesBySeason: async (season, pref) => {
      calls.cases++;
      return (spec.cases ?? []).filter((c) => c.season === season && (pref === null || c.prefCode === pref));
    },
    wildBirdsBySeason: async (season) => {
      calls.birds++;
      return (spec.birds ?? []).filter((b) => b.season === season);
    },
    watchStatuses: async () => {
      calls.statuses++;
      return spec.statuses ?? freshStatuses();
    },
    history: spec.history ?? HISTORY,
    geo,
  };
  return { deps, calls };
}

/** どの階層にもあってはいけない鍵（農場、地点、記録、会員）。見つけた鍵の経路を返す。 */
export const FORBIDDEN_KEYS = ["meshCode", "memberUids", "unsubscribedUids", "farmId", "kahoContact", "flockSize", "deaths", "uid"] as const;

export function findKeys(value: unknown, keys: readonly string[], here = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, keys, `${here}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(keys.includes(k) ? [`${here}.${k}`] : []), ...findKeys(v, keys, `${here}.${k}`)]);
  }
  return [];
}

/** 余分な項目を持つ文書（Firestore に誤って混ざった想定）。公開の応答に出てはいけない。 */
export const POISON = {
  meshCode: "52334557",
  memberUids: ["u-secret"],
  unsubscribedUids: [],
  farmId: "f-marker",
  kahoContact: "00-0000-0000",
  flockSize: 1234,
  deaths: 9,
  uid: "u-secret",
  operatorNote: "運営者の箱のメモ-MARKER",
};
