// E2E 専用の DataSource。source.ts の `import.meta.env.MODE === "e2e"` の分岐の中だけで使われ、
// 本番の build では取り除かれる。副作用を持たないこと（tree-shake のため）。
import type { Case, HistoryCase, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { fetchHistory } from "./history";
import type { DataSource, Unsubscribe } from "./types";

export interface HpaiFixture {
  /** ISO 8601。公開の画面の時計 */
  now: string;
  cases: Case[];
  wildBirds: WildBird[];
  watch: WatchStatus[];
  /** なければ /history/cases.json を読む */
  history?: HistoryCase[];
}

/** 非同期に 1 度だけ渡す。解除されていたら渡さない */
function deliver<T>(rows: T, cb: (rows: T) => void): Unsubscribe {
  let off = false;
  queueMicrotask(() => {
    if (!off) cb(rows);
  });
  return () => {
    off = true;
  };
}

export function createFixtureDataSource(fx: HpaiFixture): DataSource {
  const fixed = new Date(fx.now);
  const bySeason = <T extends { season: Season }>(rows: T[], season: Season): T[] => rows.filter((r) => r.season === season);
  return {
    mode: "live",
    now: () => new Date(fixed),
    subscribeCases: (season, cb) => deliver(bySeason<Case>(fx.cases, season), cb),
    subscribeWildBirds: (season, cb) => deliver(bySeason<WildBird>(fx.wildBirds, season), cb),
    subscribeWatchStatus: (cb) => deliver<WatchStatus[]>(fx.watch, cb),
    loadHistory: () => (fx.history ? Promise.resolve(fx.history) : fetchHistory()),
  };
}
