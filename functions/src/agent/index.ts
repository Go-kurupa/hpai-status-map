// agent の領域。入口を直すエージェント（X-01、X-14）。
import { onRequest } from "firebase-functions/v2/https";
import type { IsoDateTime } from "@hpai/shared/types";
import { db } from "../admin";
import { INTERNAL_MCP_TOKEN } from "../secrets";
import { serveMcpInternal } from "./mcpInternal";
import { agentTools } from "./tools";

/** usage/agent。lastAuthedCallAt は mcpInternal が、countedRunIds は X-14 の checkAgentRuns が書く。 */
export interface AgentHeartbeat {
  lastAuthedCallAt: IsoDateTime | null;
  countedRunIds: string[];
}

/** Managed Agents のエージェントだけが呼ぶ内部用の MCP。Bearer INTERNAL_MCP_TOKEN。公開の MCP（X-12）とは別。 */
export const mcpInternal = onRequest(
  { invoker: "public", secrets: [INTERNAL_MCP_TOKEN], timeoutSeconds: 300, memory: "512MiB" },
  (req, res) =>
    serveMcpInternal(req, res, INTERNAL_MCP_TOKEN.value(), {
      tools: agentTools,
      // merge なので、X-14 の countedRunIds を消さない。
      recordAuthedCall: async (at) => {
        await db.doc("usage/agent").set({ lastAuthedCallAt: at } satisfies Partial<AgentHeartbeat>, { merge: true });
      },
    }),
);
