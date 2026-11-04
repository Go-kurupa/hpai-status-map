// 本番の見回りの組み立て（watchTick と opsAdmin の run-watch-now が共有する）。取得、時計、市町村、入口の読み書き、入口の種類ごとの確認をここで束ねる。
import { loadGeoStore } from "../geo/loadGeo";
import { maffHandlers } from "./maff";
import { moeHandlers } from "./moe";
import { pageHandlers } from "./page";
import { politeFetch } from "./politeFetch";
import { rssHandlers } from "./rss";
import { runWatch } from "./run";
import { firestoreIo, type TickReport } from "./tick";

/** 見回りを 1 回回す。group を渡さなければ、JST の時 % 3 の組（定期実行）。渡せばその組。 */
export async function runLiveWatch(group?: 0 | 1 | 2): Promise<TickReport> {
  const geo = await loadGeoStore();
  return runWatch({ fetch: politeFetch, now: () => new Date(), geo }, firestoreIo(), { ...maffHandlers, ...moeHandlers, ...pageHandlers, ...rssHandlers }, group);
}
