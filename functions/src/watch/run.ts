// 1 時間ごとの見回りの本体（I-01 の runTick に、結果の記録 I-02 をつなぐ）。index.ts は呼ぶだけにして、ここを試験する。
import { logger } from "firebase-functions";
import type { Handlers, WatchDeps } from "./deps";
import { recordTick } from "./record";
import { runTick, type TickIo, type TickReport } from "./tick";

export async function runWatch(deps: WatchDeps, io: TickIo, handlers: Handlers): Promise<TickReport> {
  const report = await runTick(deps, io, handlers);
  if (report.reviews.length > 0 || report.missing.length > 0) {
    logger.warn("見回りで運営者の確認が要るものがありました", {
      reviews: report.reviews.map((r) => ({ url: r.url, reason: r.reason })),
      missing: report.missing.map((m) => ({ url: m.url, nationalNos: m.nationalNos })),
    });
  }
  await recordTick(report, deps.now());
  return report;
}
