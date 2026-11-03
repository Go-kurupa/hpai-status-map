// api の領域。読み取り専用の公開 API（X-12）。認証なし、毎分 60 回のメモリ内の制限。
// Hosting の rewrite が /api/v1/** をここへ渡す（契約 1.5）。
import { onRequest } from "firebase-functions/v2/https";
import { createFirestoreDeps } from "./firestoreDeps";
import { serveApi } from "./handler";
import { createRateLimiter } from "./rateLimit";

const getDeps = createFirestoreDeps();
const limiter = createRateLimiter(60);

export const api = onRequest(
  { invoker: "public", timeoutSeconds: 60, memory: "512MiB", maxInstances: 3 },
  (req, res) => serveApi(req, res, { getDeps, limiter }),
);
