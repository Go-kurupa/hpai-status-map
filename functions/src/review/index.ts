// review の領域。確認の箱への投入口（I-02）と、運営者が解決する resolveReviewItem、getReviewDetail（I-07）、段階の日付を直す correctCaseStage（Q-n）。
import { onCall } from "firebase-functions/v2/https";
import { db } from "../admin";
import { loadGeoStore } from "../geo/loadGeo";
import { handleCorrectCaseStage } from "./correct";
import { handleGetReviewDetail, handleResolveReviewItem, type Caller } from "./resolve";

export { enqueueReview, reviewAlertId, reviewDocumentId } from "./queue";
export type { NewReviewItem } from "./queue";

/** claim はクライアントの申告でなく、検証済みの ID トークンから読む。 */
const callerOf = (auth: { uid: string; token: object } | undefined): Caller | null =>
  auth ? { uid: auth.uid, operator: (auth.token as { operator?: unknown }).operator === true } : null;

/** `ResolveRequest` → `{ok:true, caseId}`。operator だけ（設計書 §9.6、§10.2、§13）。 */
export const resolveReviewItem = onCall({ timeoutSeconds: 120, memory: "256MiB" }, async (request) =>
  handleResolveReviewItem({ db, geo: await loadGeoStore(), now: () => new Date() }, callerOf(request.auth), request.data),
);

/** `{itemId}` → `ReviewDetail`（引用を含めない）。operator だけ。 */
export const getReviewDetail = onCall({ timeoutSeconds: 120, memory: "256MiB" }, async (request) =>
  handleGetReviewDetail({ db, geo: await loadGeoStore(), now: () => new Date() }, callerOf(request.auth), request.data),
);

/** `CorrectStageRequest` → `{ok:true, caseId, recordId}`。operator だけ。事例にすでにある段階の日付を直す（Q-n）。 */
export const correctCaseStage = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) =>
  handleCorrectCaseStage({ db, geo: await loadGeoStore(), now: () => new Date() }, callerOf(request.auth), request.data),
);
