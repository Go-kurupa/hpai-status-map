// mcp の領域。認証なしの読み取り専用の公開 MCP（X-12）。毎分 60 回のメモリ内の制限。
// Hosting の rewrite が /mcp をここへ渡す（契約 1.5）。内部用の MCP は agent の領域の mcpInternal（Bearer つき）で、別物。
import { onRequest } from "firebase-functions/v2/https";
import { createFirestoreDeps } from "../api/firestoreDeps";
import { createRateLimiter } from "../api/rateLimit";
import { servePublicMcp } from "./server";

const getDeps = createFirestoreDeps();
const limiter = createRateLimiter(60);

export const mcp = onRequest(
  { invoker: "public", timeoutSeconds: 60, memory: "512MiB", maxInstances: 3 },
  (req, res) => servePublicMcp(req, res, { getDeps, limiter }),
);
