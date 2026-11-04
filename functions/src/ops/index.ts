// ops の領域。手元から本番を管理する opsAdmin（F-02）。後のタスクがここから export する。
import { onRequest } from "firebase-functions/v2/https";
import { GMAIL_APP_PASSWORD, OPS_TOKEN } from "../secrets";
import { serveOps } from "./handlers";

/** run-watch-now は 1 組が数分かかり、3 組で 540 秒（第 2 世代の HTTP の上限）に近いので、timeout を上限にした。POST、本文 `{op, ...}`、Bearer OPS_TOKEN。呼び方は scripts/ops.ts（契約 1.7）。 */
export const opsAdmin = onRequest(
  { invoker: "public", secrets: [OPS_TOKEN, GMAIL_APP_PASSWORD], timeoutSeconds: 540, memory: "512MiB" },
  (req, res) => serveOps(req, res, OPS_TOKEN.value()),
);
