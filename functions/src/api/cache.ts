// プロセス内の短いキャッシュ（X-12 修正 1 回目、I-1）。認証なしの公開 API が Firestore の読み取りの費用を食われないようにする。
// 鍵ごとに ttlMs の間は同じ結果を返す。読み込み中は 1 つの Promise を共有し（同時の呼び出しは 1 回だけ読む）、失敗は残さない。

/** 鍵の数の上限。入力は検証済みで鍵は有限だが、万一の増え方に備える。 */
const MAX_KEYS = 500;

export function createCache(ttlMs: number, nowMs: () => number = Date.now): <T>(key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const now = nowMs();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    if (entries.size >= MAX_KEYS) {
      for (const [k, v] of entries) if (now - v.at >= ttlMs) entries.delete(k);
      if (entries.size >= MAX_KEYS) entries.clear();
    }
    const value = load();
    const entry = { at: now, value };
    entries.set(key, entry);
    value.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return value;
  };
}
