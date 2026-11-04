// 確認状況（watchStatus/{prefCode}、47 件）の計算（I-02、設計書 §9.7）。純粋関数だけ。Firestore へ書くのは record.ts。
// 県の状態は、その県の有効な入口すべての保存済みの状態から決める。tick が回すのは 1 つの group（約 3 分の 1）だけなので、
// 今回の結果だけで決めると県が毎時ばたつき、failingSince が何度もやり直しになる。
import { toJstIso } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import type { PrefCode, Source, WatchStatus } from "@hpai/shared/types";
import { reviewAlertId } from "../review/queue";
import type { NewReviewItem } from "../review/queue";

/** 失敗がこの時間続いたら運営者に知らせる。 */
export const WATCH_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;

/** 読めて、今より後ではない時刻（ミリ秒）。それ以外は null（壊れた時刻、未来の時刻は信用しない）。 */
function validTime(s: string | null | undefined, now: Date): number | null {
  if (s === null || s === undefined) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && t <= now.getTime() ? t : null;
}

/**
 * 47 件の確認状況。
 * まだ回っていない入口（lastCheckedAt が null で failureCount が 0）は、判定から外す（入口は 3 組で 1 時間に 1 組ずつ回るので、初回は未確認が残る）。
 * 確かめた入口のうち、成功は「failureCount が 0 で、時刻が正しい」もの。それ以外（失敗が続いている、時刻が壊れている・未来）は失敗。
 * ok は、確かめた入口が 1 つ以上あり、確かめた入口がすべて成功のときだけ。
 * checkedAt は ok なら成功した入口のうちいちばん古い時刻（いちばん古い入口が新鮮さを決める）、ok でなければ最新の確認の時刻（なければ null）。
 * failingSince は、確かめて失敗した入口があるときだけ立て、最初の時刻を保つ（前の状態から）。ok や、確かめた入口がないときは null。
 */
export function computeWatchStatuses(sources: readonly Source[], prev: readonly WatchStatus[], now: Date): WatchStatus[] {
  const prevBy = new Map(prev.map((p) => [p.prefCode, p]));
  return PREFS.map(({ code }): WatchStatus => {
    const before = prevBy.get(code);
    // 前の時刻は、読めて未来でないときだけそのまま引き継ぐ（文字列は変えない）
    const keep = (v: string | null | undefined): string | null => (validTime(v, now) === null ? null : (v as string));
    const confirmed = sources.filter((s) => s.enabled && s.prefCode === code && !(s.failureCount === 0 && s.lastCheckedAt === null));
    const okTimes = confirmed.map((s) => (s.failureCount === 0 ? validTime(s.lastCheckedAt, now) : null));
    const succeeded = okTimes.filter((t): t is number => t !== null);
    const failed = confirmed.length - succeeded.length;

    if (confirmed.length === 0) {
      return { prefCode: code, ok: false, checkedAt: null, lastOkAt: keep(before?.lastOkAt), failingSince: null };
    }
    if (failed === 0) {
      const at = toJstIso(new Date(Math.min(...succeeded)));
      return { prefCode: code, ok: true, checkedAt: at, lastOkAt: at, failingSince: null };
    }
    const checked = confirmed.map((s) => validTime(s.lastCheckedAt, now)).filter((t): t is number => t !== null);
    return {
      prefCode: code,
      ok: false,
      checkedAt: checked.length > 0 ? toJstIso(new Date(Math.max(...checked))) : null,
      lastOkAt: keep(before?.lastOkAt),
      failingSince: keep(before?.failingSince) ?? toJstIso(now),
    };
  });
}

/** 失敗が 24 時間（ちょうども含む）続いているか。 */
export function shouldAlertFailing(s: WatchStatus, now: Date): boolean {
  if (s.ok) return false;
  const since = validTime(s.failingSince, now);
  return since !== null && now.getTime() - since >= WATCH_ALERT_AFTER_MS;
}

/** 運営者の箱に入れる watch_failing。id は失敗の期間ごとに変わり（同じ期間は 1 件だけ）、「/」を含まない。 */
export function watchFailingItem(s: WatchStatus, now: Date): NewReviewItem | null {
  if (s.failingSince === null) return null;
  const name = PREFS.find((p) => p.code === s.prefCode)?.name ?? s.prefCode;
  const key = `${s.prefCode}-${s.failingSince.replace(/\D/g, "").slice(0, 14)}`;
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(s.failingSince)) / 3_600_000));
  return {
    id: reviewAlertId("watch_failing", key),
    kind: "alert",
    alert: "watch_failing",
    prefCode: s.prefCode as PrefCode,
    caseId: null,
    message: `${name}の見回りが約${hours}時間、確認できていません（${s.failingSince} から）。入口の変更や到達できない原因を確かめてください。`,
  };
}
