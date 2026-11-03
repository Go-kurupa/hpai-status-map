// 運営者の確認の箱（reviewQueue）への投入口（I-02）。M-02、X-14 もここを通す。解決は resolveReviewItem（I-07）だけ。
import { toJstIso } from "@hpai/shared/dates";
import type { ReviewItem } from "@hpai/shared/read/types";
import { db } from "../admin";

/** union の腕ごとに Omit する（普通の Omit は union の共通の項目だけに潰れる）。 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NewReviewItem = DistributiveOmit<ReviewItem, "createdAt" | "resolvedAt">;

const ALREADY_EXISTS = 6;

/** 箱に入れる。createdAt と resolvedAt:null はここで入れる。同じ id は 2 度入らない（create()）。入れたら true、すでにあれば false。 */
export async function enqueueReview(item: NewReviewItem, now: Date): Promise<boolean> {
  try {
    await db.doc(`reviewQueue/${item.id}`).create({ ...item, createdAt: toJstIso(now), resolvedAt: null });
    return true;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === ALREADY_EXISTS) return false;
    throw e;
  }
}

/** 文書の確認の id。 */
export const reviewDocumentId = (documentId: string): string => `doc-${documentId}`;

/** 警告の id。key に「/」を入れない（Firestore の id に使えない）。 */
export const reviewAlertId = (alert: string, key: string): string => `alert-${alert}-${key}`;
