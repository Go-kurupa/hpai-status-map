// drafts の領域。事例が書かれたときの声かけ文の下書き（M-18）。近隣への説明文（M-19）が後でここに足される。
import Anthropic from "@anthropic-ai/sdk";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type { Case } from "@hpai/shared/types";
import { ANTHROPIC_API_KEY } from "../secrets";
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
