import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/api/rateLimit";
import { servePublicMcp } from "../src/mcp/server";
import { NOW, makeDeps } from "./helpers/apiDeps";

const ACCEPT = "application/json, text/event-stream";
let server: http.Server;
let base: string;
let nowMs: number;
let getDepsCalls: number;

beforeEach(async () => {
  const { deps } = await makeDeps();
  nowMs = NOW.getTime();
  getDepsCalls = 0;
  const limiter = createRateLimiter(60);
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      // Cloud Functions と同じく、JSON の本文は解析済みで req.body に入れて渡す
      (req as http.IncomingMessage & { body?: unknown }).body = raw ? JSON.parse(raw) : undefined;
      void servePublicMcp(req as never, res, { getDeps: async () => (getDepsCalls++, deps), limiter, now: () => new Date(nowMs) });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const rpc = (method: string, params: unknown, ip = "203.0.113.7", id = 1) =>
  fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, "x-forwarded-for": ip },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

describe("公開 MCP の HTTP", () => {
  it("認証なしの POST で tools/list が通り、道具は 4 つ", async () => {
    const res = await rpc("tools/list", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["get_area_status", "get_official_guidance", "get_watch_status", "list_cases"]);
  });

  it("tools/call list_cases が通る", async () => {
    const res = await rpc("tools/call", { name: "list_cases", arguments: { season: 2025, prefCode: "33" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { structuredContent: { data: unknown[] } } };
    expect(body.result.structuredContent.data).toHaveLength(1);
  });

  it("GET と DELETE は 405（Allow: POST、依存も読まない）", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await fetch(base, { method, headers: { accept: ACCEPT } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect(getDepsCalls).toBe(0);
  });

  it("毎分 60 回: 61 回目は 429（no-store）、次の分は通る。別の IP は別に数える", async () => {
    for (let i = 0; i < 60; i++) expect((await rpc("tools/list", {}, "203.0.113.8", i + 1)).status).toBe(200);
    const limited = await rpc("tools/list", {}, "203.0.113.8", 99);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect((await rpc("tools/list", {}, "203.0.113.9")).status).toBe(200);
    nowMs += 60_000;
    expect((await rpc("tools/list", {}, "203.0.113.8")).status).toBe(200);
  });
});
