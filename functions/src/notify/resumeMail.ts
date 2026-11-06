// 配信の再開（M-13）。止めた本人が、通知の設定の画面から自分だけを戻す。運営者が戻す形は作らない（設計書 §12）。
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { Farm } from "@hpai/shared/types";
import { db } from "../admin";

/** その農場の会員なら、自分の uid だけを unsubscribedUids から外す（外れていても同じ）。 */
export async function handleResumeMail(firestore: Firestore, uid: string | undefined, farmId: unknown): Promise<void> {
  if (!uid) throw new HttpsError("unauthenticated", "ログインしてください");
  if (typeof farmId !== "string" || farmId === "" || farmId.length > 128 || farmId.includes("/")) {
    throw new HttpsError("invalid-argument", "農場の指定が違います");
  }
  const ref = firestore.collection("farms").doc(farmId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "農場が見つかりません");
  const farm = snap.data() as Partial<Farm>;
  if (!Array.isArray(farm.memberUids) || !farm.memberUids.includes(uid)) {
    throw new HttpsError("permission-denied", "この農場の会員だけが戻せます");
  }
  if (Array.isArray(farm.unsubscribedUids) && !farm.unsubscribedUids.includes(uid)) return;
  await ref.update({ unsubscribedUids: FieldValue.arrayRemove(uid) });
}

/** `{farmId}` → `{resumed: true}`。自分だけを戻せる。 */
export const resumeMail = onCall({ timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  if (request.auth && request.auth.token.member !== true) {
    throw new HttpsError("permission-denied", "会員だけが戻せます");
  }
  await handleResumeMail(db, request.auth?.uid, (request.data as { farmId?: unknown } | null)?.farmId);
  return { resumed: true as const };
});
