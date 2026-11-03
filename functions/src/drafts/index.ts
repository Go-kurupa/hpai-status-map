// drafts の領域。事例が書かれたときの声かけ文の下書き（M-18）と、近隣への説明文の下書き（M-19）。
import Anthropic from "@anthropic-ai/sdk";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import type { Case } from "@hpai/shared/types";
import { ANTHROPIC_API_KEY } from "../secrets";
import { recordUsage } from "../usage/record";
import { readRuntimeSettings, readUsageMonth } from "../usage/settings";
import { reserveNeighborCall } from "./dailyLimit";
import { NEIGHBOR_DAILY_LIMIT, handleNeighborDraft } from "./neighborDraft";
import { draftForCase } from "./workerDraft";

/**
 * cases/{caseId} の書き込みで動く。疑いか確定になった事例に、声かけ文の下書きを一度だけ作る。
 * 削除（after がない）と、作ってはいけない事例（確認中、再現、否定、市町村なし）は何もしない。
 */
export const draftOnCaseWritten = onDocumentWritten(
  { document: "cases/{caseId}", timeoutSeconds: 300, memory: "256MiB", secrets: [ANTHROPIC_API_KEY] },
  async (event) => {
    const after = event.data?.after.data() as Case | undefined;
    if (!after) return;
    // 1 回の呼び出しが 300 秒に収まるよう、1 回 120 秒、再試行 1 回まで
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 120_000, maxRetries: 1 });
    await draftForCase(event.params.caseId, after, { client, now: () => new Date() });
  },
);

/**
 * `{measures, audience}` → `{farmPart, officialPart, source, failures}`。会員だけ（M-19）。
 * 本人が入力した文だけを Claude に渡す。農場は読まない（handleNeighborDraft は db を受け取らない）。
 * 会員 1 人は 1 日 10 回まで（取引で数える）。月の費用は soft の上限で止め、同時に動くのは 3 つまで。
 * 1 回の呼び出しが 120 秒に収まるよう、Claude への 1 回は 90 秒、再試行なし（切れても雛形を返せるように）。
 */
export const draftNeighborExplainer = onCall(
  { timeoutSeconds: 120, memory: "256MiB", maxInstances: 3, secrets: [ANTHROPIC_API_KEY] },
  (request) =>
    handleNeighborDraft(
      {
        client: () => new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 90_000, maxRetries: 0 }),
        now: () => new Date(),
        settings: readRuntimeSettings,
        month: readUsageMonth,
        record: recordUsage,
        reserve: (uid, now) => reserveNeighborCall(uid, now, NEIGHBOR_DAILY_LIMIT),
      },
      request.auth ? { uid: request.auth.uid, member: request.auth.token.member === true } : null,
      request.data,
    ),
);
