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

/** 1 つの入口で、続けて失敗しても県を「確認できた」のままにする回数。2 回続けて失敗したら確認できていないにする。 */
export const TOLERATED_FAILURES = 1;

/**
 * 1 回の見回りの長さの上限（watchTick の timeoutSeconds）。県の中の入口の 1 回目の失敗がこの幅に収まれば、同じ回の失敗として
 * 県で 1 回と数える（同じ組の入口が、県のサーバーの一瞬の不調でそろって失敗した場合）。幅を超えれば別の回の失敗で、県として 2 回続けて読めていない。
 */
export const SAME_RUN_MS = 30 * 60 * 1000;

/** 入口 1 つの判定。at は「ここまでは読めていた」時刻、since は続けて失敗している 1 回目の時刻（分からなければ null）。 */
type Verdict = { kind: "ok"; at: number } | { kind: "tolerated"; at: number; since: number | null } | { kind: "failed"; since: number | null };

function verdictOf(s: Source, now: Date): Verdict {
  const checked = validTime(s.lastCheckedAt, now);
  if (s.failureCount === 0) return checked !== null ? { kind: "ok", at: checked } : { kind: "failed", since: null };
  // 1 回目の失敗の時刻。欄が無い古い入口で 1 回目の失敗なら、最後の確認がその失敗そのもの
  const since = validTime(s.failingSince, now) ?? (s.failureCount === 1 ? checked : null);
  const lastOk = validTime(s.lastOkAt, now);
  // 1 回だけの失敗を許すのは、前に読めていて（lastOkAt）、それが 24 時間以内のときだけ。一度も読めていない入口や、
  // 見回りが長く止まった後の最初の失敗は、慎重に失敗とみなす
  if (s.failureCount <= TOLERATED_FAILURES && checked !== null && lastOk !== null && now.getTime() - lastOk <= WATCH_ALERT_AFTER_MS) {
    return { kind: "tolerated", at: lastOk, since };
  }
  return { kind: "failed", since };
}

/**
 * 47 件の確認状況。
 * まだ回っていない入口（lastCheckedAt が null で failureCount が 0）は、判定から外す（入口は 3 組で 1 時間に 1 組ずつ回るので、初回は未確認が残る）。
 * 確かめた入口は 3 つに分ける。成功（failureCount が 0 で、時刻が正しい）、1 回だけの失敗（verdictOf の条件つき）、失敗（それ以外。
 * 2 回以上続けて失敗、一度も読めていない、時刻が壊れている・未来）。
 * ok は、確かめた入口が 1 つ以上あり、失敗が無く、1 回だけの失敗がすべて同じ回（1 回目の失敗の時刻が SAME_RUN_MS の幅に収まる）のとき。
 * 県の中で 2 つの入口が別々の回にそれぞれ 1 回失敗したら、県として 2 回続けて読めていないので ok にしない。1 回だけの失敗では公開の表示を変えない。
 * checkedAt は ok なら「ここまでは読めていた」時刻のいちばん古いもの（1 回だけ失敗した入口は前に読めた時刻）、ok でなければ最新の確認の時刻（なければ null）。
 * failingSince は ok でないときだけ立てる。前の状態の時刻を保ち、無ければ入口の 1 回目の失敗の時刻（いちばん古いもの）、それも無ければ今。
 */
export function computeWatchStatuses(sources: readonly Source[], prev: readonly WatchStatus[], now: Date): WatchStatus[] {
  const prevBy = new Map(prev.map((p) => [p.prefCode, p]));
  return PREFS.map(({ code }): WatchStatus => {
    const before = prevBy.get(code);
    // 前の時刻は、読めて未来でないときだけそのまま引き継ぐ（文字列は変えない）
    const keep = (v: string | null | undefined): string | null => (validTime(v, now) === null ? null : (v as string));
    const confirmed = sources.filter((s) => s.enabled && s.prefCode === code && !(s.failureCount === 0 && s.lastCheckedAt === null));
    const verdicts = confirmed.map((s) => verdictOf(s, now));
    const failed = verdicts.filter((v) => v.kind === "failed").length;
    const toleratedSince = verdicts.flatMap((v) => (v.kind === "tolerated" ? [v.since ?? Infinity] : []));
    // 1 回だけの失敗が 2 つ以上なら、同じ回のものかを 1 回目の失敗の時刻で見る（時刻が分からない入口は別の回とみなす）
    const sameRun =
      toleratedSince.length <= TOLERATED_FAILURES ||
      (toleratedSince.every(Number.isFinite) && Math.max(...toleratedSince) - Math.min(...toleratedSince) <= SAME_RUN_MS);

    if (confirmed.length === 0) {
      return { prefCode: code, ok: false, checkedAt: null, lastOkAt: keep(before?.lastOkAt), failingSince: null };
    }
    if (failed === 0 && sameRun) {
      const at = toJstIso(new Date(Math.min(...verdicts.map((v) => (v.kind === "failed" ? Infinity : v.at)))));
      return { prefCode: code, ok: true, checkedAt: at, lastOkAt: at, failingSince: null };
    }
    const checked = confirmed.map((s) => validTime(s.lastCheckedAt, now)).filter((t): t is number => t !== null);
    const sinces = verdicts.map((v) => (v.kind === "ok" ? null : v.since)).filter((t): t is number => t !== null);
    return {
      prefCode: code,
      ok: false,
      checkedAt: checked.length > 0 ? toJstIso(new Date(Math.max(...checked))) : null,
      lastOkAt: keep(before?.lastOkAt),
      failingSince: keep(before?.failingSince) ?? (sinces.length > 0 ? toJstIso(new Date(Math.min(...sinces))) : toJstIso(now)),
    };
  });
}

/** 失敗が 24 時間（ちょうども含む）続いているか。 */
export function shouldAlertFailing(s: WatchStatus, now: Date): boolean {
  if (s.ok) return false;
  const since = validTime(s.failingSince, now);
  return since !== null && now.getTime() - since >= WATCH_ALERT_AFTER_MS;
}

/**
 * 見回りが直ったか（その県の watch_failing を自動で閉じてよいか）。ok で、確認の時刻が読めて 24 時間以内のときだけ。
 * 確認が古い ok は、見回り全体が止まっている可能性があるので閉じない（突き合わせの isWatchStale と同じ 24 時間）。
 */
export function isRecovered(s: WatchStatus, now: Date): boolean {
  if (!s.ok) return false;
  const t = validTime(s.checkedAt, now);
  return t !== null && now.getTime() - t <= WATCH_ALERT_AFTER_MS;
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
