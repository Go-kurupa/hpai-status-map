// 見回りの結果を運営者の箱と確認状況に残す（I-02）。tick の結果（reviews、missing）を捨てない。
import { logger } from "firebase-functions";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { db } from "../admin";
import { enqueueReview, reviewAlertId, reviewDocumentId, type NewReviewItem } from "../review/queue";
import type { MissingNote, ReviewNote } from "./deps";
import { computeWatchStatuses, shouldAlertFailing, watchFailingItem } from "./status";
import type { TickReport } from "./tick";

/** 読み取りの箱に回す文書（国の定型文が読めない、市町村が合わない、題が想定外、など）。 */
export function reviewItemOf(n: ReviewNote): NewReviewItem {
  return {
    id: reviewDocumentId(n.documentId),
    kind: "document",
    documentId: n.documentId,
    url: n.url,
    prefCode: n.prefCode,
    title: n.title,
    reasons: [n.reason],
    hasOutbreakWords: hasOutbreakWords(n.title),
  };
}

/** 国の解除の発表に対応する事例がない（national_missing）。同じ発表と番号は 1 件だけ。 */
export function missingItemOf(m: MissingNote): NewReviewItem {
  return {
    id: reviewAlertId("national_missing", `${m.prefCode}-${m.nationalNos.join("-")}-${m.date}`),
    kind: "alert",
    alert: "national_missing",
    prefCode: m.prefCode,
    caseId: null,
    message: `国の移動制限の解除の発表（${m.date}、${m.muniName}、国内${m.nationalNos.join("・")}例目）に対応する事例がありません。事例を確かめ、必要なら解除を反映してください。 ${m.url}`,
  };
}

/**
 * 見回りの結果を残す。順は、確認の箱（取りこぼしを最優先）→ 国の解除の欠け → 確認状況 47 件と 24 時間の警告。
 * どれかが失敗しても残りは続け、最後にまとめて throw する（失敗を黙って捨てない）。
 */
export async function recordTick(report: Pick<TickReport, "reviews" | "missing">, now: Date): Promise<{ queued: number; statuses: WatchStatus[] }> {
  const errors: unknown[] = [];
  let queued = 0;
  const enqueue = async (item: NewReviewItem) => {
    try {
      if (await enqueueReview(item, now)) queued += 1;
    } catch (e) {
      errors.push(e);
      logger.error("運営者の箱に入れられませんでした", { id: item.id, message: e instanceof Error ? e.message : String(e) });
    }
  };

  for (const n of report.reviews) await enqueue(reviewItemOf(n));
  for (const m of report.missing) await enqueue(missingItemOf(m));

  let statuses: WatchStatus[] = [];
  try {
    const [sources, prev] = await Promise.all([
      db.collection("sources").get().then((s) => s.docs.map((d) => d.data() as Source)),
      db.collection("watchStatus").get().then((s) => s.docs.map((d) => d.data() as WatchStatus)),
    ]);
    statuses = computeWatchStatuses(sources, prev, now);
    const batch = db.batch();
    for (const s of statuses) batch.set(db.doc(`watchStatus/${s.prefCode}`), s); // 見回りのたびに 47 件書く
    await batch.commit();
    for (const s of statuses) {
      // 入口が 1 つもない県（まだ入口を入れていない、すべて無効）は、確認状況では「確認できません」だが、見回りの失敗ではないので警告しない
      if (!sources.some((x) => x.enabled && x.prefCode === s.prefCode) || !shouldAlertFailing(s, now)) continue;
      const item = watchFailingItem(s, now);
      if (item !== null) await enqueue(item);
    }
  } catch (e) {
    errors.push(e);
    logger.error("確認状況を書けませんでした", { message: e instanceof Error ? e.message : String(e) });
  }

  if (errors.length > 0) throw new AggregateError(errors, "見回りの結果の記録に失敗しました");
  return { queued, statuses };
}
