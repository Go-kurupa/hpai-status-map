import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch, USER_AGENT } from "../src/watch/politeFetch";

// node:http の一時サーバーだけを相手にする。外へは出ない。
interface Seen {
  path: string;
  t: number;
  headers: http.IncomingHttpHeaders;
}
interface TestServer {
  origin: string;
  port: number;
  seen: Seen[];
  paths: () => string[];
}

const servers: http.Server[] = [];

async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen[]) => void): Promise<TestServer> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", t: Date.now(), headers: req.headers });
    handler(req, res, seen);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, port, seen, paths: () => seen.map((s) => s.path) };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); })));
});

const robotsAllowAll = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
  if (req.url !== "/robots.txt") return false;
  res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow:\n");
  return true;
};

describe("作法（§9.1）", () => {
  it("robots.txt の次に本体を取り、名乗りを付ける", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", etag: '"v1"', "last-modified": "Tue, 03 Nov 2026 00:00:00 GMT" }).end("<p>本文</p>");
    });
    const out = await politeFetch(`${s.origin}/page`);
    expect(s.paths()).toEqual(["/robots.txt", "/page"]);
    for (const seen of s.seen) expect(seen.headers["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^hpai-status-map\/0\.1 \(\+https:\/\/github\.com\/[^)]+\)$/);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.status).toBe(200);
    expect(out.finalUrl).toBe(`${s.origin}/page`);
    expect(out.contentType).toContain("text/html");
    expect(out.body.toString("utf8")).toBe("<p>本文</p>");
    expect(out.etag).toBe('"v1"');
    expect(out.lastModified).toBe("Tue, 03 Nov 2026 00:00:00 GMT");
    expect(out.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it("robots.txt が禁止なら robots_denied で本体を取らない", async () => {
    const s = await startServer((req, res) => {
      res.writeHead(200).end(req.url === "/robots.txt" ? "User-agent: *\nDisallow: /" : "NO");
    });
    expect(await politeFetch(`${s.origin}/page`)).toEqual({ kind: "robots_denied" });
    expect(s.paths()).toEqual(["/robots.txt"]);
  });

  it("名乗り（hpai-status-map）への個別の禁止も守る", async () => {
    const s = await startServer((req, res) => {
      res.writeHead(200).end(req.url === "/robots.txt" ? "User-agent: hpai-status-map\nDisallow: /private\n\nUser-agent: *\nDisallow:\n" : "ok");
    });
    expect((await politeFetch(`${s.origin}/private/x`)).kind).toBe("robots_denied");
    expect((await politeFetch(`${s.origin}/public`)).kind).toBe("ok");
  });

  it("robots.txt が 404 なら許可、取得は 1 度だけ（24 時間メモリ）", async () => {
    const s = await startServer((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(404).end("no");
      res.writeHead(200).end("hello");
    });
    expect((await politeFetch(`${s.origin}/a`)).kind).toBe("ok");
    expect((await politeFetch(`${s.origin}/b`)).kind).toBe("ok");
    expect(s.paths()).toEqual(["/robots.txt", "/a", "/b"]);
  }, 15_000);

  it("robots.txt が 5xx なら本体を取らない", async () => {
    const s = await startServer((req, res) => {
      res.writeHead(req.url === "/robots.txt" ? 503 : 200).end("x");
    });
    const out = await politeFetch(`${s.origin}/page`);
    expect(out.kind).not.toBe("ok");
    expect(s.paths()).toEqual(["/robots.txt"]);
  });

  it("接続が切れたら network_error（robots.txt でも本体でも）", async () => {
    const cutRobots = await startServer((req, res) => {
      if (req.url === "/robots.txt") return void req.socket.destroy();
      res.writeHead(200).end("x");
    });
    const a = await politeFetch(`${cutRobots.origin}/page`);
    expect(a.kind).toBe("network_error");
    expect(cutRobots.paths()).toEqual(["/robots.txt"]);

    const cutBody = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      req.socket.destroy();
    });
    const b = await politeFetch(`${cutBody.origin}/page`);
    expect(b).toMatchObject({ kind: "network_error", tls: false });
  }, 15_000);

  it("応答がなければ timeoutMs で network_error", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      // 返事をしない
    });
    const out = await politeFetch(`${s.origin}/slow`, { timeoutMs: 400 });
    expect(out).toMatchObject({ kind: "network_error", code: "TIMEOUT", tls: false });
  });

  it("同じホストへの間隔は robots.txt と本体の間も含め 1.19 秒以上", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(200).end("x");
    });
    await politeFetch(`${s.origin}/1`);
    await politeFetch(`${s.origin}/2`);
    expect(s.paths()).toEqual(["/robots.txt", "/1", "/2"]);
    for (let i = 1; i < s.seen.length; i++) expect(s.seen[i]!.t - s.seen[i - 1]!.t).toBeGreaterThanOrEqual(1190);
  }, 15_000);

  it("並行に呼んでも同じホストの要求は間隔を守る（待ち行列）", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(200).end("x");
    });
    await Promise.all([politeFetch(`${s.origin}/p`), politeFetch(`${s.origin}/q`), politeFetch(`${s.origin}/r`)]);
    expect(s.seen).toHaveLength(4);
    for (let i = 1; i < s.seen.length; i++) expect(s.seen[i]!.t - s.seen[i - 1]!.t).toBeGreaterThanOrEqual(1190);
  }, 15_000);

  it("Crawl-delay: 2 なら 1.99 秒以上", async () => {
    const s = await startServer((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(200).end("User-agent: *\nCrawl-delay: 2\n");
      res.writeHead(200).end("x");
    });
    await politeFetch(`${s.origin}/page`);
    expect(s.paths()).toEqual(["/robots.txt", "/page"]);
    expect(s.seen[1]!.t - s.seen[0]!.t).toBeGreaterThanOrEqual(1990);
  }, 15_000);
});

describe("条件付きの取得と状態", () => {
  it("etag と last-modified を送り、304 は not_modified", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      if (req.headers["if-none-match"] === '"v1"') return void res.writeHead(304).end();
      res.writeHead(200).end("fresh");
    });
    expect(await politeFetch(`${s.origin}/p`, { etag: '"v1"', lastModified: "Tue, 03 Nov 2026 00:00:00 GMT" })).toEqual({ kind: "not_modified" });
    expect(s.seen[1]!.headers["if-none-match"]).toBe('"v1"');
    expect(s.seen[1]!.headers["if-modified-since"]).toBe("Tue, 03 Nov 2026 00:00:00 GMT");
    expect(s.seen[0]!.headers["if-none-match"]).toBeUndefined(); // robots.txt には付けない
  }, 15_000);

  it("404 と 500 は http_error（本体の状態を持つ）", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(req.url === "/gone" ? 404 : 500).end("x");
    });
    expect(await politeFetch(`${s.origin}/gone`)).toEqual({ kind: "http_error", status: 404 });
    expect(await politeFetch(`${s.origin}/boom`)).toEqual({ kind: "http_error", status: 500 });
  }, 15_000);

  it("http と https 以外は not_allowed で何も要求しない", async () => {
    expect(await politeFetch("ftp://example.test/x")).toEqual({ kind: "not_allowed", url: "ftp://example.test/x" });
    expect(await politeFetch("file:///etc/hosts")).toMatchObject({ kind: "not_allowed" });
    expect(await politeFetch("not a url")).toMatchObject({ kind: "network_error", tls: false });
  });
});

describe("リダイレクト", () => {
  it("同じ場所の中なら辿り、finalUrl は最後の URL", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      if (req.url === "/old") return void res.writeHead(301, { location: "/new" }).end();
      res.writeHead(200).end("moved");
    });
    const out = await politeFetch(`${s.origin}/old`);
    expect(out).toMatchObject({ kind: "ok", finalUrl: `${s.origin}/new` });
    expect(s.paths()).toEqual(["/robots.txt", "/old", "/new"]);
  }, 15_000);

  it("リダイレクトの先も robots.txt を見る（禁止なら先の本体を取らない）", async () => {
    const b = await startServer((req, res) => {
      res.writeHead(200).end(req.url === "/robots.txt" ? "User-agent: *\nDisallow: /target" : "NO");
    });
    const a = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(302, { location: `${b.origin}/target` }).end();
    });
    expect(await politeFetch(`${a.origin}/start`)).toEqual({ kind: "robots_denied" });
    expect(b.paths()).toEqual(["/robots.txt"]);
  }, 15_000);

  it("輪は 5 回で too_many_redirects（network_error の code）", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(302, { location: "/loop" }).end();
    });
    const out = await politeFetch(`${s.origin}/loop`);
    expect(out).toMatchObject({ kind: "network_error", code: "too_many_redirects", tls: false });
    expect(s.paths().filter((p) => p === "/loop")).toHaveLength(6); // 最初の 1 回と辿った 5 回
  }, 30_000);
});

describe("allowUrl", () => {
  it("拒む URL は robots.txt も取らず not_allowed、受信 0 回", async () => {
    const s = await startServer((_req, res) => void res.writeHead(200).end("x"));
    const url = `${s.origin}/page`;
    expect(await politeFetch(url, { allowUrl: () => false })).toEqual({ kind: "not_allowed", url });
    expect(s.seen).toHaveLength(0);
  });

  it("リダイレクトの先を拒むと、その先への要求は 0 回", async () => {
    const target = await startServer((_req, res) => void res.writeHead(200).end("x"));
    const first = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(302, { location: `${target.origin}/secret` }).end();
    });
    const out = await politeFetch(`${first.origin}/start`, { allowUrl: (u) => u.port === String(first.port) });
    expect(out).toEqual({ kind: "not_allowed", url: `${target.origin}/secret` });
    expect(target.seen).toHaveLength(0);
    expect(first.paths()).toEqual(["/robots.txt", "/start"]);
  }, 15_000);

  it("allowUrl は robots.txt の取得より先に、最初の URL で呼ばれる", async () => {
    const s = await startServer((req, res) => {
      if (robotsAllowAll(req, res)) return;
      res.writeHead(200).end("x");
    });
    const calls: string[] = [];
    const out = await politeFetch(`${s.origin}/page`, {
      allowUrl: (u) => {
        calls.push(`${u.pathname}|seen=${s.seen.length}`);
        return true;
      },
    });
    expect(out.kind).toBe("ok");
    expect(calls[0]).toBe("/page|seen=0");
  }, 15_000);
});

describe("TLS の失敗の分類（fetch を差し替える）", () => {
  const failWith = (cause: unknown) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("EPROTO は tls:true で、再試行しない", async () => {
    const fetchMock = failWith({ cause: { code: "EPROTO" } });
    const out = await politeFetch("https://tls-eproto.example.test/page");
    expect(out).toMatchObject({ kind: "network_error", code: "EPROTO", tls: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["ERR_SSL_WRONG_VERSION_NUMBER", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"])(
    "%s は tls:true",
    async (code) => {
      failWith({ code });
      const out = await politeFetch(`https://tls-${code.toLowerCase()}.example.test/page`);
      expect(out).toMatchObject({ kind: "network_error", code, tls: true });
    },
  );

  it.each(["UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"])("%s は tls:false", async (code) => {
    failWith({ cause: { code } });
    const out = await politeFetch(`https://net-${code.toLowerCase()}.example.test/page`);
    expect(out).toMatchObject({ kind: "network_error", code, tls: false });
  });

  it("code がなければ null、message は残る", async () => {
    failWith(undefined);
    const out = await politeFetch("https://no-code.example.test/page");
    expect(out).toMatchObject({ kind: "network_error", code: null, tls: false });
    if (out.kind === "network_error") expect(out.message).toContain("fetch failed");
  });
});

describe("TLS を緩める設定を入れない（ソース検査、取り決め 3.7）", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const FORBIDDEN = /rejectUnauthorized|secureOptions|UnsafeLegacyRenegotiation|ALLOW_UNSAFE_LEGACY|SSL_OP_|NODE_TLS_REJECT_UNAUTHORIZED|openssl-legacy/i;

  function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "test") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  it("functions/src、scripts（test を除く）、functions/package.json、firebase.json に無い", () => {
    const files = [
      ...walk(path.join(ROOT, "functions", "src")),
      ...walk(path.join(ROOT, "scripts")),
      path.join(ROOT, "functions", "package.json"),
      path.join(ROOT, "firebase.json"),
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => FORBIDDEN.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
