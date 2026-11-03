import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveMcpInternal } from "../src/agent/mcpInternal";
import { agentTools } from "../src/agent/tools";
import type { AgentTools } from "../src/agent/tools";
import { politeFetch } from "../src/watch/politeFetch";

// 仮の tools.ts の取得は politeFetch を通す。試験ではネットワークへ出ない。
vi.mock("../src/watch/politeFetch", () => ({ politeFetch: vi.fn() }));

// Bearer の値はダミー（実物ではない）
const TOKEN = "test-internal-token-not-a-real-secret";
const ACCEPT = "application/json, text/event-stream";

function makeTools(): { [K in keyof AgentTools]: ReturnType<typeof vi.fn> } {
  return {
    listEntranceTargets: vi.fn(async () => [{ prefCode: "33", domain: "www.pref.example.jp", currentUrl: null, failingSince: null }]),
    fetchPrefPage: vi.fn(async () => ({ ok: true, finalUrl: "https://www.pref.example.jp/x", title: "t", text: "本文", links: [], truncated: false, error: null })),
    proposeEntrance: vi.fn(async () => ({ id: "entr-test" })),
  };
}

let server: http.Server;
let base: string;
let tools: ReturnType<typeof makeTools>;
let recordAuthedCall: ReturnType<typeof vi.fn<(at: string) => Promise<void>>>;

beforeEach(async () => {
  tools = makeTools();
  recordAuthedCall = vi.fn<(at: string) => Promise<void>>(async () => {});
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      // Cloud Functions と同じく、JSON の本文は解析済みで req.body に入れて渡す
      (req as http.IncomingMessage & { body?: unknown }).body = raw ? JSON.parse(raw) : undefined;
      void serveMcpInternal(req as never, res, TOKEN, {
        tools: tools as unknown as AgentTools,
        recordAuthedCall,
        now: () => new Date("2026-11-04T12:00:00Z"),
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcpInternal`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function rpc(method: string, params: unknown, headers: Record<string, string> = {}, id: number | null = 1): Promise<Response> {
  return fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  });
}

const authed = { authorization: `Bearer ${TOKEN}` };

describe("mcpInternal の認証", () => {
  it("Bearer なしは 401。道具も心拍も呼ばない", async () => {
    const res = await rpc("tools/call", { name: "propose_entrance", arguments: { prefCode: "33", url: "https://www.pref.example.jp/a", kind: "pref_fixed", rationale: "r" } });
    expect(res.status).toBe(401);
    expect(tools.listEntranceTargets).not.toHaveBeenCalled();
    expect(tools.fetchPrefPage).not.toHaveBeenCalled();
    expect(tools.proposeEntrance).not.toHaveBeenCalled();
    expect(recordAuthedCall).not.toHaveBeenCalled();
  });

  it("値違い、形式違いの Bearer も 401", async () => {
    for (const authorization of [`Bearer ${TOKEN}x`, "Bearer ", TOKEN, `Basic ${TOKEN}`]) {
      const res = await rpc("tools/list", {}, { authorization });
      expect(res.status).toBe(401);
    }
    expect(recordAuthedCall).not.toHaveBeenCalled();
  });

  it("認証の失敗の応答に、期待する値も入力も含めない", async () => {
    const res = await rpc("tools/list", {}, { authorization: "Bearer wrong-value-123" });
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("wrong-value-123");
  });

  it("OPTIONS、GET も認証なしでは 401（道具の存在を教えない）", async () => {
    expect((await fetch(base, { method: "GET", headers: { accept: ACCEPT } })).status).toBe(401);
    expect((await fetch(base, { method: "DELETE" })).status).toBe(401);
  });

  it("認証が通った GET は 405（POST だけ）", async () => {
    const res = await fetch(base, { method: "GET", headers: { accept: ACCEPT, ...authed } });
    expect(res.status).toBe(405);
  });
});

describe("mcpInternal の道具", () => {
  it("認証が通れば tools/list が 3 つの道具だけを返す", async () => {
    const res = await rpc("tools/list", {}, authed);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(json.result.tools.map((t) => t.name).sort()).toEqual(["fetch_pref_page", "list_entrance_targets", "propose_entrance"]);
  });

  it("認証の通った呼び出しだけ lastAuthedCallAt を更新する（JST の時刻）", async () => {
    await rpc("tools/list", {}, authed);
    expect(recordAuthedCall).toHaveBeenCalledTimes(1);
    expect(recordAuthedCall).toHaveBeenCalledWith("2026-11-04T21:00:00+09:00");
    await rpc("tools/list", {}, { authorization: "Bearer nope" });
    expect(recordAuthedCall).toHaveBeenCalledTimes(1);
  });

  it("心拍の書き込みが失敗しても、道具の応答は返す", async () => {
    recordAuthedCall.mockRejectedValueOnce(new Error("firestore down"));
    const res = await rpc("tools/list", {}, authed);
    expect(res.status).toBe(200);
  });

  it("propose_entrance は is_error でなく、id を返す", async () => {
    const args = { prefCode: "33", url: "https://www.pref.example.jp/a", kind: "pref_fixed", rationale: "畜産課の鳥インフルのページ" };
    const res = await rpc("tools/call", { name: "propose_entrance", arguments: args }, authed);
    const json = (await res.json()) as { result: { isError?: boolean; content: Array<{ type: string; text: string }> } };
    expect(json.result.isError).not.toBe(true);
    expect(JSON.parse(json.result.content[0]?.text ?? "{}")).toEqual({ id: "entr-test" });
    expect(tools.proposeEntrance).toHaveBeenCalledWith(args);
  });

  it("propose_entrance の入力が不正（kind が範囲外、根拠が 1000 字超）なら道具を呼ばず is_error", async () => {
    for (const bad of [
      { prefCode: "33", url: "https://www.pref.example.jp/a", kind: "maff_press", rationale: "r" },
      { prefCode: "33", url: "https://www.pref.example.jp/a", kind: "pref_fixed", rationale: "あ".repeat(1001) },
      { prefCode: "3", url: "https://www.pref.example.jp/a", kind: "pref_fixed", rationale: "r" },
    ]) {
      const res = await rpc("tools/call", { name: "propose_entrance", arguments: bad }, authed);
      const json = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
      expect(json.result?.isError === true || json.error !== undefined).toBe(true);
    }
    expect(tools.proposeEntrance).not.toHaveBeenCalled();
  });

  it("道具が例外を投げたら is_error で返し、例外の文は出さない", async () => {
    tools.listEntranceTargets.mockRejectedValueOnce(new Error("secret-internal-detail"));
    const res = await rpc("tools/call", { name: "list_entrance_targets", arguments: {} }, authed);
    const text = await res.text();
    expect(text).toContain("isError");
    expect(text).not.toContain("secret-internal-detail");
  });

  it("リクエストごとに別のサーバー（状態を持たない）。initialize なしの 2 回目も通る", async () => {
    expect((await rpc("tools/list", {}, authed)).status).toBe(200);
    expect((await rpc("tools/list", {}, authed)).status).toBe(200);
  });
});

describe("仮の tools.ts（X-14 が置き換える。ここでは県のドメインの外へ出ないことだけ確かめる）", () => {
  const politeFetchMock = vi.mocked(politeFetch);
  beforeEach(() => politeFetchMock.mockReset());

  it("listEntranceTargets は固定の 3 県（33、01、02）で、currentUrl は null", async () => {
    const targets = await agentTools.listEntranceTargets();
    expect(targets.map((t) => t.prefCode)).toEqual(["33", "01", "02"]);
    expect(targets.every((t) => t.currentUrl === null && t.failingSince === null)).toBe(true);
  });

  it("proposeEntrance は id を返すだけ（同じ県と URL は同じ id）", async () => {
    const t = agentTools;
    const p = { prefCode: "33", url: "https://www.pref.okayama.jp/page/1.html", kind: "pref_fixed" as const, rationale: "r" };
    const a = await t.proposeEntrance(p);
    const b = await t.proposeEntrance(p);
    expect(a.id).toMatch(/^entr-[0-9a-f]{24}$/);
    expect(a).toEqual(b);
  });

  it.each([
    ["別のドメイン", "33", "https://evil.example/x"],
    ["似たドメイン", "33", "https://www.pref.okayama.jp.evil.example/x"],
    ["別の県のドメイン", "33", "https://www.pref.aomori.lg.jp/x"],
    ["http", "33", "http://www.pref.okayama.jp/x"],
    ["ポート", "33", "https://www.pref.okayama.jp:8443/x"],
    ["利用者情報つき", "33", "https://user:pw" + "@www.pref.okayama.jp/x"],
    ["IP", "33", "http://192.168.0.1/"],
    ["javascript:", "33", "javascript:alert(1)"],
    ["対象にない県", "99", "https://www.pref.okayama.jp/x"],
    ["URL でない", "33", "not a url"],
  ])("%s は politeFetch を呼ばず domain_not_allowed", async (_name, prefCode, url) => {
    const r = await agentTools.fetchPrefPage(prefCode, url);
    expect(r).toMatchObject({ ok: false, error: "domain_not_allowed", text: null });
    expect(politeFetchMock).not.toHaveBeenCalled();
  });

  it("県のドメインの中なら politeFetch を allowUrl つきで呼び、allowUrl はリダイレクトの先の外を拒む", async () => {
    politeFetchMock.mockResolvedValue({ kind: "not_allowed", url: "https://evil.example/" });
    const r = await agentTools.fetchPrefPage("33", "https://www.pref.okayama.jp/page/1.html");
    expect(politeFetchMock).toHaveBeenCalledTimes(1);
    const opts = politeFetchMock.mock.calls[0]?.[1];
    expect(opts?.allowUrl?.(new URL("https://www.pref.okayama.jp/other"))).toBe(true);
    expect(opts?.allowUrl?.(new URL("https://evil.example/"))).toBe(false);
    expect(r).toMatchObject({ ok: false, error: "domain_not_allowed" });
  });

  it("本文は 40,000 字まで。本文と links の合計が 60,000 字を超えたら links を切って truncated", async () => {
    const html = `<html><head><title>題</title></head><body><p>${"あ".repeat(50_000)}</p>${Array.from({ length: 3000 }, (_, i) => `<a href="/p/${i}">リンク${i}</a>`).join("")}</body></html>`;
    politeFetchMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      finalUrl: "https://www.pref.okayama.jp/page/1.html",
      contentType: "text/html; charset=utf-8",
      body: Buffer.from(html, "utf8"),
      etag: null,
      lastModified: null,
      fetchedAt: "2026-11-04T12:00:00+09:00",
    });
    const r = await agentTools.fetchPrefPage("33", "https://www.pref.okayama.jp/page/1.html");
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect((r.text ?? "").length).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify({ text: r.text, links: r.links }).length).toBeLessThanOrEqual(60_000);
  });

  it("HTML 以外は unsupported_content_type、TLS の失敗は tls_error（設定を緩めない）", async () => {
    const t = agentTools;
    politeFetchMock.mockResolvedValueOnce({
      kind: "ok",
      status: 200,
      finalUrl: "https://www.pref.okayama.jp/a.pdf",
      contentType: "application/pdf",
      body: Buffer.from("%PDF"),
      etag: null,
      lastModified: null,
      fetchedAt: "2026-11-04T12:00:00+09:00",
    });
    expect(await t.fetchPrefPage("33", "https://www.pref.okayama.jp/a.pdf")).toMatchObject({ ok: false, error: "unsupported_content_type", text: null });
    politeFetchMock.mockResolvedValueOnce({ kind: "network_error", message: "m", code: "EPROTO", tls: true });
    expect(await t.fetchPrefPage("33", "https://www.pref.okayama.jp/b")).toMatchObject({ ok: false, error: "tls_error", text: null });
  });
});
