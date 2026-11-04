// 本番の動作確認（runSmoke）と、公開前の確認（runPrePublishChecks）の試験。
// 本番にはつなげない。fetch は偽物を引数で渡す。公開前の確認は、一時のフォルダに作った偽の作業ツリーを読ませる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPrePublishChecks, runSmoke, type SmokeResult } from "../lib/smoke";
import { runSmokeProd } from "../smoke-prod";

const BASE = "https://hpai-test.web.app";
const INTERNAL = "https://asia-northeast1-hpai-test.cloudfunctions.net/mcpInternal";
const PUBLIC_TOOLS = ["list_cases", "get_area_status", "get_watch_status", "get_official_guidance"];

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Fake {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  calls: Call[];
}

type Override = (call: Call) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cases = (n: number) => ({ asOf: "2026-11-04T10:00:00+09:00", notices: [], sources: [], data: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) });

/** 本番が正しく動いているときの応答。override で 1 つずつ壊す。 */
function fake(override: Override = () => undefined): Fake {
  const calls: Call[] = [];
  const f = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { url: input, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : undefined };
    calls.push(call);
    const o = await override(call);
    if (o) return o;
    const u = new URL(input);
    if (input.startsWith(INTERNAL)) return new Response("unauthorized", { status: 401 });
    if (u.pathname === "/mcp") return json({ jsonrpc: "2.0", id: 1, result: { tools: PUBLIC_TOOLS.map((name) => ({ name })) } });
    if (u.pathname === "/api/v1/cases") return json(cases(24));
    if (u.pathname === "/geo/japan.topo.json") return json({ type: "Topology", objects: {}, arcs: [] });
    return new Response("<!doctype html><title>x</title>", { status: 200, headers: { "content-type": "text/html" } });
  };
  return { fetch: f, calls };
}

const failed = (r: SmokeResult[]) => r.filter((x) => !x.pass);
const byName = (r: SmokeResult[], part: string) => r.find((x) => x.name.includes(part));

describe("runSmoke", () => {
  it("すべて正しければ、全部通る（結果が空で通らない）", async () => {
    const r = await runSmoke(BASE, INTERNAL, fake().fetch);
    expect(r.length).toBeGreaterThanOrEqual(10);
    expect(failed(r)).toEqual([]);
    for (const x of r) expect(x.detail).not.toBe("");
  });

  it("/、/replay、/sample、/results、/public、/privacy、/geo/japan.topo.json を見る", async () => {
    const f = fake();
    await runSmoke(BASE, INTERNAL, f.fetch);
    const urls = f.calls.map((c) => c.url);
    for (const p of ["/", "/replay", "/sample", "/results", "/public", "/privacy", "/geo/japan.topo.json"]) {
      expect(urls, p).toContain(`${BASE}${p}`);
    }
  });

  it.each(["/", "/replay", "/sample", "/results", "/public", "/privacy", "/geo/japan.topo.json"])("%s が 200 でなければ落ちる（ほかは通る）", async (p) => {
    const r = await runSmoke(
      BASE,
      INTERNAL,
      fake((c) => (c.url === `${BASE}${p}` ? new Response("nope", { status: 503 }) : undefined)).fetch,
    );
    expect(failed(r)).toHaveLength(1);
    expect(failed(r)[0]!.name).toContain(p);
    expect(failed(r)[0]!.detail).toContain("503");
  });

  it("/geo/japan.topo.json が 200 でも、形のデータでなく画面の HTML なら落ちる（Hosting の既定の返し）", async () => {
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (c.url.endsWith("/geo/japan.topo.json") ? new Response("<!doctype html>", { status: 200 }) : undefined)).fetch);
    expect(failed(r)).toHaveLength(1);
    expect(failed(r)[0]!.name).toContain("/geo/japan.topo.json");
  });

  it("/api/v1/cases?season=2025 は 24 件。23 件と 25 件は落ちる", async () => {
    for (const n of [23, 25, 0]) {
      const r = await runSmoke(BASE, INTERNAL, fake((c) => (new URL(c.url).pathname === "/api/v1/cases" ? json(cases(n)) : undefined)).fetch);
      expect(failed(r), `${n} 件`).toHaveLength(1);
      expect(failed(r)[0]!.name).toContain("/api/v1/cases?season=2025");
      expect(failed(r)[0]!.detail).toContain(String(n));
    }
    const f = fake();
    await runSmoke(BASE, INTERNAL, f.fetch);
    expect(f.calls.some((c) => c.url === `${BASE}/api/v1/cases?season=2025`)).toBe(true);
  });

  it("/api/v1/cases が JSON でなくても、落ちるだけで止まらない", async () => {
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (new URL(c.url).pathname === "/api/v1/cases" ? new Response("<html>", { status: 200 }) : undefined)).fetch);
    expect(failed(r)).toHaveLength(1);
    expect(r.length).toBeGreaterThanOrEqual(10);
  });

  it("/mcp の tools/list は POST で、4 つの道具だけ", async () => {
    const f = fake();
    await runSmoke(BASE, INTERNAL, f.fetch);
    const call = f.calls.find((c) => c.url === `${BASE}/mcp`)!;
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toContain("application/json");
    expect(call.headers["accept"]).toContain("application/json");
    expect(call.headers["accept"]).toContain("text/event-stream");
    expect(JSON.parse(call.body!)).toMatchObject({ jsonrpc: "2.0", method: "tools/list" });
  });

  it.each([
    ["3 つ", PUBLIC_TOOLS.slice(0, 3)],
    ["5 つ", [...PUBLIC_TOOLS, "write_case"]],
    ["名前違い", [...PUBLIC_TOOLS.slice(0, 3), "get_farm"]],
  ])("/mcp の道具が %s なら落ちる", async (_label, tools) => {
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (new URL(c.url).pathname === "/mcp" ? json({ jsonrpc: "2.0", id: 1, result: { tools: tools.map((name) => ({ name })) } }) : undefined)).fetch);
    expect(failed(r)).toHaveLength(1);
    expect(failed(r)[0]!.name).toContain("/mcp");
  });

  it("/mcp が event-stream の形で返しても読める", async () => {
    const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: PUBLIC_TOOLS.map((name) => ({ name })) } })}\n\n`;
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (new URL(c.url).pathname === "/mcp" ? new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }) : undefined)).fetch);
    expect(failed(r)).toEqual([]);
  });

  it("mcpInternal は Bearer なしで 401。Authorization を一切送らない", async () => {
    const f = fake();
    const r = await runSmoke(BASE, INTERNAL, f.fetch);
    const internalCalls = f.calls.filter((c) => c.url.startsWith(INTERNAL));
    expect(internalCalls.length).toBeGreaterThanOrEqual(1);
    for (const c of f.calls) expect(Object.keys(c.headers), c.url).not.toContain("authorization");
    expect(byName(r, "mcpInternal")!.pass).toBe(true);
  });

  it.each([200, 403, 404, 500])("mcpInternal が %s を返したら落ちる（401 だけが合格）", async (status) => {
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (c.url.startsWith(INTERNAL) ? new Response("x", { status }) : undefined)).fetch);
    expect(failed(r)).toHaveLength(1);
    expect(failed(r)[0]!.name).toContain("mcpInternal");
    expect(failed(r)[0]!.detail).toContain(String(status));
  });

  it("fetch が投げても、その 1 件が落ちるだけで、ほかの確認は続く", async () => {
    const r = await runSmoke(
      BASE,
      INTERNAL,
      fake((c) => {
        if (c.url === `${BASE}/replay`) throw new TypeError("fetch failed");
        return undefined;
      }).fetch,
    );
    expect(failed(r)).toHaveLength(1);
    expect(failed(r)[0]!.name).toContain("/replay");
    expect(r.length).toBeGreaterThanOrEqual(10);
  });

  it("末尾のスラッシュ付きの baseUrl でも、同じ URL を見る", async () => {
    const f = fake();
    await runSmoke(`${BASE}/`, INTERNAL, f.fetch);
    expect(f.calls.map((c) => c.url)).toContain(`${BASE}/replay`);
    expect(f.calls.map((c) => c.url).some((u) => u.includes("//replay"))).toBe(false);
  });

  it("結果の文に、応答の本文を写さない", async () => {
    const secret = "BODY-MARKER-should-not-appear";
    const r = await runSmoke(BASE, INTERNAL, fake((c) => (c.url === `${BASE}/public` ? new Response(secret, { status: 500 }) : undefined)).fetch);
    expect(JSON.stringify(r)).not.toContain(secret);
  });
});

describe("runSmokeProd（終了コード）", () => {
  const run = async (argv: string[], deps: Partial<Parameters<typeof runSmokeProd>[1]> = {}) => {
    const out: string[] = [];
    const code = await runSmokeProd(argv, {
      fetch: fake().fetch,
      write: (s) => out.push(s),
      root: os.tmpdir(),
      env: { FIREBASE_PROJECT: "hpai-test" },
      ...deps,
    });
    return { code, out: out.join("") };
  };

  it("すべて通れば 0。FIREBASE_PROJECT から本番の URL を組む", async () => {
    const f = fake();
    const { code, out } = await run([], { fetch: f.fetch });
    expect(code).toBe(0);
    expect(out).toContain("PASS");
    expect(f.calls.some((c) => c.url === "https://hpai-test.web.app/replay")).toBe(true);
    expect(f.calls.some((c) => c.url.startsWith("https://asia-northeast1-hpai-test.cloudfunctions.net/mcpInternal"))).toBe(true);
  });

  it("1 つでも落ちれば 1", async () => {
    const { code, out } = await run([], { fetch: fake((c) => (c.url.endsWith("/results") ? new Response("x", { status: 500 }) : undefined)).fetch });
    expect(code).toBe(1);
    expect(out).toContain("FAIL");
  });

  it("--base-url と --internal-mcp-url を渡せる", async () => {
    const f = fake();
    const { code } = await run(["--base-url", "https://other.web.app", "--internal-mcp-url", "https://asia-northeast1-other.cloudfunctions.net/mcpInternal"], {
      fetch: (u, i) => (u.startsWith("https://asia-northeast1-other.cloudfunctions.net") ? Promise.resolve(new Response("x", { status: 401 })) : f.fetch(u.replace("https://other.web.app", BASE), i)),
    });
    expect(code).toBe(0);
  });

  it("URL もプロジェクトも決まらなければ 2（ネットワークへ出ない）", async () => {
    const f = fake();
    const { code } = await run([], { env: {}, fetch: f.fetch });
    expect(code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it("プロジェクト ID の形が不正なら 2", async () => {
    const f = fake();
    const { code } = await run([], { env: { FIREBASE_PROJECT: "x@evil.example#" }, fetch: f.fetch });
    expect(code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it("http の本番の URL は断る（localhost 以外）", async () => {
    const f = fake();
    const { code } = await run(["--base-url", "http://example.test", "--internal-mcp-url", INTERNAL], { fetch: f.fetch });
    expect(code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    "https://hpai-test.web.app",
    "https://hpai-test.firebaseapp.com",
    "https://asia-northeast1-hpai-test.cloudfunctions.net",
    "https://hpai-abc-an.a.run.app",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ])("--base-url に許す: %s", async (u) => {
    const f = fake();
    const { code } = await run(["--base-url", u, "--internal-mcp-url", INTERNAL], { fetch: f.fetch });
    expect(code).toBe(0);
  });

  it.each([
    "https://evil.example",
    "https://hpai-test.web.app.evil.example",
    "https://evilweb.app",
    "https://web.app",
    "https://example.com/hpai-test.web.app",
    "https://user@evil.example/",
    "http://hpai-test.web.app",
    "ftp://hpai-test.web.app",
  ])("--base-url に許さない: %s（ネットワークへ出ない）", async (u) => {
    const f = fake();
    const { code } = await run(["--base-url", u, "--internal-mcp-url", INTERNAL], { fetch: f.fetch });
    expect(code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it("--internal-mcp-url も、関数の URL（.cloudfunctions.net、.run.app）かローカルに限る", async () => {
    const f = fake();
    expect((await run(["--base-url", BASE, "--internal-mcp-url", "https://evil.example/mcpInternal"], { fetch: f.fetch })).code).toBe(2);
    expect((await run(["--base-url", BASE, "--internal-mcp-url", "https://hpai-test.web.app/mcpInternal"], { fetch: f.fetch })).code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it("知らない引数は 2", async () => {
    expect((await run(["--nope"])).code).toBe(2);
  });
});

// ── 公開前の確認 ──

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-prepublish-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const OPERATOR = "テスト用の運営者名-MARKER";
const HIDE = "33,01,02";
const GUIDE = "shared/src/guidance/official.ts";
const PRIVACY = "web/src/pages/privacy/privacyNotice.ts";
const REVIEW = "docs/official-text-review.md";
const README = "README.md";
const MCP_DOC = "docs/mcp-usage.md";
const AREA = "テスト用の農場と地域-MARKER";
const block = (...lines: string[]) => `# t\n<!-- 運営者と地域: ここから -->\n${lines.map((l) => `${l}\n`).join("")}<!-- 運営者と地域: ここまで -->\n`;

function put(rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const guide = (v: string | null) => `export const OFFICIAL_GUIDANCE_REVIEWED_ON: IsoDate | null = ${v === null ? "null" : `"${v}"`};\n`;
const privacy = (v: string | null) => `export const PRIVACY_REVIEWED_ON: IsoDate | null = ${v === null ? "null" : `"${v}"`};\n`;

/** 公開してよい状態の作業ツリー。 */
function ready() {
  put(GUIDE, guide("2026-11-07"));
  put(PRIVACY, privacy("2026-11-07"));
  put(REVIEW, "| `OFFICIAL_GUIDANCE_REVIEWED_ON` | 2026-11-07 |\n");
  put("web/.env.production", `VITE_OPERATOR_NAME=${OPERATOR}\n`);
  put("functions/.env.hpai-test", "GMAIL_USER=a\nAGENT_EVAL_HIDE_PREFS=\n");
  put(README, block(AREA));
  put(MCP_DOC, "claude mcp add --transport http hpai https://example.web.app/mcp\n");
}

describe("runPrePublishChecks", () => {
  it("整っていれば、7 つの確認がすべて通る", () => {
    ready();
    const r = runPrePublishChecks(root, {});
    expect(r).toHaveLength(7);
    expect(failed(r)).toEqual([]);
  });

  it("OFFICIAL_GUIDANCE_REVIEWED_ON が null なら落ちる", () => {
    ready();
    put(GUIDE, guide(null));
    const names = failed(runPrePublishChecks(root, {})).map((x) => x.name);
    expect(names.some((n) => n.includes("OFFICIAL_GUIDANCE_REVIEWED_ON") && !n.includes(REVIEW))).toBe(true);
  });

  it("docs/official-text-review.md に同じ日付がなければ落ちる（別の日付でも落ちる）", () => {
    ready();
    put(REVIEW, "| `OFFICIAL_GUIDANCE_REVIEWED_ON` | `null` |\n");
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining(REVIEW)]);
    put(REVIEW, "確認した日: 2026-11-06\n");
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining(REVIEW)]);
  });

  it("OFFICIAL_GUIDANCE_REVIEWED_ON が null のとき、記録の文書の日付の確認も落ちる（値がなければ照らせない）", () => {
    ready();
    put(GUIDE, guide(null));
    const names = failed(runPrePublishChecks(root, {})).map((x) => x.name);
    expect(names.some((n) => n.includes(REVIEW))).toBe(true);
  });

  it("PRIVACY_REVIEWED_ON が null なら落ちる", () => {
    ready();
    put(PRIVACY, privacy(null));
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("PRIVACY_REVIEWED_ON")]);
  });

  it("VITE_OPERATOR_NAME がない、空、空白だけ、引用符だけ、のどれでも落ちる", () => {
    for (const text of ["", "VITE_OPERATOR_NAME=\n", "VITE_OPERATOR_NAME=   \n", 'VITE_OPERATOR_NAME=""\n', "# VITE_OPERATOR_NAME=x\n", "OTHER=1\n"]) {
      ready();
      put("web/.env.production", text);
      expect(failed(runPrePublishChecks(root, {})).map((x) => x.name), JSON.stringify(text)).toEqual([expect.stringContaining("VITE_OPERATOR_NAME")]);
    }
    ready();
    fs.rmSync(path.join(root, "web/.env.production"));
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("VITE_OPERATOR_NAME")]);
  });

  it("VITE_OPERATOR_NAME は引用符つきでも export つきでも、値があれば通る", () => {
    for (const text of [`VITE_OPERATOR_NAME="${OPERATOR}"\n`, `VITE_OPERATOR_NAME='${OPERATOR}'\n`, `export VITE_OPERATOR_NAME=${OPERATOR}\n`]) {
      ready();
      put("web/.env.production", text);
      expect(failed(runPrePublishChecks(root, {})), text).toEqual([]);
    }
  });

  it("本番用の設定（.env.production.local）が空で上書きしていれば落ちる", () => {
    ready();
    put("web/.env.production.local", "VITE_OPERATOR_NAME=\n");
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("VITE_OPERATOR_NAME")]);
  });

  it("AGENT_EVAL_HIDE_PREFS に値があれば落ちる。空なら通る。模擬環境の設定は見ない", () => {
    ready();
    put("functions/.env.hpai-test", `AGENT_EVAL_HIDE_PREFS=${HIDE}\n`);
    const r = runPrePublishChecks(root, {});
    expect(failed(r).map((x) => x.name)).toEqual([expect.stringContaining("AGENT_EVAL_HIDE_PREFS")]);
    // 模擬環境の設定と、模擬環境だけの .env.local は、本番の deploy に載らないので見ない
    ready();
    put("functions/.env.demo-hpai", `AGENT_EVAL_HIDE_PREFS=${HIDE}\n`);
    put("functions/.env.local", `AGENT_EVAL_HIDE_PREFS=${HIDE}\n`);
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
    // 共通の .env にあれば本番にも載る
    put("functions/.env", `AGENT_EVAL_HIDE_PREFS="${HIDE}"\n`);
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("AGENT_EVAL_HIDE_PREFS")]);
  });

  it("ファイルが読めないときは、通さず落とす（黙って通らない）", () => {
    const r = runPrePublishChecks(root, {});
    expect(r).toHaveLength(7);
    // 6 つ（確認日 2 つ、記録の文書、運営者名、運営者と地域、URL の印）は落ちる。設定の値を隠す確認だけは、設定のファイルがなければ「値なし」で通る
    expect(failed(r).map((x) => x.name).join("\n")).not.toContain("AGENT_EVAL_HIDE_PREFS");
    expect(failed(r)).toHaveLength(6);
  });

  it("日付の形でない値は、入っているとは数えない", () => {
    ready();
    put(GUIDE, 'export const OFFICIAL_GUIDANCE_REVIEWED_ON: IsoDate | null = "確認済み";\n');
    expect(failed(runPrePublishChecks(root, {})).length).toBeGreaterThanOrEqual(1);
  });

  it("確認日は OFFICIAL_GUIDANCE_REVIEWED_ON を含む行の中だけで照らす（別の行の同じ日付では通らない）", () => {
    ready();
    put(REVIEW, "| `OFFICIAL_GUIDANCE_REVIEWED_ON` | `null` |\n| 作者と共同経営者の確認 | 2026-11-07 |\n");
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining(REVIEW)]);
    put(REVIEW, "前置き 2026-11-07\n| `OFFICIAL_GUIDANCE_REVIEWED_ON` | 2026-11-07 |\n");
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
    put(REVIEW, "OFFICIAL_GUIDANCE_REVIEWED_ON は 2026-11-07 に入れた\n");
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
  });

  it("README の運営者と地域の囲みに、空でない 1 行がなければ落ちる", () => {
    for (const text of ["# t\n", block(), block("", "  "), block("<!-- ここに入れる -->"), `# t\n<!-- 運営者と地域: ここまで -->\n${AREA}\n<!-- 運営者と地域: ここから -->\n`, `<!-- 運営者と地域: ここから -->\n${AREA}\n`]) {
      ready();
      put(README, text);
      expect(failed(runPrePublishChecks(root, {})).map((x) => x.name), JSON.stringify(text)).toEqual([expect.stringContaining("運営者と地域")]);
    }
    ready();
    fs.rmSync(path.join(root, README));
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual(expect.arrayContaining([expect.stringContaining("運営者と地域")]));
  });

  it("README と docs/mcp-usage.md に <本番の URL> と <サイトの URL> が残っていれば落ちる", () => {
    for (const [file, text] of [
      [README, `${block(AREA)}claude mcp add --transport http hpai https://<本番の URL>/mcp\n`],
      [MCP_DOC, "curl 'https://<サイトの URL>/api/v1/cases'\n"],
      [MCP_DOC, "https://<本番の URL>/mcp\n"],
    ] as const) {
      ready();
      put(file, text);
      const bad = failed(runPrePublishChecks(root, {}));
      expect(bad.map((x) => x.name), file).toEqual([expect.stringContaining("<本番の URL>")]);
      expect(bad[0]!.detail).toContain(file);
    }
  });

  it("引用符のない値の行末コメントは値に入れない。空の値にコメントだけが付いても空", () => {
    ready();
    put("web/.env.production", "VITE_OPERATOR_NAME= # あとで入れる\n");
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("VITE_OPERATOR_NAME")]);
    put("web/.env.production", `VITE_OPERATOR_NAME=${OPERATOR} # 運営者\n`);
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
    put("web/.env.production", 'VITE_OPERATOR_NAME="名前 # 付き"\n');
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
    ready();
    put("functions/.env.hpai-test", "AGENT_EVAL_HIDE_PREFS= # 空\n");
    expect(failed(runPrePublishChecks(root, {}))).toEqual([]);
    put("functions/.env.hpai-test", `AGENT_EVAL_HIDE_PREFS=${HIDE} # 受け入れの試験\n`);
    expect(failed(runPrePublishChecks(root, {})).map((x) => x.name)).toEqual([expect.stringContaining("AGENT_EVAL_HIDE_PREFS")]);
  });

  it("シェルに export された環境変数も見る（ファイルより強い）。値は表示しない", () => {
    ready();
    fs.rmSync(path.join(root, "web/.env.production"));
    expect(failed(runPrePublishChecks(root, { VITE_OPERATOR_NAME: OPERATOR })), "シェルだけに運営者名").toEqual([]);
    ready();
    expect(failed(runPrePublishChecks(root, { VITE_OPERATOR_NAME: "" })).map((x) => x.name), "空で上書き").toEqual([expect.stringContaining("VITE_OPERATOR_NAME")]);
    ready();
    const bad = failed(runPrePublishChecks(root, { AGENT_EVAL_HIDE_PREFS: HIDE }));
    expect(bad.map((x) => x.name)).toEqual([expect.stringContaining("AGENT_EVAL_HIDE_PREFS")]);
    expect(JSON.stringify(bad)).not.toContain(HIDE);
    expect(failed(runPrePublishChecks(root, { AGENT_EVAL_HIDE_PREFS: "" }))).toEqual([]);
  });

  it("結果の文に、設定の値（運営者名、県の一覧）を出さない。落ちたときも同じ", () => {
    ready();
    put("functions/.env.hpai-test", `AGENT_EVAL_HIDE_PREFS=${HIDE}\n`);
    for (const state of ["ready", "broken"]) {
      if (state === "broken") put("web/.env.production", `VITE_OPERATOR_NAME=\nOTHER=${OPERATOR}\n`);
      const text = JSON.stringify(runPrePublishChecks(root, {}));
      expect(text, state).not.toContain(OPERATOR);
      expect(text, state).not.toContain(HIDE);
    }
  });
});
