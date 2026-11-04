// 送れなかった知らせの送り直し（M-13、毎時 30 分。6 時台は朝のまとめと重ねないよう外す）。
// failed の morning と immediate、10 分以上前の queued の immediate を、会員ごとに 1 通で送る。queued の morning は朝まで送らない。
// 認証、上限などで止まったら残りに送らず failed のまま（次の 1 時間まで送らない）。mail_failing は朝の経路と同じ id で 1 日 1 件。
import type { GeoStore } from "@hpai/shared/geo";
import type { NotifyDeps } from "./dispatch";
import { deliverQueued, readQueue } from "./digest";
import { retryCapAlerts } from "./hitSlots";

export async function runRetryFailed(deps: NotifyDeps, geo: GeoStore): Promise<void> {
  await retryCapAlerts(deps.db, deps.now()); // 上限で止めた基準の知らせの、箱への登録の残り
  const recs = await readQueue(deps.db, deps.now(), false);
  if (recs.length === 0) return;
  await deliverQueued(deps, geo, recs, { failRestOnStop: false });
}
