// プロセス内の短いキャッシュ（X-12、I-1）。認証なしの公開 API が Firestore の読み取りの費用を食われないようにする。
// 鍵ごとに ttlMs の間は同じ結果を返す。読み込み中は 1 つの Promise を共有し（同時の呼び出しは 1 回だけ読む）、
// 失敗は短く（FAIL_MS）覚えて、障害の間に毎回読みにいかない。

/** 鍵の数の上限。入力は検証済みで鍵は有限だが、万一の増え方に備える。 */
const MAX_KEYS = 500;
/** 読みの失敗を覚える時間（ミリ秒）。この間は読み直さず、同じ失敗を返す。 */
export const FAIL_MS = 5_000;

export interface CacheOptions {
  /**
   * 期限（ttl）が過ぎていても、最大の古さ（maxStaleMs）までは返す（全体の上限のとき。Firestore を読まない）。
   * それを過ぎたら、鍵ごとに 1 本だけ読み直す。
   */
  staleOk?: boolean;
  /** 返した記録を読んだ時刻（ミリ秒）を受け取る。答えに「いつ読んだ記録か」を出すため。 */
  onRead?: (readAtMs: number) => void;
}

/** maxStaleMs の既定は ttl の 10 倍。 */
export function createCache(
  ttlMs: number,
  nowMs: () => number = Date.now,
  maxStaleMs: number = ttlMs * 10,
): <T>(key: string, load: () => Promise<T>, opts?: CacheOptions) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  const failures = new Map<string, { at: number; error: unknown }>();
  return <T>(key: string, load: () => Promise<T>, opts: CacheOptions = {}): Promise<T> => {
    const now = nowMs();
    const hit = entries.get(key);
    if (hit) {
      const age = now - hit.at;
      if (age < ttlMs || (opts.staleOk === true && age < maxStaleMs)) {
        opts.onRead?.(hit.at);
        return hit.value as Promise<T>;
      }
    }
    const failed = failures.get(key);
    if (failed) {
      if (now - failed.at < FAIL_MS) return Promise.reject(failed.error);
      failures.delete(key);
    }
    if (entries.size >= MAX_KEYS) {
      for (const [k, v] of entries) if (now - v.at >= maxStaleMs) entries.delete(k);
      if (entries.size >= MAX_KEYS) entries.clear();
    }
    const value = load();
    const entry = { at: now, value };
    entries.set(key, entry); // 読み込み中は新しい記録として共有する（同時の呼び出しは 1 回）
    opts.onRead?.(now);
    value.catch((error: unknown) => {
      // 読み直しに失敗したら、前の記録を戻す（最大の古さの中なら、全体の上限のとき使える）。
      if (entries.get(key) === entry) {
        if (hit) entries.set(key, hit);
        else entries.delete(key);
      }
      failures.set(key, { at: nowMs(), error });
    });
    return value;
  };
}
