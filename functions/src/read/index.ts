// read の領域。保存された新しい文書を読んで事例に流し込む readOnDocument（I-05）。
// 読み取りの部品は claude.ts（I-03）、判断は shared/src/read（I-04）、計画は apply.ts、流れは pipeline.ts。
import Anthropic from "@anthropic-ai/sdk";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { loadGeoStore } from "../geo/loadGeo";
import { ANTHROPIC_API_KEY } from "../secrets";
import { readDocument } from "./pipeline";

/** documents/{docId} の作成で動く。再試行しない（reading のまま取り残さないため pipeline が例外を確認中に倒す）。 */
export const readOnDocument = onDocumentCreated(
  { document: "documents/{docId}", retry: false, timeoutSeconds: 540, memory: "1GiB", secrets: [ANTHROPIC_API_KEY] },
  async (event) => {
    const geo = await loadGeoStore();
    // 2 回の呼び出しが 540 秒に収まるよう、1 回 240 秒、再試行 1 回まで
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 240_000, maxRetries: 1 });
    await readDocument(event.params.docId, { client, geo, now: () => new Date() });
  },
);
