import net from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  isProbeHostAllowed,
  probeTargets,
  serveProbe,
  tlsHandshake,
  type ProbeRow,
  type ProbeTarget,
} from "../src/probe/run";
import type { FetchOutcome } from "../src/watch/politeFetch";

const target = (url: string, kind: string, extra: Partial<ProbeTarget> = {}): ProbeTarget => ({
  prefCode: "33",
  url,
  kind,
  dev: null,
  ...extra,
});

const okOutcome = (body: string | Buffer, contentType = "text/html; charset=utf-8", finalUrl = "https://www.pref.example.lg.jp/x"): FetchOutcome => ({
  kind: "ok",
  status: 200,
  finalUrl,
  contentType,
  body: Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"),
  etag: null,
  lastModified: null,
  fetchedAt: "2026-11-04T09:00:00+09:00",
});

async function run(
  targets: ProbeTarget[],
  fetcher: (url: string) => Promise<FetchOutcome>,
  handshake?: (url: string) => Promise<{ code: string | null; tls: boolean }>,
): Promise<ProbeRow[]> {
  const rows: ProbeRow[] = [];
  await probeTargets(targets, (r) => rows.push(r), {
    fetcher: (url) => fetcher(url),
    handshake: handshake ?? (async () => ({ code: null, tls: false })),
  });
  return rows;
}

const TOP_PAGE = "<html><body><main><p>現在、発生は確認されておりません。</p></main></body></html>";
const HPAI_PAGE = "<html><head><title>高病原性鳥インフルエンザ</title></head><body><main><p>鳥インフルエンザに関する情報</p></main></body></html>";
const SCHOOL_PAGE = "<html><body><main><p>インフルエンザによる学校の臨時休業（第23報）</p></main></body></html>";

describe("許可するホスト", () => {
  it("go.jp、lg.jp、pref.<名>.jp（先頭の www と数字は可）だけ", () => {
    for (const ok of [
      "https://www.maff.go.jp/j/",
      "https://maps.gsi.go.jp/x",
      "https://www.pref.okayama.jp/",
      "https://pref.aichi.jp/",
      "https://www2.pref.fukui.lg.jp/x",
      "https://www.pref.hokkaido.lg.jp/",
      "https://www.pref.ehime.jp/",
      "https://www.maff.go.jp:443/j/",
      "http://www.maff.go.jp:80/j/",
      "https://www.maff.go.jp:80/j/",
    ])
      expect(isProbeHostAllowed(new URL(ok)), ok).toBe(true);
    for (const ng of [
      "https://9a35b2b1.viewer.kintoneapp.com/public/x",
      "https://www.go.jp.evil.example.test/",
      "https://evil-go.jp/",
      "https://example.test/pref.okayama.jp",
      "https://www.pref.okayama.jp.evil.test/",
      "https://x.pref.okayama.jp/",
      "ftp://www.maff.go.jp/",
      "https://www.maff.go.jp:8443/",
      "https://www.maff.go.jp:22/",
      "http://www.pref.okayama.jp:8080/",
    ])
      expect(isProbeHostAllowed(new URL(ng)), ng).toBe(false);
  });
});

describe("probeTargets: 200 のときの verdict", () => {
  it("hpai_fixed は語があれば ok、なければ（平時の本文や学校の休業だけ）reached_no_content", async () => {
    const pages: Record<string, string> = {
      "https://www.pref.a.lg.jp/hpai": HPAI_PAGE,
      "https://www.pref.b.lg.jp/top": TOP_PAGE,
      "https://www.pref.c.lg.jp/school": SCHOOL_PAGE,
    };
    const rows = await run(
      Object.keys(pages).map((u) => target(u, "hpai_fixed")),
      async (u) => okOutcome(pages[u]!, "text/html; charset=utf-8", u),
    );
    expect(rows.map((r) => [r.verdict, r.hasWord])).toEqual([
      ["ok", true],
      ["reached_no_content", false],
      ["reached_no_content", false],
    ]);
    expect(rows[0]).toMatchObject({ status: 200, finalUrl: "https://www.pref.a.lg.jp/hpai", errorCode: null, itemCount: 0 });
    expect(rows[0]!.bytes).toBe(Buffer.byteLength(HPAI_PAGE));
    expect(rows[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it("dept_page、season_parent、press_list、reference、maff_press、maff_arc は語がなくても ok（hasWord は残す）", async () => {
    for (const kind of ["dept_page", "season_parent", "press_list", "reference", "maff_press", "maff_arc"]) {
      const [row] = await run([target("https://www.pref.example.lg.jp/p", kind)], async () => okOutcome(TOP_PAGE));
      expect(row, kind).toMatchObject({ verdict: "ok", hasWord: false });
      const [withWord] = await run([target("https://www.pref.example.lg.jp/p", kind)], async () => okOutcome(HPAI_PAGE));
      expect(withWord, kind).toMatchObject({ verdict: "ok", hasWord: true });
    }
  });

  it("rss* は項目が 1 つ以上で ok（RSS 2.0、RDF、Atom）", async () => {
    const rss2 = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>新着</title><item><title>a</title><link>https://x.test/a</link></item><item><title>b</title></item></channel></rss>`;
    const rdf = `<?xml version="1.0" encoding="UTF-8"?><rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel rdf:about="x"><title>t</title></channel><item rdf:about="a"><title>鳥インフルエンザの情報</title></item></rdf:RDF>`;
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><entry><title>e1</title></entry><entry><title>e2</title></entry><entry><title>e3</title></entry></feed>`;
    const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>空</title></channel></rss>`;
    const bodies: Record<string, string> = { "https://x.go.jp/rss2": rss2, "https://x.go.jp/rdf": rdf, "https://x.go.jp/atom": atom, "https://x.go.jp/empty": empty };
    for (const kind of ["rss_all", "rss_press", "rss_dept"]) {
      const rows = await run(
        Object.keys(bodies).map((u) => target(u, kind)),
        async (u) => okOutcome(bodies[u]!, "application/xml", u),
      );
      expect(rows.map((r) => [r.verdict, r.itemCount]), kind).toEqual([
        ["ok", 2],
        ["ok", 1],
        ["ok", 3],
        ["reached_no_content", 0],
      ]);
      expect(rows[1]!.hasWord).toBe(true);
      expect(rows[0]!.hasWord).toBe(false);
    }
  });

  it("PDF は %PDF 始まりで ok、そうでなければ reached_no_content", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 1, 2, 3])]);
    const [okRow] = await run([target("https://www.maff.go.jp/j/x.pdf", "maff_season", { prefCode: null })], async () => okOutcome(pdf, "application/pdf"));
    expect(okRow).toMatchObject({ verdict: "ok", bytes: pdf.length, itemCount: 0 });
    const [html] = await run([target("https://www.maff.go.jp/j/x.pdf", "maff_season", { prefCode: null })], async () => okOutcome("<html>エラーページ</html>"));
    expect(html!.verdict).toBe("reached_no_content");
  });

  it("画像などの reference は本文を読まずに ok", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    const [row] = await run([target("https://cyberjapandata.gsi.go.jp/xyz/pale/5/28/12.png", "reference", { prefCode: null })], async () => okOutcome(png, "image/png"));
    expect(row).toMatchObject({ verdict: "ok", hasWord: false, bytes: png.length });
  });

  it("国の月別一覧の題「高病原性鳥インフルエンザの疑似患畜の確認」を outbreakTitleCount に数える", async () => {
    const html = `<html><body><div id="main_content"><ul>
      <li><a href="/j/press/syouan/douei/251220.html">高病原性鳥インフルエンザの疑似患畜の確認について（今シーズン国内8例目）</a></li>
      <li><a href="/j/press/syouan/douei/251221.html">高病原性鳥イ&#x30F3;フルエンザの疑似患畜の確認について（今シーズン国内9例目）</a></li>
      <li><a href="/j/press/syouan/douei/251222.html">高病原性鳥インフルエンザに関する防疫措置の完了について</a></li>
      <li><a href="/j/press/other.html">令和7年度の補正予算について</a></li>
      <li><a href="/j/press/syouan/douei/251220.html">高病原性鳥インフルエンザの疑似患畜の確認について（今シーズン国内8例目）</a></li>
      </ul></div></body></html>`;
    const [row] = await run([target("https://www.maff.go.jp/j/press/arc/2512.html", "maff_arc", { prefCode: null })], async () => okOutcome(html, "text/html", "https://www.maff.go.jp/j/press/arc/2512.html"));
    expect(row).toMatchObject({ verdict: "ok", outbreakTitleCount: 2 });
  });

  it("RSS の題も outbreakTitleCount に数える", async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>高病原性鳥インフルエンザの疑似患畜の確認について</title></item><item><title>別件</title></item></channel></rss>`;
    const [row] = await run([target("https://www.maff.go.jp/rss.xml", "rss_press", { prefCode: null })], async () => okOutcome(rss, "application/xml"));
    expect(row).toMatchObject({ itemCount: 2, outbreakTitleCount: 1 });
  });
});

describe("probeTargets: 200 以外", () => {
  it("許可外（kintoneapp.com を含む）は not_allowed で fetcher も handshake も呼ばない", async () => {
    const fetcher = vi.fn();
    const handshake = vi.fn();
    const rows: ProbeRow[] = [];
    await probeTargets(
      [target("https://9a35b2b1.viewer.kintoneapp.com/public/xxx", "hpai_fixed"), target("https://example.test/", "hpai_fixed"), target("ftp://www.maff.go.jp/x", "hpai_fixed")],
      (r) => rows.push(r),
      { fetcher, handshake },
    );
    expect(rows.map((r) => r.verdict)).toEqual(["not_allowed", "not_allowed", "not_allowed"]);
    expect(rows.every((r) => r.status === null && r.bytes === 0)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(handshake).not.toHaveBeenCalled();
  });

  it("fetcher には allowUrl（許可の判定）を渡す。リダイレクトの先も同じ規則で止める", async () => {
    const seen: Array<((u: URL) => boolean) | undefined> = [];
    await probeTargets([target("https://www.pref.a.lg.jp/x", "hpai_fixed")], () => {}, {
      fetcher: async (_url, opts) => {
        seen.push(opts?.allowUrl);
        return okOutcome(HPAI_PAGE);
      },
      handshake: async () => ({ code: null, tls: false }),
    });
    expect(seen[0]?.(new URL("https://www.pref.a.lg.jp/y"))).toBe(true);
    expect(seen[0]?.(new URL("https://evil.kintoneapp.com/y"))).toBe(false);
  });

  it("robots_denied、not_allowed（リダイレクトの先）、http_error をそのまま写す", async () => {
    const outcomes: Record<string, FetchOutcome> = {
      "https://www.pref.a.lg.jp/1": { kind: "robots_denied" },
      "https://www.pref.a.lg.jp/2": { kind: "not_allowed", url: "https://x.kintoneapp.com/" },
      "https://www.pref.a.lg.jp/3": { kind: "http_error", status: 404 },
      "https://www.pref.a.lg.jp/4": { kind: "not_modified" },
      "https://www.pref.a.lg.jp/5": { kind: "http_error", status: 503, code: "robots_unavailable" },
    };
    const rows = await run(
      Object.keys(outcomes).map((u) => target(u, "hpai_fixed")),
      async (u) => outcomes[u]!,
    );
    expect(rows.map((r) => [r.verdict, r.status])).toEqual([
      ["robots_denied", null],
      ["not_allowed", null],
      ["http_error", 404],
      ["http_error", 304],
      ["http_error", 503],
    ]);
    // robots.txt の失敗は errorCode で本体の失敗と区別する
    expect(rows.map((r) => r.errorCode)).toEqual([null, null, null, null, "robots_unavailable"]);
  });

  it("network_error のときだけ handshake を 1 回呼び、tls:true なら tls_error（errorCode は握手の code）", async () => {
    const handshake = vi.fn(async () => ({ code: "EPROTO", tls: true }));
    const [row] = await run(
      [target("https://www.gsi.go.jp/LAW/2930-index.html", "reference", { prefCode: null })],
      async () => ({ kind: "network_error", message: "fetch failed", code: "UND_ERR_CONNECT_TIMEOUT", tls: false }),
      handshake,
    );
    expect(row).toMatchObject({ verdict: "tls_error", errorCode: "EPROTO", status: null });
    expect(handshake).toHaveBeenCalledTimes(1);
    expect(handshake).toHaveBeenCalledWith("https://www.gsi.go.jp/LAW/2930-index.html");
  });

  it("握手で tls:false なら network_error（errorCode は fetch の code）", async () => {
    const handshake = vi.fn(async () => ({ code: "ECONNRESET", tls: false }));
    const [row] = await run(
      [target("https://www.pref.a.lg.jp/x", "hpai_fixed")],
      async () => ({ kind: "network_error", message: "fetch failed", code: "ECONNRESET", tls: false }),
      handshake,
    );
    expect(row).toMatchObject({ verdict: "network_error", errorCode: "ECONNRESET" });
    expect(handshake).toHaveBeenCalledTimes(1);
  });

  it("fetch の時点で tls:true と分かっていれば、握手は試さず tls_error", async () => {
    const handshake = vi.fn();
    const [row] = await run(
      [target("https://www.pref.a.lg.jp/x", "hpai_fixed")],
      async () => ({ kind: "network_error", message: "x", code: "CERT_HAS_EXPIRED", tls: true }),
      handshake as never,
    );
    expect(row).toMatchObject({ verdict: "tls_error", errorCode: "CERT_HAS_EXPIRED" });
    expect(handshake).not.toHaveBeenCalled();
  });

  it("network_error 以外では handshake を呼ばない", async () => {
    const handshake = vi.fn(async () => ({ code: null, tls: false }));
    await run([target("https://www.pref.a.lg.jp/x", "hpai_fixed")], async () => okOutcome(HPAI_PAGE), handshake);
    await run([target("https://www.pref.a.lg.jp/x", "hpai_fixed")], async () => ({ kind: "http_error", status: 500 }), handshake);
    expect(handshake).not.toHaveBeenCalled();
  });

  it("握手が例外でも network_error に落ちるだけ", async () => {
    const [row] = await run(
      [target("https://www.pref.a.lg.jp/x", "hpai_fixed")],
      async () => ({ kind: "network_error", message: "x", code: "ENOTFOUND", tls: false }),
      async () => {
        throw new Error("boom");
      },
    );
    expect(row).toMatchObject({ verdict: "network_error", errorCode: "ENOTFOUND" });
  });

  it("1 件の失敗で止めない（fetcher が例外を投げても次へ）", async () => {
    const rows = await run(
      [target("https://www.pref.a.lg.jp/1", "hpai_fixed"), target("https://www.pref.a.lg.jp/2", "hpai_fixed")],
      async (u) => {
        if (u.endsWith("/1")) throw new Error("想定外");
        return okOutcome(HPAI_PAGE, "text/html", u);
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ verdict: "network_error", status: null });
    expect(rows[1]).toMatchObject({ verdict: "ok" });
  });

  it("同じホストは順に、別のホストは同時に（同時 10 ホストまで）", async () => {
    let active = 0;
    let maxActive = 0;
    const perHostActive = new Map<string, number>();
    let maxPerHost = 0;
    const targets = Array.from({ length: 25 }, (_, i) => target(`https://www.pref.h${i % 15}.lg.jp/p${i}`, "hpai_fixed"));
    const rows = await run(targets, async (u) => {
      const host = new URL(u).host;
      active++;
      perHostActive.set(host, (perHostActive.get(host) ?? 0) + 1);
      maxActive = Math.max(maxActive, active);
      maxPerHost = Math.max(maxPerHost, perHostActive.get(host)!);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      perHostActive.set(host, perHostActive.get(host)! - 1);
      return okOutcome(HPAI_PAGE, "text/html", u);
    });
    expect(rows).toHaveLength(25);
    expect(maxPerHost).toBe(1);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(10);
  });
});

describe("tlsHandshake（実物）", () => {
  it("node:net の一時サーバーが平文を返すと、TLS の失敗（tls:true）になる", async () => {
    const server = net.createServer((socket) => {
      socket.on("data", () => socket.end("HTTP/1.1 400 Bad Request\r\n\r\nplain\r\n"));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const result = await tlsHandshake(`https://127.0.0.1:${port}/`);
      expect(result.tls).toBe(true);
      expect(result.code).toMatch(/^(EPROTO|ERR_SSL_)/);
    } finally {
      server.close();
    }
  }, 20_000);

  it("http の URL や、閉じたポートでは tls:false", async () => {
    expect(await tlsHandshake("http://127.0.0.1:9/")).toEqual({ code: null, tls: false });
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const closed = await tlsHandshake(`https://127.0.0.1:${port}/`);
    expect(closed).toMatchObject({ tls: false });
  }, 20_000);
});

describe("serveProbe（probeEntrances の中身）", () => {
  class FakeRes {
    statusCode = 0;
    headers: Record<string, string> = {};
    chunks: string[] = [];
    flushed = false;
    ended = false;
    order: string[] = [];
    status(code: number) {
      this.statusCode = code;
      return this;
    }
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    flushHeaders() {
      this.flushed = true;
      this.order.push("flush");
    }
    write(chunk: string) {
      this.order.push("write");
      this.chunks.push(chunk);
      return true;
    }
    json(body: unknown) {
      this.chunks.push(JSON.stringify(body));
      return this;
    }
    end() {
      this.ended = true;
    }
  }
  const req = (body: unknown, auth: string | undefined = "Bearer s3cret", method = "POST") => ({
    method,
    body,
    get: (n: string) => (n.toLowerCase() === "authorization" ? auth : undefined),
  });
  const deps = {
    fetcher: async (u: string) => okOutcome(HPAI_PAGE, "text/html", u),
    handshake: async () => ({ code: null, tls: false }),
  };

  it("認証できなければ 401 で何も取らない", async () => {
    const fetcher = vi.fn();
    const res = new FakeRes();
    await serveProbe(req({ targets: [] }, "Bearer wrong"), res as never, "s3cret", { ...deps, fetcher });
    expect(res.statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("POST 以外は 405、本文が違えば 400", async () => {
    const r1 = new FakeRes();
    await serveProbe(req({ targets: [] }, "Bearer s3cret", "GET"), r1 as never, "s3cret", deps);
    expect(r1.statusCode).toBe(405);
    for (const bad of [null, [], { targets: "x" }, { targets: [{ url: "x" }] }, { targets: [{ prefCode: null, url: "not a url", kind: "k", dev: null }] }]) {
      const r = new FakeRes();
      await serveProbe(req(bad), r as never, "s3cret", deps);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it("頭を先に送り、1 件ごとに 1 行の NDJSON を write する", async () => {
    const res = new FakeRes();
    const targets = [target("https://www.pref.a.lg.jp/1", "hpai_fixed"), target("https://www.pref.b.lg.jp/2", "dept_page", { dev: { ok: true, hasWord: null } })];
    await serveProbe(req({ targets }), res as never, "s3cret", deps);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.order[0]).toBe("flush");
    expect(res.order.filter((o) => o === "write")).toHaveLength(2);
    expect(res.ended).toBe(true);
    const rows = res.chunks.map((c) => {
      expect(c.endsWith("\n")).toBe(true);
      expect(c.trim().split("\n")).toHaveLength(1);
      return JSON.parse(c) as ProbeRow;
    });
    expect(rows.map((r) => r.target.url).sort()).toEqual(["https://www.pref.a.lg.jp/1", "https://www.pref.b.lg.jp/2"]);
    expect(rows.find((r) => r.target.kind === "dept_page")!.target.dev).toEqual({ ok: true, hasWord: null });
    // 本文を返さない
    for (const c of res.chunks) expect(c).not.toContain("鳥インフルエンザに関する情報");
  });
});
