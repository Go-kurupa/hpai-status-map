// ops の領域。手元から本番を管理する opsAdmin（F-02）。後のタスクがここから export する。
import { onRequest } from "firebase-functions/v2/https";
import { OPS_TOKEN } from "../secrets";
import { serveOps } from "./handlers";

/** POST、本文 `{op, ...}`、Bearer OPS_TOKEN。呼び方は scripts/ops.ts（契約 1.7）。 */
export const opsAdmin = onRequest(
  { invoker: "public", secrets: [OPS_TOKEN], timeoutSeconds: 120, memory: "256MiB" },
  (req, res) => serveOps(req, res, OPS_TOKEN.value()),
);
