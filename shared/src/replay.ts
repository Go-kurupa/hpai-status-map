// 再現モード（設計書 §17、X-02）。2025 年 12 月の中国・近畿の 4 事例を、時刻どおりに流すための型と純粋な関数。
// データは data/replay/scenario.json の事実（日時、県、市町村、段階、羽数、半径、出典の URL）だけで、県や国の文章を写さない。
// 時計は引数で受ける。ここでは今の時刻を読まない。
import { addDays, toJstIso } from "./dates";
import { FIXED_TEXT } from "./wording";
import type { Case, CaseStage, FarmPoint, IsoDate, Level, WatchStatus, WildBird } from "./types";

export interface ReplayEvent {
  /** 1 からの連番。日付の昇順（同じ日は時刻の順） */
  order: number;
  date: IsoDate;
  /** "HH:MM"。出典がその段階の時刻を書いているときだけ。null は「時刻の記載なし」 */
  time: string | null;
  /** この出来事の後の事例。前の出来事の段階を引き継ぐ。confirmState は "replay" */
  caseAfter: Case;
  /** 仮の地点にメールが届くときの下書き。段階 ④ の事例、またはメールに語のない出来事（防疫措置の完了）は null */
  noticePreview: { level: Level; text: string } | null;
  sourceUrl: string;
  /** 舞台裏の画面（X-07）の項目。まだなければ null */
  backstageId: string | null;
}

export interface ReplayScenario {
  id: "2025-12";
  title: string;
  /** 津山市の範囲から 5km 以内の仮の地点。説明のために置いた地点で、特定の農場を指すものではない */
  defaultSpot: FarmPoint;
  events: ReplayEvent[];
  wildBirds: WildBird[];
  /** 説明のための例。実際の見回りの結果ではない */
  watchStatus: WatchStatus[];
}

/** 再現の舞台のシーズン（2025 = 2025-06-01〜2026-05-31） */
export const REPLAY_SEASON = 2025;
export const NO_TIME_LABEL = "時刻の記載なし";

/** 出典が時刻を書いていない出来事は、その日の終わりに置く（時刻を作らない） */
const END_OF_DAY = "23:59:59";

const STAGE_PRIORITY: readonly CaseStage[] = [
  "movement_lifted",
  "shipment_lifted",
  "surveillance_lifted",
  "control_done",
  "culling_done",
  "confirmed",
  "suspected",
];

/** メールの文に使う語。語のない段階（防疫措置の完了など）はメールを送らない（M-02 の diffCaseEvents と同じ） */
const NOTICE_WORD: Partial<Record<CaseStage, string>> = {
  suspected: "疑い",
  confirmed: "確定",
  shipment_lifted: "搬出制限の解除",
  movement_lifted: "移動制限の解除",
};

/** 一覧に出す語（メールの語に、防疫措置の完了を足したもの） */
export const STAGE_LABEL: Readonly<Record<string, string>> = {
  ...NOTICE_WORD,
  control_done: "防疫措置の完了",
};

/** 出来事の時計。時刻があればその時刻（JST）、なければその日の 23:59:59（JST） */
export function virtualNow(e: Pick<ReplayEvent, "date" | "time">): Date {
  const t = e.time === null ? END_OF_DAY : `${e.time}:00`;
  const d = new Date(`${e.date}T${t}+09:00`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`再現の日時が不正です: ${e.date} ${e.time}`);
  return d;
}

export function timeLabel(e: Pick<ReplayEvent, "time">): string {
  return e.time ?? NO_TIME_LABEL;
}

function assertOrder(s: ReplayScenario, order: number): void {
  if (!Number.isInteger(order) || order < 0 || order > s.events.length) {
    throw new RangeError(`order は 0〜${s.events.length} の整数にしてください: ${order}`);
  }
}

/** order までの事例（事例ごとの最新の caseAfter）。order 0 は 0 件 */
export function casesAt(s: ReplayScenario, order: number): Case[] {
  assertOrder(s, order);
  const latest = new Map<string, Case>();
  for (const e of s.events) {
    if (e.order > order) break;
    latest.set(e.caseAfter.id, e.caseAfter);
  }
  return [...latest.values()];
}

/** order の時計。order 0 は最初の出来事の前の日の終わり（2025 シーズンの中） */
export function replayNowAt(s: ReplayScenario, order: number): Date {
  assertOrder(s, order);
  if (order > 0) return virtualNow(s.events[order - 1]!);
  const first = s.events[0];
  if (!first) throw new RangeError("再現の出来事がありません");
  return virtualNow({ date: addDays(first.date, -1), time: null });
}

/** この出来事で加わった段階（caseAfter の段階のうち、日付と時刻が出来事と同じ最も後のもの） */
export function eventStage(e: Pick<ReplayEvent, "date" | "time" | "caseAfter">): CaseStage | null {
  for (const k of STAGE_PRIORITY) {
    const st = e.caseAfter.stages[k];
    if (st && st.date === e.date && st.time === e.time) return k;
  }
  return null;
}

/** メールの下書きの文。語のない段階は null（メールを送らない） */
export function noticeTextFor(muniName: string, stage: CaseStage, authority: string = FIXED_TEXT.prefContactIsAuthority): string | null {
  const word = NOTICE_WORD[stage];
  return word ? `${muniName}で${word}の発表がありました。${authority}` : null;
}

/**
 * order の時点の見回りの状況（説明のための例）。どの県も、再生の時刻に確認したことにする（ok かどうかは変えない）。
 * 固定の時刻のままだと、時計が進んで「6 時間以内」を外れ、全県が確認できていない扱いになり、
 * 画面の『時点』も再生の時刻と食い違う。
 */
export function watchAt(s: ReplayScenario, order: number): WatchStatus[] {
  const at = toJstIso(replayNowAt(s, order));
  return s.watchStatus.map((w) => ({ ...w, checkedAt: at, lastOkAt: w.ok ? at : w.lastOkAt }));
}
