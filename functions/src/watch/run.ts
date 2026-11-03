// 1 時間ごとの見回りの本体（I-01 の runTick に、結果の記録 I-02 をつなぐ）。index.ts は呼ぶだけにして、ここを試験する。
import { logger } from "firebase-functions";
import type { Handlers, WatchDeps } from "./deps";
import { recordTick } from "./record";
import { runTick, TickAbortedError, type TickIo, type TickReport } from "./tick";

/** 運営者に知らせるものがあればログに残す。 */
function logAttention(report: Pick<TickReport, "reviews" | "missing">): void {
  if (report.reviews.length === 0 && report.missing.length === 0) return;
  logger.warn("見回りで運営者の確認が要るものがありました", {
    reviews: report.reviews.map((r) => ({ url: r.url, reason: r.reason })),
    missing: report.missing.map((m) => ({ url: m.url, nationalNos: m.nationalNos })),
  });
}

/**
 * 見回りの本体。途中で例外が出ても、それまでに集めた reviews と missing は箱に入れ、確認状況も書いてから、元の例外を投げ直す
 * （途中の失敗で、取りこぼしの知らせを捨てない）。記録も失敗したら、両方を AggregateError にまとめて投げる。
 */
export async function runWatch(deps: WatchDeps, io: TickIo, handlers: Handlers): Promise<TickReport> {
  let report: TickReport;
  try {
    report = await runTick(deps, io, handlers);
  } catch (e) {
    if (!(e instanceof TickAbortedError)) throw e;
    logger.error("見回りが途中で失敗しました。それまでの結果は記録します", { message: e.message, checked: e.report.checked.length });
    logAttention(e.report);
    try {
      await recordTick(e.report, deps.now());
    } catch (recordError) {
      throw new AggregateError([e.cause, recordError], "見回りが途中で失敗し、それまでの結果の記録にも失敗しました");
    }
    throw e.cause;
  }
  logAttention(report);
  await recordTick(report, deps.now());
  return report;
}
