// farm の領域。招待で会員になる redeemInvite と、農場に会員を足す招待を作る createFarmInvite（M-01）。
import { getAuth } from "firebase-admin/auth";
import { onCall } from "firebase-functions/v2/https";
import { db } from "../admin";
import { APP_URL } from "../secrets";
import { handleCreateFarmInvite } from "./createFarmInvite";
import { handleRedeemInvite } from "./redeemInvite";

/** `{code}` → `{farmId: string | null}`。ログイン済みなら claim がなくても呼べる（会員になるための入口）。 */
export const redeemInvite = onCall({ timeoutSeconds: 60, memory: "256MiB" }, (request) =>
  handleRedeemInvite(
    { db, auth: getAuth(), now: () => new Date() },
    request.auth?.uid,
    (request.data as { code?: unknown } | null)?.code,
  ),
);

/** `{farmId}` → `{code, url}`。その農場の会員だけ。 */
export const createFarmInvite = onCall({ timeoutSeconds: 60, memory: "256MiB" }, (request) =>
  handleCreateFarmInvite(
    { db, now: () => new Date(), appUrl: APP_URL.value() },
    request.auth ? { uid: request.auth.uid, member: request.auth.token.member === true } : null,
    (request.data as { farmId?: unknown } | null)?.farmId,
  ),
);
