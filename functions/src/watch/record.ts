// 見回りの結果を運営者の箱と確認状況に残す（I-02）。tick の結果（reviews、missing）を捨てない。
import { logger } from "firebase-functions";
import { toJstIso } from "@hpai/shared/dates";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import type { ReviewItem } from "@hpai/shared/read/types";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { db } from "../admin";
import { AUTO_RESOLVED_BY } from "../read/dismiss";
import { enqueueReview, reviewAlertId, reviewDocumentId, type NewReviewItem } from "../review/queue";
import type { MissingNote, ReviewNote } from "./deps";
import { computeWatchStatuses, isRecovered, shouldAlertFailing, watchFailingItem } from "./status";
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

/** 自動で閉じたときの resolvedAction（運営者の操作の名前と混ざらない決まった値）。resolvedBy は自動で外した文書と同じ "system"。 */
export const AUTO_RECOVERED_ACTION = "auto_recovered";

/** 項目がまだ未解決なら、自動で閉じる。読んでから閉じるまでに運営者が閉じていたら書き換えない（取引の中で確かめる）。閉じたら true。 */
export async function closeIfOpen(ref: FirebaseFirestore.DocumentReference, now: Date): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists || ((cur.data() as ReviewItem).resolvedAt ?? null) !== null) return false;
    tx.update(ref, { resolvedAt: toJstIso(now), resolvedBy: AUTO_RESOLVED_BY, resolvedAction: AUTO_RECOVERED_ACTION });
    return true;
  });
}

/**
 * 見回りが直った県（isRecovered）の未解決の watch_failing を閉じる。項目は消さず、resolvedAt、resolvedBy、resolvedAction を書く。
 * 運営者が同時に閉じた項目は書き換えない（取引の中で未解決を確かめる）。閉じた数を返す。
 */
export async function closeRecoveredAlerts(statuses: readonly WatchStatus[], now: Date): Promise<number> {
  const recovered = new Set(statuses.filter((s) => isRecovered(s, now)).map((s) => s.prefCode));
  if (recovered.size === 0) return 0;
  const snap = await db.collection("reviewQueue").where("resolvedAt", "==", null).get();
  const targets = snap.docs.filter((d) => {
    const i = d.data() as ReviewItem;
    return i.kind === "alert" && i.alert === "watch_failing" && i.prefCode !== null && recovered.has(i.prefCode);
  });
  let closed = 0;
  for (const d of targets) if (await closeIfOpen(d.ref, now)) closed += 1;
  if (closed > 0) logger.info("見回りが直った県の知らせを閉じました", { closed });
  return closed;
}

/**
 * 見回りの結果を残す。順は、確認の箱（取りこぼしを最優先）→ 国の解除の欠け → 確認状況 47 件と 24 時間の警告 → 直った県の警告を閉じる。
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
    const computed = computeWatchStatuses(sources, prev, now);
    const batch = db.batch();
    for (const s of computed) batch.set(db.doc(`watchStatus/${s.prefCode}`), s); // 見回りのたびに 47 件書く
    await batch.commit();
    statuses = computed; // 書けたときだけ。書けなかった計算で知らせを閉じない（確認状況と箱が食い違う）
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

  try {
    await closeRecoveredAlerts(statuses, now);
  } catch (e) {
    errors.push(e);
    logger.error("直った県の知らせを閉じられませんでした", { message: e instanceof Error ? e.message : String(e) });
  }

  if (errors.length > 0) throw new AggregateError(errors, "見回りの結果の記録に失敗しました");
  return { queued, statuses };
}
