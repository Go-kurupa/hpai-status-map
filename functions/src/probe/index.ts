// probe の領域。全入口への到達試験 probeEntrances（F-03）。呼び方は scripts/ops.ts probe。
import { onRequest } from "firebase-functions/v2/https";
import { OPS_TOKEN } from "../secrets";
import { serveProbe } from "./run";

/** POST `{targets}`、Bearer OPS_TOKEN。応答は 1 行 1 件の NDJSON（本文は返さない）。 */
export const probeEntrances = onRequest(
  { invoker: "public", secrets: [OPS_TOKEN], timeoutSeconds: 1800, memory: "512MiB" },
  (req, res) => serveProbe(req, res, OPS_TOKEN.value()),
);
