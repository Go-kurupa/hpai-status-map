// 再現の画面が使う、表示のための小さな関数（時計と事例の計算は shared/src/replay.ts）。
import { eventStage, STAGE_LABEL, timeLabel, type ReplayEvent, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint, IsoDate } from "@hpai/shared/types";

export { casesAt, eventStage, replayNowAt, timeLabel, virtualNow } from "@hpai/shared/replay";

/** "2025-12-19" → "12 月 19 日" */
export function formatMonthDay(date: IsoDate): string {
  const [, m, d] = date.split("-");
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 一覧の 1 行: 「12 月 19 日 津山市 疑い」 */
export function eventLabel(e: ReplayEvent): string {
  const stage = eventStage(e);
  const word = stage ? (STAGE_LABEL[stage] ?? stage) : "";
  return `${formatMonthDay(e.date)} ${e.caseAfter.muniName ?? ""} ${word}`.trim();
}

/** 帯の『時点』: order 0 は『はじまる前』、それ以外は日付と時刻（時刻がなければ『時刻の記載なし』） */
export function pointInTime(s: ReplayScenario, order: number): string {
  if (order === 0) return "はじまる前";
  const e = s.events[order - 1];
  if (!e) throw new RangeError(`order が範囲の外です: ${order}`);
  return e.time === null ? `${formatMonthDay(e.date)}（${timeLabel(e)}）` : `${formatMonthDay(e.date)} ${e.time}`;
}

/** 今の出来事の 1 行に足す距離。km は TEXT.distanceBand と同じく四捨五入で出す */
export function farmDistanceText(km: number, tentative: boolean): string {
  return `${tentative ? "農場（仮の地点）" : "この端末の地点"}から${km < 1 ? "約 1 km 未満" : `約 ${Math.round(km)} km`}`;
}

export function isDefaultSpot(s: ReplayScenario, spot: FarmPoint | null): boolean {
  return spot === null || (spot.meshCode === s.defaultSpot.meshCode && spot.muniCode === s.defaultSpot.muniCode);
}
