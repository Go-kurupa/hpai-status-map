// 本番の DataSource。Firestore は購読を始めるときに初めて読み込む（公開の画面に Firebase を載せない）。
// firebase/* と ../firebase は動的 import だけ（routes.test.tsx が静的 import を禁じている）。
import type { Case, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { fetchHistory } from "./history";
import type { DataSource, Unsubscribe } from "./types";

interface Snapshot {
  metadata: { fromCache: boolean };
  docs: Array<{ id: string; data(): unknown }>;
}

interface Handlers {
  /** サーバーの結果（fromCache:false）が届いた */
  onServer(rows: unknown[]): void;
  /** 端末の控えだけ（fromCache:true） */
  onCache(): void;
  /** 初期化の失敗か、購読の error */
  onFailure(): void;
}

/**
 * コレクションを購読する。解除は同期で返し、初期化の途中で解除されたら購読を始めない。
 * 解除の後は cb を呼ばない。
 */
function subscribeCollection(name: string, season: Season | null, h: Handlers): Unsubscribe {
  let cancelled = false;
  let inner: (() => void) | null = null;

  void (async () => {
    try {
      const [{ getFirebase }, fs] = await Promise.all([import("../firebase"), import("firebase/firestore")]);
      const { db } = await getFirebase();
      if (cancelled) return;
      const base = fs.collection(db, name);
      const q = season === null ? base : fs.query(base, fs.where("season", "==", season));
      inner = fs.onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap: Snapshot) => {
          if (cancelled) return;
          if (snap.metadata.fromCache) {
            h.onCache();
            return;
          }
          h.onServer(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })));
        },
        () => {
          if (!cancelled) h.onFailure();
        },
      );
      if (cancelled) {
        inner();
        inner = null;
      }
    } catch {
      if (!cancelled) h.onFailure();
    }
  })();

  return () => {
    cancelled = true;
    if (inner) {
      inner();
      inner = null;
    }
  };
}

export function createLiveDataSource(): DataSource {
  return {
    mode: "live",
    now: () => new Date(),
    // cases と wildBirds は、読めていないとき（端末の控えだけ、error）に cb を呼ばない。
    // 空の一覧を渡すと「何もない」に見えるため（設計書 §2 の失敗）。
    subscribeCases: (season, cb) =>
      subscribeCollection("cases", season, {
        onServer: (rows) => cb(rows as Case[]),
        onCache: () => {},
        onFailure: () => {},
      }),
    subscribeWildBirds: (season, cb) =>
      subscribeCollection("wildBirds", season, {
        onServer: (rows) => cb(rows as WildBird[]),
        onCache: () => {},
        onFailure: () => {},
      }),
    // watchStatus は空の一覧が「確認できていない」を意味する。
    subscribeWatchStatus: (cb) =>
      subscribeCollection("watchStatus", null, {
        onServer: (rows) => cb(rows as WatchStatus[]),
        onCache: () => cb([]),
        onFailure: () => cb([]),
      }),
    loadHistory: fetchHistory,
  };
}
