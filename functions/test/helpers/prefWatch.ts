// 県の見回りの試験の道具（I-02）。実際の県のサイトへは出ない。取得は偽物で、politeFetch と同じく allowUrl を取得の前に判定する。
import type { GeoStore } from "@hpai/shared/geo";
import type { Source, SourceKind } from "@hpai/shared/types";
import type { WatchDeps } from "../../src/watch/deps";
import type { FetchOutcome, PoliteFetchOptions } from "../../src/watch/politeFetch";

export const BASE = "https://www.pref.okayama.jp";

export const html = (title: string, lines: string[], links: Array<[string, string]> = []): string =>
  `<html><head><meta charset="utf-8"><title>${title}</title></head><body><main>${lines.map((l) => `<p>${l}</p>`).join("")}${links
    .map(([href, text]) => `<p><a href="${href}">${text}</a></p>`)
    .join("")}</main></body></html>`;

export function ok(body: string | Buffer, url: string, contentType = "text/html; charset=utf-8"): FetchOutcome {
  return { kind: "ok", status: 200, finalUrl: url, contentType, body: Buffer.isBuffer(body) ? body : Buffer.from(body), etag: 'W/"x"', lastModified: "Tue, 05 Nov 2026 00:00:00 GMT", fetchedAt: "2026-11-05T12:00:00+09:00" };
}

export const pdf = (url: string, label = "pdf"): FetchOutcome => ok(Buffer.from(`%PDF-1.4 ${label} (文字層なし)`), url, "application/pdf");

export interface Fake {
  /** 実際に「外へ要求した」URL（allowUrl に拒否されたものは入らない）。 */
  calls: string[];
  /** allowUrl に拒否された URL。 */
  blocked: string[];
  /** 取得の引数（etag、lastModified を送っていないことの確認用）。 */
  opts: PoliteFetchOptions[];
  pages: Record<string, FetchOutcome>;
  now: Date;
}

export function fake(pages: Record<string, FetchOutcome> = {}, now = new Date("2026-11-05T03:00:00Z")): { deps: WatchDeps; f: Fake } {
  const f: Fake = { calls: [], blocked: [], opts: [], pages, now };
  const deps: WatchDeps = {
    geo: {} as GeoStore,
    now: () => f.now,
    fetch: async (url, opts = {}) => {
      f.opts.push(opts);
      if (opts.allowUrl && !opts.allowUrl(new URL(url))) {
        f.blocked.push(url);
        return { kind: "not_allowed", url };
      }
      f.calls.push(url);
      return f.pages[url] ?? { kind: "http_error", status: 404 };
    },
  };
  return { deps, f };
}

export function prefSource(o: Partial<Source> = {}): Source {
  return {
    id: "src1",
    prefCode: "33",
    url: `${BASE}/page/816850.html`,
    kind: "pref_fixed" as SourceKind,
    confirmedOn: "2026-11-03",
    note: null,
    group: 0,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 0,
    ...o,
  };
}
