// 再現用の DataSource。時計は order の出来事の時刻（時刻の記載がなければその日の 23:59:59 JST）で、
// Firestore には出ない。seek すると、購読している画面（地図）にその時点の事例と見回りの状況を渡す。
import { casesAt, REPLAY_SEASON, replayNowAt, watchAt, type ReplayScenario } from "@hpai/shared/replay";
import type { Case, HistoryCase, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import type { DataSource, Unsubscribe } from "../../data/types";

export class ReplayDataSource implements DataSource {
  readonly mode = "replay" as const;
  private order = 0;
  private readonly caseListeners = new Set<{ season: Season; cb: (cases: Case[]) => void }>();
  private readonly birdListeners = new Set<{ season: Season; cb: (birds: WildBird[]) => void }>();
  private readonly watchListeners = new Set<(all: WatchStatus[]) => void>();
  private readonly orderListeners = new Set<() => void>();

  constructor(
    private readonly scenario: ReplayScenario,
    private readonly history: () => Promise<HistoryCase[]>,
  ) {}

  now = (): Date => replayNowAt(this.scenario, this.order);

  currentOrder = (): number => this.order;

  seek = (order: number): void => {
    if (!Number.isInteger(order) || order < 0 || order > this.scenario.events.length) {
      throw new RangeError(`order は 0〜${this.scenario.events.length} の整数にしてください: ${order}`);
    }
    if (order === this.order) return;
    this.order = order;
    for (const l of this.caseListeners) l.cb(this.casesFor(l.season));
    for (const l of this.birdListeners) l.cb(this.birdsFor(l.season));
    for (const cb of this.watchListeners) cb(watchAt(this.scenario, this.order));
    for (const cb of this.orderListeners) cb();
  };

  /** 画面の帯が、今の order を読むための購読（useSyncExternalStore 用） */
  subscribeOrder = (cb: () => void): Unsubscribe => {
    this.orderListeners.add(cb);
    return () => {
      this.orderListeners.delete(cb);
    };
  };

  subscribeCases = (season: Season, cb: (cases: Case[]) => void): Unsubscribe => {
    const l = { season, cb };
    this.caseListeners.add(l);
    return this.deliver(
      () => this.caseListeners.has(l),
      () => cb(this.casesFor(season)),
      () => this.caseListeners.delete(l),
    );
  };

  subscribeWildBirds = (season: Season, cb: (birds: WildBird[]) => void): Unsubscribe => {
    const l = { season, cb };
    this.birdListeners.add(l);
    return this.deliver(
      () => this.birdListeners.has(l),
      () => cb(this.birdsFor(season)),
      () => this.birdListeners.delete(l),
    );
  };

  subscribeWatchStatus = (cb: (all: WatchStatus[]) => void): Unsubscribe => {
    this.watchListeners.add(cb);
    return this.deliver(
      () => this.watchListeners.has(cb),
      () => cb(watchAt(this.scenario, this.order)),
      () => this.watchListeners.delete(cb),
    );
  };

  loadHistory = (): Promise<HistoryCase[]> => this.history();

  /** 最初の 1 回は非同期に渡す（解除されていたら渡さない）。戻り値は解除 */
  private deliver(alive: () => boolean, send: () => void, remove: () => void): Unsubscribe {
    queueMicrotask(() => {
      if (alive()) send();
    });
    return () => {
      remove();
    };
  }

  private casesFor(season: Season): Case[] {
    return season === REPLAY_SEASON ? casesAt(this.scenario, this.order) : [];
  }

  private birdsFor(season: Season): WildBird[] {
    return season === REPLAY_SEASON ? this.scenario.wildBirds.filter((b) => b.season === season) : [];
  }
}
