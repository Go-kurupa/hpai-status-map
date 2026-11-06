// 相談から対策項目に足したカード（farms/{farmId}/reviews/{cardId}）。規則は firestore.rules の reviews。
// 項目は { addedAt, addedBy } だけで、上書き（update）は規則が拒む。足すか、消すか、読むかだけ。
// firebase/* と ../../firebase は動的 import だけにする（静的に読むと公開の画面に Firebase が載る）。
import { useMemo } from "react";
import { useRecordStore } from "../../data/context";

export interface ReviewStore {
  /** 足す。同じカードを 2 度足すと update になり規則が拒むので、足し済みは呼ばないこと */
  addReview(cardId: string): Promise<void>;
  /** 足したカードの id の一覧 */
  listReviews(): Promise<string[]>;
  removeReview(cardId: string): Promise<void>;
}

/** 農場がない会員への案内（画面は code が no-farm のときに設定へのリンクを添える） */
export const NO_FARM_MESSAGE = "対策項目に足すには、先に『農場と通知の設定』で農場を登録してください。";
const noFarmError = () => Object.assign(new Error(NO_FARM_MESSAGE), { code: "no-farm" });

/** farmIdOf: 自分の農場の id。農場がなければ null */
export function createReviewStore(farmIdOf: () => Promise<string | null>): ReviewStore {
  async function open() {
    const farmId = await farmIdOf();
    const { getFirebase } = await import("../../firebase");
    const { auth, db } = await getFirebase();
    await auth.authStateReady();
    return { farmId, db, uid: auth.currentUser?.uid ?? null };
  }
  return {
    async addReview(cardId) {
      const { farmId, db, uid } = await open();
      if (!farmId) throw noFarmError();
      if (!uid) throw new Error("ログインしていません");
      const fs = await import("firebase/firestore");
      await fs.setDoc(fs.doc(db, "farms", farmId, "reviews", cardId), { addedAt: fs.serverTimestamp(), addedBy: uid });
    },
    async listReviews() {
      const { farmId, db } = await open();
      if (!farmId) return [];
      const fs = await import("firebase/firestore");
      const snap = await fs.getDocs(fs.collection(db, "farms", farmId, "reviews"));
      return snap.docs.map((d) => d.id);
    },
    async removeReview(cardId) {
      const { farmId, db } = await open();
      if (!farmId) throw noFarmError();
      const fs = await import("firebase/firestore");
      await fs.deleteDoc(fs.doc(db, "farms", farmId, "reviews", cardId));
    },
  };
}

/** 記録の口から農場を探す版（相談の画面用） */
export function useReviewStore(): ReviewStore {
  const records = useRecordStore();
  return useMemo(() => createReviewStore(async () => (await records.getFarm())?.id ?? null), [records]);
}
