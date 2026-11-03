import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveMcpInternal } from "../src/agent/mcpInternal";
import type { AgentTools } from "../src/agent/tools";

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

  it("OPTIONS、GET、DELETE も認証なしでは 401（道具の存在を教えない）", async () => {
    expect((await fetch(base, { method: "OPTIONS" })).status).toBe(401);
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

  it("認証が通っても POST でなければ心拍を残さない（405）", async () => {
    await fetch(base, { method: "GET", headers: { accept: ACCEPT, ...authed } });
    expect(recordAuthedCall).not.toHaveBeenCalled();
  });

  it("心拍の書き込みが終わらなくても、3 秒で切って道具の応答を返す", async () => {
    recordAuthedCall.mockImplementationOnce(() => new Promise<void>(() => {}));
    const res = await rpc("tools/list", {}, authed);
    expect(res.status).toBe(200);
  }, 10_000);

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
