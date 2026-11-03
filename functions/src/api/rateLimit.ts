// 認証なしの公開 API と公開 MCP の、メモリ内の回数制限（契約 4.1、毎分 60 回）。
// 1 分ごとの固定の窓。インスタンスごとに数えるので、厳密な全体の上限ではない（maxInstances が上限を決める）。
import { isIP } from "node:net";

/** 数える IP の最大数。偽の IP を大量に送られても、メモリを使い切らない。 */
const MAX_TRACKED_IPS = 10_000;

/**
 * (ip, nowMs) => 通してよいか。同じ分の中で limitPerMinute 回までは true、それを超えたら false。次の分は数え直す。
 * 数える IP が上限に達したら、新しい IP は数えずに通す（本物の利用者を止めない側に倒す）。
 */
export function createRateLimiter(limitPerMinute: number): (ip: string, nowMs: number) => boolean {
  let windowStart = -1;
  let counts = new Map<string, number>();
  return (ip, nowMs) => {
    const window = Math.floor(nowMs / 60_000);
    if (window !== windowStart) {
      windowStart = window;
      counts = new Map();
    }
    const n = counts.get(ip);
    if (n === undefined) {
      if (counts.size >= MAX_TRACKED_IPS) return true;
      counts.set(ip, 1);
      return limitPerMinute >= 1;
    }
    counts.set(ip, n + 1);
    return n + 1 <= limitPerMinute;
  };
}

/**
 * X-Forwarded-For の先頭の値。IP の形でなければ "unknown"。
 * 先頭は送り手が偽れる値（偽ると別の IP として数えられる）。
 */
export function clientIp(xForwardedFor: string | string[] | undefined): string {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
  const first = raw?.split(",")[0]?.trim().replace(/^::ffff:/i, "") ?? "";
  return isIP(first) !== 0 ? first : "unknown";
}
