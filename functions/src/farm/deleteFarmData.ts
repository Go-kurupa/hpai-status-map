import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { Farm } from "@hpai/shared/types";

/**
 * 農場の全データを消す。取り消せない。
 * 消すもの: 農場の文書とサブコレクション（鶏舎、死亡数、点検と消毒）、その農場の sentNotices と招待。
 * 消えないもの: Authentication のアカウント、送ったメールの控え（Gmail）、他の農場、公開の事例、caseDrafts。
 * 同じ農場の会員なら、だれでも消せる（プライバシーの説明にも書いてある）。農場の名前を入れて確かめる。
 */
export async function handleDeleteFarmData(
  db: Firestore,
  uid: string | undefined,
  input: unknown,
): Promise<{ deleted: true }> {
  if (!uid) throw new HttpsError("unauthenticated", "ログインしてください");
  const { farmId, confirmName } = (input ?? {}) as { farmId?: unknown; confirmName?: unknown };
  if (typeof farmId !== "string" || farmId === "" || farmId.length > 128 || farmId.includes("/")) {
    throw new HttpsError("invalid-argument", "農場の指定が違います");
  }
  if (typeof confirmName !== "string") throw new HttpsError("invalid-argument", "農場の名前を入れてください");

  const farmRef = db.collection("farms").doc(farmId);
  const snap = await farmRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "農場が見つかりません");
  const farm = snap.data() as Farm;
  if (!Array.isArray(farm.memberUids) || !farm.memberUids.includes(uid)) {
    throw new HttpsError("permission-denied", "この農場の会員だけが消せます");
  }
  // 名前が未設定の農場は、空の入力で消せてしまわないよう、名前を入れてから消してもらう
  if (typeof farm.name !== "string" || farm.name === "" || confirmName !== farm.name) {
    throw new HttpsError("failed-precondition", "農場の名前が合いません");
  }

  // 農場の文書は最後に消す。途中で失敗しても、会員が同じ操作をやり直せる
  for (const col of ["sentNotices", "invites"] as const) {
    const rows = await db.collection(col).where("farmId", "==", farmId).get();
    for (let i = 0; i < rows.docs.length; i += 400) {
      const batch = db.batch();
      for (const d of rows.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
  }
  await db.recursiveDelete(farmRef);
  return { deleted: true };
}
