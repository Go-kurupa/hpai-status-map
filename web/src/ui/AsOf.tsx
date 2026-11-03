import type { IsoDateTime } from "@hpai/shared/types";

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

/** 全画面に「いつ時点か」を出す（設計書 §15）。null は読めていない */
export function AsOf({ iso }: { iso: IsoDateTime | null }) {
  return <p className="as-of">{iso === null ? UNKNOWN : formatAsOf(iso)}</p>;
}
