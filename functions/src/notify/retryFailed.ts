// 送れなかった知らせの送り直し（M-13、毎時 30 分。6 時台は朝のまとめと重ねないよう外す）。
// failed の morning と immediate、10 分以上前の queued の immediate を、会員ごとに 1 通で送る。queued の morning は朝まで送らない（今日の全国まとめだけは下の追いつきで送る）。
// 認証、上限などで止まったら残りに送らず failed のまま（次の 1 時間まで送らない）。mail_failing は朝の経路と同じ id で 1 日 1 件。
// 今日の全国まとめは、記録を作れなかった会員の分を作り、queued の分を印によらず届ける（catchUpDailyOverview）。失敗しても、ほかの送り直しは止めない。
import type { GeoStore } from "@hpai/shared/geo";
import { codeOf, type NotifyDeps } from "./dispatch";
import { asRec, deliverQueued, readQueue } from "./digest";
import type { QueueRec } from "./rebuild";
import { retryCapAlerts } from "./hitSlots";
import { catchUpDailyOverview } from "./overview";

export async function runRetryFailed(deps: NotifyDeps, geo: GeoStore): Promise<void> {
  await retryCapAlerts(deps.db, deps.now()); // 上限で止めた基準の知らせの、箱への登録の残り
  let caughtUp: QueueRec[] = [];
  try {
    caughtUp = (await catchUpDailyOverview(deps)).flatMap((d) => asRec(d.ref, d.id, d.data()) ?? []);
  } catch (e) {
    console.error("[notify] 全国まとめの追いつきに失敗しました（次の回にもう一度試します）", { code: codeOf(e) });
  }
  const queue = await readQueue(deps.db, deps.now(), false);
  const seen = new Set(queue.map((r) => r.id));
  const recs = [...queue, ...caughtUp.filter((r) => !seen.has(r.id))];
  if (recs.length === 0) return;
  await deliverQueued(deps, geo, recs, { failRestOnStop: false });
}
