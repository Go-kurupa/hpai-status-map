import { describe, expect, it } from "vitest";
import { buildRequest, runOps } from "../ops";

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
});
