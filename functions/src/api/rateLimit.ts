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

/** ok: 通す。ip: その IP の上限を超えた（429）。shed: インスタンス全体の枠が尽きた（断らず、キャッシュから返す）。 */
export type RateDecision = "ok" | "ip" | "shed";

/**
 * (ip, nowMs) => 判定。IP ごとに、同じ分の中で limitPerMinute 回まで数える（shed の間も数え続ける）。超えたら ip（429、best-effort）。
 * インスタンス全体が globalPerMinute 回に達していたら shed。誰かが全員を止められないよう、shed は断らずにキャッシュから答える。
 * 全体の枠は IP の上限の中の要求だけが使う。数える IP が上限に達したら、新しい IP は表に足さず shed にする
 * （429 にも共有の鍵にもしない。攻撃者が表を埋めても、ほかの人を断らず、キャッシュから答える）。
 */
export function createRateLimiter(limitPerMinute: number, opts: RateLimitOptions = {}): (ip: string, nowMs: number) => RateDecision {
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
    const known = counts.get(ip);
    if (known === undefined && counts.size >= maxTracked) return "shed";
    const n = known ?? 0;
    if (n >= limitPerMinute) return "ip";
    counts.set(ip, n + 1);
    if (total >= globalLimit) return "shed";
    total++;
    return "ok";
  };
}

/** IPv4 マップ形の IPv6（::ffff:a.b.c.d、0:0:0:0:0:ffff:a.b.c.d、::ffff:c0a8:1 など）を IPv4 の書き方にする。それ以外はそのまま。 */
function unmapV4(ip: string): string {
  const hex = /^(?:(?:0{1,4}:){5}|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip.replace(/^(?:(?:0{1,4}:){5}|::)ffff:/i, "");
}

/** IPv6 の上位 64 ビット（/64）を「a:b:c:d::/64」の形にする。1 つの家庭や事業者が下位を自由に変えても、同じ相手として数える。 */
function v6Prefix64(ip: string): string {
  const [head = "", tail] = ip.split("::");
  const h = head === "" ? [] : head.split(":");
  const t = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * X-Forwarded-For の右端の値。IP の形でなければ "unknown"。IPv6 は /64 でまとめた値。
 * 左側は送り手が好きに書ける値（偽ると別の IP として数えられる）。右端は経路の前段（Google）が付けた側。
 * 本番での形（要素数と位置）は deploy の後に確かめる（docs/mcp-usage.md）。
 */
export function clientIp(xForwardedFor: string | string[] | undefined): string {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor.join(",") : xForwardedFor;
  const parts = raw?.split(",").map((x) => x.trim()).filter((x) => x !== "") ?? [];
  const last = unmapV4(parts[parts.length - 1] ?? "");
  const kind = isIP(last);
  return kind === 4 ? last : kind === 6 ? v6Prefix64(last) : "unknown";
}
