// agent の領域。入口を直すエージェント（X-01、X-14）。エージェントは提案だけを書き、見回り先（sources）は運営者の承認（I-07）でだけ変わる。
import Anthropic from "@anthropic-ai/sdk";
import { onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin";
import { AGENT_DEPLOYMENT_ID, AGENT_EVAL_HIDE_PREFS, ANTHROPIC_API_KEY, INTERNAL_MCP_TOKEN } from "../secrets";
import { serveMcpInternal } from "./mcpInternal";
import { handleCheckAgentRuns, handleRunEntranceAgent } from "./runs";
import { firestoreToolDeps } from "./store";
import { createAgentTools, parseHidePrefs } from "./tools";

export type { AgentHeartbeat } from "./runs";

/** 本物の道具。受け入れの試験で隠す県は、呼ぶたびに設定（AGENT_EVAL_HIDE_PREFS）から読む。 */
const agentTools = createAgentTools(firestoreToolDeps(() => parseHidePrefs(AGENT_EVAL_HIDE_PREFS.value())));

/** Managed Agents のエージェントだけが呼ぶ内部用の MCP。Bearer INTERNAL_MCP_TOKEN。公開の MCP（X-12）とは別。 */
export const mcpInternal = onRequest(
  { invoker: "public", secrets: [INTERNAL_MCP_TOKEN], timeoutSeconds: 300, memory: "512MiB" },
  (req, res) =>
    serveMcpInternal(req, res, INTERNAL_MCP_TOKEN.value(), {
      tools: agentTools,
      // merge なので、checkAgentRuns の countedRunIds などを消さない。
      recordAuthedCall: async (at) => {
        await db.doc("usage/agent").set({ lastAuthedCallAt: at }, { merge: true });
      },
    }),
);

/** claude の鍵は handler の中で読む。 */
const anthropic = (maxRetries: number) => new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 30_000, maxRetries });

/** 運営者の画面のボタン。エージェントを手動で 1 回実行する（運営者だけ）。 */
export const runEntranceAgent = onCall({ timeoutSeconds: 60, memory: "256MiB", secrets: [ANTHROPIC_API_KEY] }, async (request) =>
  handleRunEntranceAgent(
    // 実行は冪等でないので、再試行しない（二重に走ると費用が二重になる）。
    { client: anthropic(0), deploymentId: AGENT_DEPLOYMENT_ID.value(), now: () => new Date() },
    request.auth ? { uid: request.auth.uid, operator: (request.auth.token as { operator?: unknown }).operator === true } : null,
  ),
);

/** 毎朝 08:00。直近の実行の費用を数え、失敗を運営者の箱に入れ、費用の上限で定期実行を止める。 */
export const checkAgentRuns = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 120, memory: "256MiB", secrets: [ANTHROPIC_API_KEY] },
  async () => {
    await handleCheckAgentRuns({ client: anthropic(1),deploymentId: AGENT_DEPLOYMENT_ID.value(), now: () => new Date() });
  },
);
