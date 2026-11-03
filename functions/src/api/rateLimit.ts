// 認証なしの公開 API と公開 MCP の、メモリ内の回数制限（契約 4.1、毎分 60 回）。
// 1 分ごとの固定の窓。IP ごとの上限と、インスタンス全体の上限の両方で止める（どちらも超えたら 429、fail-closed）。
// インスタンスごとに数えるので、厳密な全体の上限ではない（maxInstances が全体を決める）。
import { isIP } from "node:net";

export interface RateLimitOptions {
  /** インスタンス全体で通す回数（毎分）。IP ごとの上限を通った要求だけを数える。 */
  globalPerMinute?: number;
  /** 数える IP の最大数。超えたら新しい IP は通さない。 */
  maxTrackedIps?: number;
}

export const INSTANCE_LIMIT_PER_MINUTE = 600;
const MAX_TRACKED_IPS = 10_000;

/**
 * (ip, nowMs) => 通してよいか。同じ分の中で IP ごとに limitPerMinute 回まで、インスタンス全体で globalPerMinute 回までは true。
 * 1 つの IP が叩き続けても、全体の枠は IP の上限までしか使えない。全体の枠が尽きたら、新しい IP は数えずに断る。
 */
export function createRateLimiter(limitPerMinute: number, opts: RateLimitOptions = {}): (ip: string, nowMs: number) => boolean {
  const globalLimit = opts.globalPerMinute ?? INSTANCE_LIMIT_PER_MINUTE;
  const maxTracked = opts.maxTrackedIps ?? MAX_TRACKED_IPS;
  let windowStart = -1;
  let counts = new Map<string, number>();
  let total = 0;
  return (ip, nowMs) => {
    const window = Math.floor(nowMs / 60_000);
    if (window !== windowStart) {
      windowStart = window;
      counts = new Map();
      total = 0;
    }
    const n = counts.get(ip);
    if (n !== undefined && n >= limitPerMinute) return false;
    if (total >= globalLimit) return false;
    if (n === undefined) {
      if (counts.size >= maxTracked || limitPerMinute < 1) return false;
      counts.set(ip, 1);
    } else {
      counts.set(ip, n + 1);
    }
    total++;
    return true;
  };
}

/**
 * X-Forwarded-For の右端の値。IP の形でなければ "unknown"。
 * 左側は送り手が好きに書ける値（偽ると別の IP として数えられる）。右端は経路の前段（Google）が付けた側。
 * 本番での形（要素数と位置）は deploy の後に確かめる（docs/mcp-usage.md）。
 */
export function clientIp(xForwardedFor: string | string[] | undefined): string {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor.join(",") : xForwardedFor;
  const parts = raw?.split(",").map((x) => x.trim()).filter((x) => x !== "") ?? [];
  const last = (parts[parts.length - 1] ?? "").replace(/^::ffff:/i, "");
  return isIP(last) !== 0 ? last : "unknown";
}
