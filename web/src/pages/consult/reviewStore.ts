// 相談から対策項目に足したカード（farms/{farmId}/reviews/{cardId}）。規則は firestore.rules の reviews。
// 足すときは { addedAt, addedBy } だけ（状態を付けて足せない＝AI や相談の画面が実施済みにできない）。
// 実施の記録（status・note）は、対策項目の画面で人が付ける。更新は updatedAt・updatedBy と一緒に updateDoc で書く
// （外された文書を作り直さない）。足し直し（同じ id への setDoc）は規則が拒む。
// firebase/* と ../../firebase は動的 import だけにする（静的に読むと公開の画面に Firebase が載る）。
import { isReviewStatus, reviewNoteProblem, type ReviewStatus } from "@hpai/shared/consult/review";
import { useMemo } from "react";
import { useRecordStore } from "../../data/context";

/** 対策項目の画面が使う 1 件。uid は渡さず、更新したのが自分かどうか（mine）だけを渡す */
export interface ReviewItem {
  id: string;
  /** null は記録なし（前に足したまま）。画面では「まだ」として出す */
  status: ReviewStatus | null;
  note: string;
  updatedAt: Date | null;
  /** 最後に更新したのが自分か。更新がなければ null */
  mine: boolean | null;
}

/** 状態だけ、またはメモだけを変える（片方を押したときに、もう片方の未保存の入力を送らない） */
export type ReviewChange = { status: ReviewStatus } | { note: string };

export interface ReviewStore {
  /** 足す。同じカードを 2 度足すと update になり規則が拒むので、足し済みは呼ばないこと */
  addReview(cardId: string): Promise<void>;
  /** 足したカードの id の一覧（相談の画面の足し済みの判定） */
  listReviews(): Promise<string[]>;
  /** 足したカードと実施の記録（対策項目の画面） */
  listReviewItems(): Promise<ReviewItem[]>;
  /** 実施の記録を付ける。外された文書には書けず、失敗を投げる */
  markReview(cardId: string, change: ReviewChange): Promise<void>;
  removeReview(cardId: string): Promise<void>;
}

/** 農場がない会員への案内（画面は code が no-farm のときに設定へのリンクを添える） */
export const NO_FARM_MESSAGE = "対策項目に足すには、先に『農場と通知の設定』で農場を登録してください。";
const noFarmError = () => Object.assign(new Error(NO_FARM_MESSAGE), { code: "no-farm" });

const toDate = (v: unknown): Date | null => {
  const f = (v as { toDate?: unknown } | null)?.toDate;
  if (typeof f !== "function") return null;
  const d = (f as () => unknown).call(v);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
};

/** farmIdOf: 自分の農場の id。農場がなければ null */
export function createReviewStore(farmIdOf: () => Promise<string | null>): ReviewStore {
  async function open() {
    const farmId = await farmIdOf();
    const { getFirebase } = await import("../../firebase");
    const { auth, db } = await getFirebase();
    await auth.authStateReady();
    return { farmId, db, uid: auth.currentUser?.uid ?? null };
  }
  async function readAll() {
    const { farmId, db, uid } = await open();
    if (!farmId) return { uid, docs: [] };
    const fs = await import("firebase/firestore");
    const snap = await fs.getDocs(fs.collection(db, "farms", farmId, "reviews"));
    return { uid, docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })) };
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
      return (await readAll()).docs.map((d) => d.id);
    },
    async listReviewItems() {
      const { uid, docs } = await readAll();
      return docs.map(({ id, data }) => {
        const by = typeof data["updatedBy"] === "string" ? data["updatedBy"] : null;
        return {
          id,
          status: isReviewStatus(data["status"]) ? data["status"] : null,
          note: typeof data["note"] === "string" ? data["note"] : "",
          updatedAt: toDate(data["updatedAt"]),
          mine: by === null ? null : by === uid,
        };
      });
    },
    async markReview(cardId, change) {
      if ("status" in change && !isReviewStatus(change.status)) throw new Error("知らない状態です");
      if ("note" in change && reviewNoteProblem(change.note) !== null) throw new Error("メモは 40 字まで、改行なしです");
      const { farmId, db, uid } = await open();
      if (!farmId) throw noFarmError();
      if (!uid) throw new Error("ログインしていません");
      const fs = await import("firebase/firestore");
      const body = "status" in change ? { status: change.status } : { note: change.note };
      await fs.updateDoc(fs.doc(db, "farms", farmId, "reviews", cardId), { ...body, updatedAt: fs.serverTimestamp(), updatedBy: uid });
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
