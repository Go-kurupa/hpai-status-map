import type { HistoryCase } from "@hpai/shared/types";

/** 過去の事例（data/history/cases.json を copy-web-data が web/public/history/ へ置く）。読めなければ失敗にする */
export async function fetchHistory(): Promise<HistoryCase[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}history/cases.json`);
  if (!res.ok) throw new Error(`過去の記録を読み込めませんでした（${res.status}）`);
  return (await res.json()) as HistoryCase[];
}
