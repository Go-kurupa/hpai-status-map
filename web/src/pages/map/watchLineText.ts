// 確認状況の 1 行（設計書 §9.7、§2）。「47 都道府県のうち N 件を確認、M 件は確認できていません（県名）」。
// 見回りの結果が届いていない県、読めない時刻の県は、確認できていない側に数える（「何もない」に見せない）。
import { PREFS } from "@hpai/shared/pref";
import { summarizeWatch } from "@hpai/shared/level";
import type { IsoDateTime, PrefCode, WatchStatus } from "@hpai/shared/types";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const validMs = (s: string | null): number | null => {
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const pickBy = (values: Array<string | null>, better: (a: number, b: number) => boolean): string | null => {
  let best: string | null = null;
  for (const v of values) {
    const t = validMs(v);
    if (t !== null && (best === null || better(t, Date.parse(best)))) best = v;
  }
  return best;
};

/**
 * 47 県ぶんの行にする。届いていない県は ok:false、checkedAt null。47 県の外の行は捨てる。
 * 同じ県が複数あるときは 1 行にまとめ、ok はすべてが ok のときだけ（summarizeWatch と同じく、1 つでも欠ければ未確認）。
 */
export function completeWatchStatus(all: readonly WatchStatus[]): WatchStatus[] {
  return PREFS.map(({ code }): WatchStatus => {
    const mine = all.filter((w) => w.prefCode === code);
    if (mine.length === 0) return { prefCode: code, checkedAt: null, ok: false, lastOkAt: null, failingSince: null };
    if (mine.length === 1) return mine[0]!;
    const ok = mine.every((w) => w.ok);
    const times = mine.map((w) => w.checkedAt);
    // ok のときは、いちばん古い確認が新鮮さを決める。読めない時刻が 1 つでもあれば null（未確認になる）
    const checkedAt = ok ? (times.every((t) => validMs(t) !== null) ? pickBy(times, (a, b) => a < b) : null) : pickBy(times, (a, b) => a > b);
    return {
      prefCode: code,
      checkedAt,
      ok,
      lastOkAt: pickBy(mine.map((w) => w.lastOkAt), (a, b) => a > b),
      failingSince: pickBy(mine.map((w) => w.failingSince), (a, b) => a < b),
    };
  });
}

export interface WatchLineResult {
  text: string;
  /** checkedAt の最大（now より後の時刻は使わない。now には動かさない）。使える checkedAt がなければ null。
   * 失敗の行の「最後に試した時刻」も含むので、okCount が 0 のときは「時点」と出さず、試した時刻として出す */
  asOf: IsoDateTime | null;
  /** 確認できた県の数（6 時間以内に ok） */
  okCount: number;
  failedPrefCodes: PrefCode[];
}

export function watchLine(all: readonly WatchStatus[], now: Date): WatchLineResult {
  const rows = completeWatchStatus(all);
  const summary = summarizeWatch(rows, now);
  const names = summary.failedPrefCodes.map((c) => PREF_NAME.get(c) ?? c);
  // 47 県すべてのときは県名を並べない（どの県も確認できていない、と読める）
  const tail = names.length > 0 && names.length < PREFS.length ? `（${names.join("、")}）` : "";
  return {
    text: `${PREFS.length} 都道府県のうち ${summary.okCount} 件を確認、${summary.failedCount} 件は確認できていません${tail}`,
    // 未来の時刻（時計のずれ）は summarizeWatch が未確認にするのと同じく、asOf にも使わない
    asOf: pickBy(rows.map((r) => (validMs(r.checkedAt) !== null && Date.parse(r.checkedAt as string) <= now.getTime() ? r.checkedAt : null)), (a, b) => a > b),
    okCount: summary.okCount,
    failedPrefCodes: summary.failedPrefCodes,
  };
}
