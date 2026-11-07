// 相談から対策項目に足した対策（farms/{farmId}/reviews/{cardId}）の型と決まり。規則は firestore.rules の reviews。
// 足したときは { addedAt, addedBy } だけ。実施の記録は、人が対策項目の画面で付ける（AI も相談の関数も書かない）。

/** 実施の状態。文書に無い（足したまま）は「記録なし」で、画面では「まだ」として出す */
export type ReviewStatus = "pending" | "later" | "done";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "later", "done"];

/** 画面の状態の名前 */
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "まだ",
  later: "後でやる",
  done: "やった",
};

/**
 * メモの上限。数え方は規則の string.size() と同じ UTF-16 の単位（JavaScript の .length、input の maxLength と同じ）。
 * 日本語の文字は 1 字ずつ、絵文字は 2 と数える（模擬環境で確かめた。絵文字 20 個は通り、21 個は拒まれる）
 */
export const REVIEW_NOTE_MAX = 40;

/** 保存してある形。status・note・updatedAt・updatedBy は記録を付けたときだけある */
export interface ReviewDoc {
  addedAt: unknown;
  addedBy: string;
  status?: ReviewStatus;
  note?: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export const isReviewStatus = (v: unknown): v is ReviewStatus => typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v);

/** メモの問題。null は保存できる。規則と同じ: 40（UTF-16 の単位）まで、改行（\n・\r）なし */
export function reviewNoteProblem(note: string): null | "too_long" | "newline" {
  if (/[\r\n]/.test(note)) return "newline";
  if (note.length > REVIEW_NOTE_MAX) return "too_long";
  return null;
}

/** 並び順の重み。「後でやる」「まだ」（記録なしを含む）を上、「やった」を下。同じ重みは元の順のまま */
export function reviewStatusRank(status: ReviewStatus | null): number {
  return status === "later" ? 0 : status === "done" ? 2 : 1;
}
