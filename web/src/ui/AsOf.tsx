import type { IsoDateTime } from "@hpai/shared/types";
import { createContext, useContext } from "react";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const UNKNOWN = "確認できていません";

/** "2025-12-21T09:00:00+09:00" → "12 月 21 日 9:00 時点"。実行する機械の時刻帯に頼らず JST で出す */
export function formatAsOf(iso: IsoDateTime): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return UNKNOWN;
  const d = new Date(t + JST_OFFSET_MS);
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 ${d.getUTCHours()}:${mm} 時点`;
}

/** "2025-12-19T23:59:59+09:00" → "12 月 19 日 時点"（時刻は出さない） */
export function formatAsOfDate(iso: IsoDateTime): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return UNKNOWN;
  const d = new Date(t + JST_OFFSET_MS);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 時点`;
}

/**
 * 時点の出し方。既定は "time"（日付と時刻）。出典に時刻がない再現では、時刻の文字を描かない:
 * "date" は日付だけ、"none" は何も描かない（Provider の外では "time"）。
 */
export type AsOfPrecision = "time" | "date" | "none";
export const AsOfPrecisionContext = createContext<AsOfPrecision>("time");

/** 精度に合わせて時点の文字を作る。"none" は null（描かない） */
export function useFormatAsOf(): (iso: IsoDateTime) => string | null {
  const precision = useContext(AsOfPrecisionContext);
  return (iso) => (precision === "none" ? null : precision === "date" ? formatAsOfDate(iso) : formatAsOf(iso));
}

/** 主語を付けたときの、確認できた時点がない書き方（「発表の確認: 未確認」） */
export const AS_OF_UNCONFIRMED = "未確認";
/** 主語を付けたときの、まだ届いていない書き方 */
export const AS_OF_LOADING = "読み込んでいます";

/**
 * 全画面に「いつ時点か」を出す（設計書 §15）。null は読めていない。
 * subject を渡すと「発表の確認: 11 月 8 日 6:10 時点」「発表の確認: 未確認」と主語を付ける
 * （「確認できていません」が単独で出ると、何が確認できていないのか分からないため。2026-11-07 B）。
 * 渡さないときは今のまま（地図と運営者の画面が使う）。loading は subject があるときだけ見る。
 */
export function AsOf({ iso, subject, loading = false }: { iso: IsoDateTime | null; subject?: string; loading?: boolean }) {
  const format = useFormatAsOf();
  if (subject === undefined) {
    if (iso === null) return <p className="as-of">{UNKNOWN}</p>;
    const text = format(iso);
    return text === null ? null : <p className="as-of">{text}</p>;
  }
  if (loading) return <p className="as-of">{`${subject}: ${AS_OF_LOADING}`}</p>;
  if (iso === null) return <p className="as-of">{`${subject}: ${AS_OF_UNCONFIRMED}`}</p>;
  const text = format(iso);
  if (text === null) return null;
  return <p className="as-of">{`${subject}: ${text === UNKNOWN ? AS_OF_UNCONFIRMED : text}`}</p>;
}
