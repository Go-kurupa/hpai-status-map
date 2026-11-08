// farm の領域。招待で会員になる redeemInvite と、農場に会員を足す招待を作る createFarmInvite（M-01）、
// 審査員用のリンクでログインする judgeSignIn。
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin";
import { APP_URL, JUDGE_LINK_TOKEN } from "../secrets";
import { handleCreateFarmInvite } from "./createFarmInvite";
import { handleDeleteFarmData } from "./deleteFarmData";
import { firestoreJudgeAttempt } from "./judgeAttempts";
import { ensureJudgeFarm } from "./judgeFarm";
import { handleJudgeSignIn } from "./judgeSignIn";
import { handleRedeemInvite } from "./redeemInvite";

/** `{code}` → `{farmId: string | null}`。ログイン済みなら claim がなくても呼べる（会員になるための入口）。 */
export const redeemInvite = onCall({ timeoutSeconds: 60, memory: "256MiB" }, (request) =>
  handleRedeemInvite(
    { db, auth: getAuth(), now: () => new Date() },
    request.auth?.uid,
    (request.data as { code?: unknown } | null)?.code,
  ),
);

/** `{farmId, confirmName}` → `{deleted: true}`。その農場の会員だけ。取り消せない（M-04）。 */
export const deleteFarmData = onCall({ timeoutSeconds: 300, memory: "256MiB" }, (request) => {
  if (request.auth && request.auth.token.member !== true) {
    throw new HttpsError("permission-denied", "会員だけが消せます");
  }
  return handleDeleteFarmData(db, request.auth?.uid, request.data);
});

/** `{farmId}` → `{code, url}`。その農場の会員だけ。 */
export const createFarmInvite = onCall({ timeoutSeconds: 60, memory: "256MiB" }, (request) =>
  handleCreateFarmInvite(
    { db, now: () => new Date(), appUrl: APP_URL.value() },
    request.auth ? { uid: request.auth.uid, member: request.auth.token.member === true } : null,
    (request.data as { farmId?: unknown } | null)?.farmId,
  ),
);

/**
 * `{token}` → `{customToken}`。審査員用のリンクの文字列が Secret と合えば、審査員の会員と農場をそろえ、
 * その会員（claim の judge 付き）のカスタムトークンを返す。合わなければ permission-denied。ログインは要らない。
 * 接続元の IP ごとに間違いが 1 時間に 20 回に達した後の間違いは resource-exhausted（正しい文字列は必ず通す）。
 */
export const judgeSignIn = onCall({ timeoutSeconds: 120, memory: "256MiB", maxInstances: 5, secrets: [JUDGE_LINK_TOKEN] }, (request) =>
  handleJudgeSignIn(
    {
      secret: JUDGE_LINK_TOKEN.value(),
      attempt: firestoreJudgeAttempt(db, () => new Date()),
      ensure: () => ensureJudgeFarm({ db, auth: getAuth(), now: () => new Date() }),
      createToken: (uid) => getAuth().createCustomToken(uid, { judge: true }),
    },
    (request.data as { token?: unknown } | null)?.token,
    // 接続元の IP。sha256 にしてから数える（そのままは保存しない）
    request.rawRequest.ip,
  ),
);
