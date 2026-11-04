import { describe, expect, it } from "vitest";
import { buildRequest, fetchUsageStatus, runOps } from "../ops";

describe("buildRequest（契約 1.7 の 4 操作）", () => {
  it("set-claims", () => {
    expect(buildRequest(["set-claims", "--email", "a@example.test", "--operator"])).toEqual({
      op: "set-claims",
      email: "a@example.test",
      operator: true,
    });
    expect(buildRequest(["set-claims", "--email", "a@example.test", "--operator", "--member"])).toMatchObject({ member: true });
  });

  it("create-invite", () => {
    expect(buildRequest(["create-invite", "--kind", "signup", "--max-uses", "5"])).toEqual({
      op: "create-invite",
      kind: "signup",
      maxUses: 5,
    });
  });

  it("send-test-mail（宛先の引数は受け取らない）", () => {
    expect(buildRequest(["send-test-mail"])).toEqual({ op: "send-test-mail" });
    expect(() => buildRequest(["send-test-mail", "--to", "a@example.test"])).toThrow();
    expect(() => buildRequest(["send-test-mail", "a@example.test"])).toThrow();
  });

  it("run-watch-now（組は 0〜2 だけ。なければ全部）", () => {
    expect(buildRequest(["run-watch-now"])).toEqual({ op: "run-watch-now" });
    expect(buildRequest(["run-watch-now", "--group", "2"])).toEqual({ op: "run-watch-now", group: 2 });
    expect(() => buildRequest(["run-watch-now", "--group", "3"])).toThrow();
    expect(() => buildRequest(["run-watch-now", "--group", "x"])).toThrow();
    expect(() => buildRequest(["run-watch-now", "extra"])).toThrow();
  });

  it("watch-detail（引数なし）", () => {
    expect(buildRequest(["watch-detail"])).toEqual({ op: "watch-detail" });
    expect(() => buildRequest(["watch-detail", "--pref", "13"])).toThrow();
  });

  it("seed-sources", () => {
    expect(buildRequest(["seed-sources"])).toEqual({ op: "seed-sources" });
  });

  it("set-setting は値を JSON として読み、読めなければ文字列", () => {
    expect(buildRequest(["set-setting", "autoPublishEnabled", "true"])).toEqual({ op: "set-setting", key: "autoPublishEnabled", value: true });
    expect(buildRequest(["set-setting", "softLimitJpy", "1500"])).toMatchObject({ value: 1500 });
    expect(buildRequest(["set-setting", "primaryModel", "claude-opus-5-5"])).toMatchObject({ value: "claude-opus-5-5" });
  });

  it("足りない引数、知らない操作は例外", () => {
    expect(() => buildRequest([])).toThrow();
    expect(() => buildRequest(["drop-database"])).toThrow();
    expect(() => buildRequest(["set-claims", "--operator"])).toThrow();
    expect(() => buildRequest(["set-claims", "--email", "a@example.test"])).toThrow();
    expect(() => buildRequest(["create-invite", "--kind", "signup"])).toThrow();
    expect(() => buildRequest(["create-invite", "--kind", "signup", "--max-uses", "x"])).toThrow();
    expect(() => buildRequest(["set-setting", "onlyKey"])).toThrow();
  });
});

describe("runOps", () => {
  const FAKE = "fake-ops-value-for-test";

  function deps(response: { status: number; body: unknown }, token: string | null = FAKE) {
    const out: string[] = [];
    const sent: Array<{ url: string; init: RequestInit }> = [];
    return {
      out,
      sent,
      d: {
        env: { FIREBASE_PROJECT: "demo-test" } as Record<string, string | undefined>,
        readToken: () => token,
        fetch: (async (url: string, init: RequestInit) => {
          sent.push({ url, init });
          return new Response(JSON.stringify(response.body), { status: response.status });
        }) as typeof fetch,
        write: (s: string) => out.push(s),
      },
    };
  }

  it("Bearer で POST し、結果を出す。トークンは出さない", async () => {
    const { out, sent, d } = deps({ status: 200, body: { ok: true, op: "seed-sources", added: 2, skipped: 0, total: 2 } });
    const code = await runOps(["seed-sources"], d);
    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://asia-northeast1-demo-test.cloudfunctions.net/opsAdmin");
    expect(sent[0]!.init.method).toBe("POST");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${FAKE}`);
    expect(sent[0]!.init.redirect).toBe("error"); // 転送された先に Bearer を渡さない
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ op: "seed-sources" });
    expect(out.join("")).toContain("added");
    expect(out.join("")).not.toContain(FAKE);
  });

  it("失敗の応答は非 0。トークンを出さない", async () => {
    const { out, d } = deps({ status: 401, body: { ok: false, error: "認証できません" } });
    expect(await runOps(["seed-sources"], d)).not.toBe(0);
    expect(out.join("")).not.toContain(FAKE);
  });

  it("トークンの控えが無ければ送らずに止まる", async () => {
    const { sent, d } = deps({ status: 200, body: {} }, null);
    expect(await runOps(["seed-sources"], d)).not.toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("FIREBASE_PROJECT も OPS_URL も無ければ送らずに止まる", async () => {
    const { sent, d } = deps({ status: 200, body: {} });
    d.env = {};
    expect(await runOps(["seed-sources"], d)).not.toBe(0);
    expect(sent).toHaveLength(0);
  });

  describe("OPS_URL の scheme（S-11。Bearer を平文で出さない）", () => {
    it("https は通す。ローカルの模擬環境だけ http://localhost と http://127.0.0.1 を通す", async () => {
      for (const url of [
        "https://asia-northeast1-demo-test.cloudfunctions.net/opsAdmin",
        "https://opsadmin-abc123-an.a.run.app/",
        "HTTPS://Asia-Northeast1-Demo-Test.CloudFunctions.NET./opsAdmin", // 大文字と末尾のドットは正規化して比べる
        "http://localhost:5001/demo-hpai/asia-northeast1/opsAdmin",
        "http://127.0.0.1:5001/demo-hpai/asia-northeast1/opsAdmin",
      ]) {
        const { sent, d } = deps({ status: 200, body: { ok: true, op: "seed-sources" } });
        d.env = { OPS_URL: url };
        expect(await runOps(["seed-sources"], d), url).toBe(0);
        expect(sent, url).toHaveLength(1);
        expect(sent[0]!.url).toBe(url);
      }
    });

    it("それ以外の http、別の scheme、URL でない値、ローカルに見せかけたホストは、送らずに止まる。値は出さない", async () => {
      for (const url of [
        "http://example.test/opsAdmin",
        "https://example.test/opsAdmin", // https でも、関数のホストでなければ断る
        "https://evil.example/.cloudfunctions.net",
        "https://cloudfunctions.net/opsAdmin", // 前に名前がない
        "https://evilcloudfunctions.net/opsAdmin",
        "https://x.cloudfunctions.net.evil.example/opsAdmin",
        "https://x.run.app.evil.example/opsAdmin",
        "https://demo@evil.example/opsAdmin",
        "http://x.cloudfunctions.net/opsAdmin", // http は模擬環境のホストだけ
        "http://192.168.0.5:5001/opsAdmin",
        "http://localhost.example.test/opsAdmin",
        "http://127.0.0.1.example.test/opsAdmin",
        "http://localhost@example.test/opsAdmin",
        "http://[::1]:5001/opsAdmin",
        "ftp://example.test/opsAdmin",
        "file:///tmp/opsAdmin",
        "example.test/opsAdmin",
      ]) {
        const { out, sent, d } = deps({ status: 200, body: { ok: true } });
        d.env = { OPS_URL: url };
        expect(await runOps(["seed-sources"], d), url).toBe(2);
        expect(sent, url).toHaveLength(0);
        expect(out.join(""), url).toContain("OPS_URL");
        expect(out.join(""), url).not.toContain(FAKE);
        expect(out.join(""), url).not.toContain(url);
      }
    });

    // I-1: 既定の URL は FIREBASE_PROJECT から組む。形の外の値でホストが変わらないようにする
    const BAD_PROJECTS = ["x@evil.example#", "evil.example", "demo-test.evil.example", "a/b", "A", "-demo", "demo test", "a".repeat(64), "demo-test\n"];

    it("FIREBASE_PROJECT が形の外（x@evil.example# など）なら、組まずに止まる。runOps、usage-status、probe の 3 つの経路すべて", async () => {
      for (const project of BAD_PROJECTS) {
        const a = deps({ status: 200, body: { ok: true } });
        a.d.env = { FIREBASE_PROJECT: project };
        expect(await runOps(["seed-sources"], a.d), project).toBe(2);
        expect(a.sent, project).toHaveLength(0);
        expect(a.out.join(""), project).toContain("FIREBASE_PROJECT");

        const b = deps({ status: 200, body: { ok: true } });
        b.d.env = { FIREBASE_PROJECT: project };
        expect(await runOps(["probe", "--from-sources"], b.d), project).toBe(2);
        expect(b.sent, project).toHaveLength(0);
        expect(b.out.join(""), project).toContain("FIREBASE_PROJECT");

        let called = 0;
        const usage = await fetchUsageStatus({
          env: { FIREBASE_PROJECT: project },
          readToken: () => FAKE,
          fetch: (async () => {
            called++;
            return new Response("{}");
          }) as typeof fetch,
        });
        expect(usage, project).toBeNull();
        expect(called, project).toBe(0);
      }
    });

    it("OPS_URL を指定していれば、FIREBASE_PROJECT の形は見ない（URL の検査だけ）", async () => {
      const { sent, d } = deps({ status: 200, body: { ok: true, op: "seed-sources" } });
      d.env = { OPS_URL: "https://asia-northeast1-demo-test.cloudfunctions.net/opsAdmin", FIREBASE_PROJECT: "x@evil.example#" };
      expect(await runOps(["seed-sources"], d)).toBe(0);
      expect(sent[0]!.url).toBe("https://asia-northeast1-demo-test.cloudfunctions.net/opsAdmin");
    });

    it("probe の PROBE_URL も同じ検査を通す。http の別のホストは、送らずに止まる", async () => {
      for (const url of ["http://example.test/probeEntrances", "https://example.test/probeEntrances", "ftp://example.test/probeEntrances", "example.test/probeEntrances"]) {
        const { out, sent, d } = deps({ status: 200, body: { ok: true } });
        d.env = { PROBE_URL: url };
        expect(await runOps(["probe", "--from-sources"], d), url).toBe(2);
        expect(sent, url).toHaveLength(0);
        expect(out.join(""), url).toContain("PROBE_URL");
        expect(out.join(""), url).not.toContain(url);
      }
    });
  });
});

describe("fetchUsageStatus（setup-agent --unpause が今月の費用を読む。読めなければ null）", () => {
  const FAKE = "fake-ops-value-for-test";
  const OK = { ok: true, op: "usage-status", month: "2026-11", estimatedJpy: 10600, hardLimitJpy: 10000 };
  function io(over: { env?: Record<string, string | undefined>; token?: string | null; res?: () => Response | Promise<Response> } = {}) {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    return {
      sent,
      d: {
        env: over.env ?? { FIREBASE_PROJECT: "demo-test" },
        readToken: () => (over.token === undefined ? FAKE : over.token),
        fetch: (async (url: string, init: RequestInit) => {
          sent.push({ url, init });
          return over.res ? over.res() : new Response(JSON.stringify(OK));
        }) as typeof fetch,
      },
    };
  }

  it("Bearer で usage-status を POST し、月・費用・上限を返す", async () => {
    const { sent, d } = io();
    expect(await fetchUsageStatus(d)).toEqual({ month: "2026-11", estimatedJpy: 10600, hardLimitJpy: 10000 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://asia-northeast1-demo-test.cloudfunctions.net/opsAdmin");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${FAKE}`);
    expect(sent[0]!.init.redirect).toBe("error"); // 転送された先に Bearer を渡さない
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ op: "usage-status" });
  });

  it("URL がない、https でない・関数のホストでない OPS_URL、控えがないときは、送らずに null（Bearer を平文で出さない）", async () => {
    for (const over of [{ env: {} }, { env: { OPS_URL: "http://example.test/opsAdmin" } }, { env: { OPS_URL: "https://example.test/opsAdmin" } }, { token: null }]) {
      const { sent, d } = io(over);
      expect(await fetchUsageStatus(d)).toBeNull();
      expect(sent).toHaveLength(0);
    }
  });

  it("HTTP の失敗、通信の失敗、形が違う応答は null", async () => {
    const bad: Array<() => Response | Promise<Response>> = [
      () => new Response("{}", { status: 401 }),
      () => {
        throw new Error("down");
      },
      () => new Response("not json"),
      () => new Response(JSON.stringify({ ...OK, estimatedJpy: "10600" })),
      () => new Response(JSON.stringify({ ...OK, hardLimitJpy: null })),
      () => new Response(JSON.stringify({ ...OK, op: "seed-sources" })),
      () => new Response(JSON.stringify({ ...OK, ok: false })),
      () => new Response("null"),
    ];
    for (const res of bad) expect(await fetchUsageStatus(io({ res }).d)).toBeNull();
  });
});
