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

/** 全画面に「いつ時点か」を出す（設計書 §15）。null は読めていない */
export function AsOf({ iso }: { iso: IsoDateTime | null }) {
  const format = useFormatAsOf();
  if (iso === null) return <p className="as-of">{UNKNOWN}</p>;
  const text = format(iso);
  return text === null ? null : <p className="as-of">{text}</p>;
}
