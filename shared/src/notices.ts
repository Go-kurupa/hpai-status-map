// メールの知らせ（契約 3.2、2.3、設計書 §6）。誰にいつ知らせるかを決め、文面を作る。純粋な計算だけ（送信は functions/src/notify/）。
//
// 段階は relationWithoutBand だけで得る（判定を複製しない。距離の帯は事例ごとに送らない）。距離を使うので、呼ぶ前に
// await geo.ensurePrefs(...) を済ませること（未読み込みの県は GeoNotLoadedError。黙って④にしない）。
// 確認中（reviewing）は距離を見ない。
import { diffDays } from "./dates";
import { formatJaDate } from "./jaDate";
import { relationWithoutBand, wildBirdsNotifiable } from "./level";
import { MORTALITY_TEXT } from "./mortality";
import { overviewLines, type NearFacts, type OverviewDay } from "./overview";
import { PREFS } from "./pref";
import { seasonOf } from "./season";
import { GeoNotLoadedError, type GeoStore } from "./geo";
import type { Case, CaseStage, Farm, FarmPoint, IsoDate, IsoDateTime, Level, LevelReasonKind, NotifySettings, PrefCode, WildBird } from "./types";
import { FIXED_TEXT } from "./wording";

export type NoticeEvent =
  | "suspected" | "confirmed" | "reviewing" | "negated" | "shipment_lifted" | "movement_lifted"
  | "wild_bird_confirmed" | "self_check_due" | "mortality_hit" | "daily_overview";
export type NoticeTiming = "immediate" | "morning";

/** sentNotices/{noticeDocId(...)}。重複防止は会員単位。 */
export interface SentNotice {
  farmId: string;
  uid: string;
  subjectId: string; // caseId、wildBirdId、"YYYY-MM"、deathRecordId、全国まとめは "YYYY-MM-DD"
  event: NoticeEvent;
  timing: NoticeTiming;
  /**
   * abandoned: 送り直しを諦めた（14 日より古い、または 5 回失敗）。読まず、同じ知らせを作り直さない印として残す。
   * capped: 基準の知らせが 1 農場 1 日の上限で止められた（送らない。運営者の箱に出す）。すぐ送る経路でも送り直しの経路でも、送る直前に枠を確保できなければこうなる。
   */
  state: "queued" | "sent" | "failed" | "abandoned" | "capped";
  queuedAt: IsoDateTime;
  sentAt: IsoDateTime | null;
  /** 送り直しで失敗した回数（記録のせいの失敗だけ。認証、上限の停止は数えない）。なければ 0。 */
  retries?: number;
  /** capped の記録で、運営者の箱への登録がまだ済んでいない印。登録できたら消す（送り直しと朝の実行が登録し直す）。 */
  cappedAlert?: "pending";
}

/**
 * 自己点検の期限、死亡率の基準の知らせの出典。家畜伝染病予防法施行規則（e-Gov）。別表第二 三 が飼養衛生管理基準で、項目 32 が特定症状の通報。
 * guidance/official.ts の RULE と同じ URL（原本を取得して確かめ済み。docs/official-text-review.md）。
 */
export const HEALTH_STANDARD_SOURCE_URL = "https://laws.e-gov.go.jp/law/326M50010000035";

export interface Notice {
  farmId: string;
  uid: string;
  subjectId: string;
  event: NoticeEvent;
  timing: NoticeTiming;
  level: Level | null;
  relationKind: LevelReasonKind | null;
  facts: { muniName: string | null; prefCode: PrefCode | null; date: IsoDate | null; sourceUrl: string | null };
  isCorrection: boolean;
  /** 全国まとめ（daily_overview）の中身。組み立て直しのときに入れる。記録には残さない。 */
  overview?: { day: OverviewDay; near: NearFacts | null };
}

/** 事例の変化から出る出来事。 */
type CaseEvent = "suspected" | "confirmed" | "reviewing" | "negated" | "shipment_lifted" | "movement_lifted";
const CASE_EVENTS: ReadonlySet<NoticeEvent> = new Set<NoticeEvent>(["suspected", "confirmed", "reviewing", "negated", "shipment_lifted", "movement_lifted"]);
const isCaseEvent = (e: NoticeEvent): e is CaseEvent => CASE_EVENTS.has(e);

/** 設定が欠けた農場の既定（① を見逃さない側）。新規の農場の既定と同じ。 */
const DEFAULT_NOTIFY: NotifySettings = { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null };

/** 農場の位置のうち、段階の計算に使う分だけ。 */
export function farmPoint(f: Pick<Farm, "meshCode" | "muniCode" | "frequentMuniCodes">): FarmPoint {
  return { meshCode: f.meshCode, muniCode: f.muniCode, frequentMuniCodes: f.frequentMuniCodes };
}

/** sentNotices の文書 id。 */
export function noticeDocId(farmId: string, uid: string, subjectId: string, event: NoticeEvent): string {
  return [farmId, uid, subjectId, event].join("__");
}

/**
 * 事例の書き込みで出る出来事。
 * - 再現（replay）は出さない。確認中は事例ごとに最初の 1 回だけ（同じ県の確認中が開いている間の続報は、宛先を planCaseNotices が絞る）。
 * - 否定が確定したら negated だけ（その書き込みの段階の追加は出さない）。否定済みの事例の更新は出さない。
 * - 確定と疑いが同時に現れたら confirmed だけ。control_done、culling_done の追加は出さない。
 */
export function diffCaseEvents(before: Case | null, after: Case): NoticeEvent[] {
  if (after.confirmState === "replay") return [];
  if (after.confirmState === "reviewing") return before === null ? ["reviewing"] : [];
  if (after.negation === "negated") return before?.negation === "negated" ? [] : ["negated"];

  const had = (s: CaseStage): boolean => before !== null && before.stages[s] !== undefined;
  const has = (s: CaseStage): boolean => after.stages[s] !== undefined;
  const out: NoticeEvent[] = [];
  if (has("confirmed") && !had("confirmed")) out.push("confirmed");
  else if (has("suspected") && !had("suspected") && !has("confirmed")) out.push("suspected");
  if (has("shipment_lifted") && !had("shipment_lifted")) out.push("shipment_lifted");
  if (has("movement_lifted") && !had("movement_lifted")) out.push("movement_lifted");
  return out;
}

/**
 * 段階ごとの送る時刻。送らないなら null（④）。
 * 疑い、確定、否定: ① すぐ、②③ 朝。解除: ①②③ 朝。確認中: 段階によらずすぐ（同じ県への知らせ）。
 * 野鳥は朝、期限の知らせと死亡率の基準は送る側（M-13 の朝の実行、記録の書き込み）がその場で送るので immediate。
 */
export function timingFor(event: NoticeEvent, relation: Level): NoticeTiming | null {
  switch (event) {
    case "suspected":
    case "confirmed":
    case "negated":
      return relation === 1 ? "immediate" : relation === 4 ? null : "morning";
    case "shipment_lifted":
    case "movement_lifted":
      return relation === 4 ? null : "morning";
    case "reviewing":
    case "self_check_due":
    case "mortality_hit":
      return "immediate";
    case "wild_bird_confirmed":
    case "daily_overview":
      return "morning";
  }
}

const prefNameOf = (code: PrefCode | null): string => (code === null ? "" : (PREFS.find((p) => p.code === code)?.name ?? ""));

/** 出来事の段階の日付（確認中は updatedAt、否定は negatedAt）。事例の出来事でない、または日付がなければ null。 */
export function eventDateOf(event: NoticeEvent, c: Case): IsoDate | null {
  const dayOf = (iso: string | null): IsoDate | null => (iso !== null && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
  switch (event) {
    case "reviewing":
      return dayOf(c.updatedAt);
    case "negated":
      return dayOf(c.negatedAt);
    case "suspected":
    case "confirmed":
    case "shipment_lifted":
    case "movement_lifted":
      return c.stages[event]?.date ?? null;
    default:
      return null;
  }
}

/** 会員（農場と uid の組）の印。 */
export const memberKeyOf = (farmId: string, uid: string): string => `${farmId}__${uid}`;

/**
 * 確認中の知らせを黙らせる期間（日）。最初の 1 通から、これより長く開いたままの確認中は、続報を黙らせる理由にしない。
 * 開いたまま忘れられた確認中のせいで、新しい発表の最初の 1 通まで止まらないようにする（減らさない側）。
 */
export const REVIEWING_QUIET_DAYS = 14;

/**
 * 送ってから「すぐ」の知らせを送り直しの対象にするまでの待ち（分）。functions/src/notify/digest.ts の STALE_IMMEDIATE_MINUTES と同じ値
 * （その値を変えたら、ここも合わせる。試験が突き合わせる）。この間の queued は、いま送っている最中とみなす。
 */
export const REVIEWING_QUEUED_GRACE_MINUTES = 10;

/**
 * 同じ県の確認中が開いている間に、すでに確認中の知らせを受け取った会員（Q-m、利用者の決定 B）。
 * 確認中の続報（同じ県の追加の確認中の文書）は、この会員には送らない。画面の件数は事例の数なので、メールを送らなくても増える。
 * - openIds: 同じ県、同じ季の、いま開いている（cases にある）別の確認中の事例の id。
 * - 数えるのは、その事例への確認中の知らせで、sent の記録と、REVIEWING_QUEUED_GRACE_MINUTES 分以内の queued（いま送っている最中）だけ。
 *   failed と、それより古い queued は届いていない。数えると、送り直しの前にその事例が閉じたとき、続報も黙っていて 1 通も届かなくなる。
 *   abandoned と capped も数えない。
 * - 知らせてから REVIEWING_QUIET_DAYS 日より古い記録、時刻が読めない記録は数えない（送る側に倒す）。
 */
export function reviewingCoveredMembers(i: { openIds: ReadonlySet<string>; records: readonly SentNotice[]; now: Date }): Set<string> {
  const out = new Set<string>();
  if (i.openIds.size === 0) return out;
  const oldest = i.now.getTime() - REVIEWING_QUIET_DAYS * 86_400_000;
  const graceFrom = i.now.getTime() - REVIEWING_QUEUED_GRACE_MINUTES * 60_000;
  for (const r of i.records) {
    if (r.event !== "reviewing" || !i.openIds.has(r.subjectId)) continue;
    if (r.state !== "queued" && r.state !== "sent") continue;
    const t = Date.parse(r.queuedAt);
    if (!Number.isFinite(t) || t < oldest) continue;
    if (r.state === "queued" && t < graceFrom) continue;
    out.add(memberKeyOf(r.farmId, r.uid));
  }
  return out;
}

/** 解除の知らせの宛先は、解除の前の関係（区域の中にいた農場）で決める。解除の後の関係だと、半径の内にいた農場が落ちる。 */
function relationBasis(event: CaseEvent, c: Case): Case {
  if ((event === "shipment_lifted" || event === "movement_lifted") && c.stages.movement_lifted !== undefined) {
    const { movement_lifted: _lifted, ...stages } = c.stages;
    return { ...c, stages };
  }
  return c;
}

/**
 * 事例の出来事ごとの宛先。配信停止の会員は全出来事で除く。記録（alreadySent）のある知らせは出さない。
 * - 疑い、確定、否定、解除: 段階（relationWithoutBand）と農場の設定で決める。距離の帯だけの農場は④と同じで送らない。morning は morningDigest でも切る。
 * - 否定で、同じ事例の疑いか確定の送れた（sent）記録のある会員は、isCorrection:true。
 *   今は ④ でも、設定を切っていても届く（朝）。受け取っていない会員は isCorrection:false で、設定に従う。
 * - 確認中: 同じ県の農場へすぐ。設定で止めず、段階を持たない。reviewingCovered に入った会員（同じ県の確認中が開いている間に、
 *   すでに確認中の知らせを受け取った会員。reviewingCoveredMembers で求める）には出さない。渡さなければ全員に出す。
 * - 搬出制限の解除は、同じ事例の移動制限がもう解除されているなら出さない（移動制限の解除が先に伝わる）。
 * 読めない農場（会員か配信停止の欄が配列でない）は送らない側に倒す。位置が壊れた農場はその農場だけ飛ばす。
 */
export function planCaseNotices(i: {
  event: NoticeEvent;
  caseDoc: Case;
  farms: ReadonlyArray<Farm & { id: string }>;
  geo: GeoStore;
  alreadySent: readonly SentNotice[];
  reviewingCovered?: ReadonlySet<string>;
}): Notice[] {
  const { event, caseDoc, farms, geo } = i;
  if (!isCaseEvent(event)) throw new RangeError(`事例の出来事ではありません: ${event}`);
  if (event === "shipment_lifted" && caseDoc.stages.movement_lifted !== undefined) return [];

  const recorded = new Set(i.alreadySent.map((s) => noticeDocId(s.farmId, s.uid, s.subjectId, s.event)));
  // 訂正は、送れた（sent）記録にだけ当たる。queued や failed はまだ届いていない
  const delivered = new Set(i.alreadySent.filter((s) => s.state === "sent").map((s) => noticeDocId(s.farmId, s.uid, s.subjectId, s.event)));
  const facts: Notice["facts"] = {
    muniName: event === "reviewing" ? null : caseDoc.muniName,
    prefCode: caseDoc.prefCode,
    date: eventDateOf(event, caseDoc),
    sourceUrl: caseDoc.sourceUrls.at(-1) ?? null,
  };
  const basis = relationBasis(event, caseDoc);
  const out: Notice[] = [];

  for (const farm of farms) {
    if (!Array.isArray(farm.memberUids) || !Array.isArray(farm.unsubscribedUids)) continue;
    const uids = farm.memberUids.filter((u): u is string => typeof u === "string" && !farm.unsubscribedUids.includes(u));
    if (uids.length === 0) continue;

    if (event === "reviewing") {
      if (farm.prefCode !== caseDoc.prefCode) continue;
      for (const uid of uids) {
        if (recorded.has(noticeDocId(farm.id, uid, caseDoc.id, event))) continue;
        if (i.reviewingCovered?.has(memberKeyOf(farm.id, uid))) continue;
        out.push({ farmId: farm.id, uid, subjectId: caseDoc.id, event, timing: "immediate", level: null, relationKind: null, facts, isCorrection: false });
      }
      continue;
    }

    let relation: ReturnType<typeof relationWithoutBand>;
    try {
      relation = relationWithoutBand(farmPoint(farm), basis, geo);
    } catch (e) {
      if (e instanceof GeoNotLoadedError) throw e; // 県を読む前は④にせず、呼び出し側に知らせる
      console.error("[notify] 農場の位置が読めないので、この農場だけ飛ばしました", { farmId: farm.id });
      continue;
    }
    const notify = { ...DEFAULT_NOTIFY, ...(farm.notify ?? {}) };
    for (const uid of uids) {
      if (recorded.has(noticeDocId(farm.id, uid, caseDoc.id, event))) continue;
      const isCorrection =
        event === "negated" &&
        (delivered.has(noticeDocId(farm.id, uid, caseDoc.id, "suspected")) || delivered.has(noticeDocId(farm.id, uid, caseDoc.id, "confirmed")));
      const make = (timing: NoticeTiming): Notice => ({
        farmId: farm.id, uid, subjectId: caseDoc.id, event, timing,
        level: relation.level, relationKind: relation.reason?.kind ?? null, facts, isCorrection,
      });

      if (isCorrection) {
        out.push(make(timingFor(event, relation.level) ?? "morning"));
        continue;
      }
      const timing = timingFor(event, relation.level);
      if (timing === null) continue;
      if (relation.level !== 4 && notify[`level${relation.level}`] === false) continue;
      if (timing === "morning" && notify.morningDigest === false) continue;
      out.push(make(timing));
    }
  }
  return out;
}

/** 会員の uid のうち、配信を止めていないもの。欄が配列でない農場（読めない）は null（送らない側に倒す）。 */
function activeUids(farm: Pick<Farm, "memberUids" | "unsubscribedUids">): string[] | null {
  if (!Array.isArray(farm.memberUids) || !Array.isArray(farm.unsubscribedUids)) return null;
  return farm.memberUids.filter((u): u is string => typeof u === "string" && !farm.unsubscribedUids.includes(u));
}

/**
 * 野鳥の知らせ（設計書 §6）。高病原性が確定した鳥だけ。地点から市町村の範囲まで 10km 以内の農場の会員へ朝（段階は上げない）。
 * 配信停止の会員と、朝のまとめを切った農場には出さない。呼ぶ前に await geo.ensurePrefs(...) を済ませること
 * （県を読む前は GeoNotLoadedError。黙って届かないことにしない）。今季の鳥だけを渡すのは呼ぶ側。
 */
export function wildBirdNotices(i: { bird: WildBird; farms: ReadonlyArray<Farm & { id: string }>; geo: GeoStore }): Notice[] {
  const { bird, farms, geo } = i;
  if (bird.test !== "hpai_confirmed" || bird.muniCode === null) return [];
  const facts: Notice["facts"] = { muniName: bird.muniName, prefCode: bird.prefCode, date: bird.date, sourceUrl: safeUrl(bird.sourceUrl) };
  const out: Notice[] = [];
  for (const farm of farms) {
    const uids = activeUids(farm);
    if (uids === null || uids.length === 0) continue;
    if ({ ...DEFAULT_NOTIFY, ...(farm.notify ?? {}) }.morningDigest === false) continue;
    try {
      if (wildBirdsNotifiable(farmPoint(farm), [bird], geo).length === 0) continue;
    } catch (e) {
      if (e instanceof GeoNotLoadedError) throw e;
      console.error("[notify] 農場の位置が読めないので、この農場だけ飛ばしました", { farmId: farm.id });
      continue;
    }
    for (const uid of uids) {
      out.push({ farmId: farm.id, uid, subjectId: bird.id, event: "wild_bird_confirmed", timing: "morning", level: null, relationKind: null, facts, isCorrection: false });
    }
  }
  return out;
}

/**
 * 全国まとめの宛先（設計書 2 章の 5）。段階によらず全農場の会員へ朝に 1 通。配信停止の会員と、朝のまとめを切った農場には出さない。
 * 読めない農場は送らない側に倒す。距離は送る直前に計算する。date は日本時間の日付（subjectId）。
 */
export function planOverviewNotices(farms: ReadonlyArray<Farm & { id: string }>, date: IsoDate): Notice[] {
  const out: Notice[] = [];
  for (const farm of farms) {
    const uids = activeUids(farm);
    if (uids === null || uids.length === 0) continue;
    if ({ ...DEFAULT_NOTIFY, ...(farm.notify ?? {}) }.morningDigest === false) continue;
    for (const uid of uids) {
      out.push({ farmId: farm.id, uid, subjectId: date, event: "daily_overview", timing: "morning", level: null, relationKind: null, facts: { muniName: null, prefCode: null, date, sourceUrl: null }, isCorrection: false });
    }
  }
  return out;
}

/** 日付の形（YYYY-MM-DD で実在する日）。 */
function isIsoDay(v: unknown): v is IsoDate {
  if (typeof v !== "string") return false;
  try {
    diffDays(v, v);
    return true;
  } catch {
    return false;
  }
}

/** 自己点検の期限、死亡率の基準の知らせの事実。2 つの知らせ（作り手と、送り直しの作り直し）が同じ形を使う。 */
export function healthNoticeFacts(date: IsoDate | null): Notice["facts"] {
  return { muniName: null, prefCode: null, date, sourceUrl: HEALTH_STANDARD_SOURCE_URL };
}

/** 自己点検の期限の知らせ 1 件。month は subjectId（YYYY-MM）、date は期限（読めなければ null）。 */
export function selfCheckDueNotice(farmId: string, uid: string, month: string, date: IsoDate | null): Notice {
  return { farmId, uid, subjectId: month, event: "self_check_due", timing: "immediate", level: null, relationKind: null, facts: healthNoticeFacts(date), isCorrection: false };
}

/** 画面の選択肢は 1、2、3、5、7 日前。最大はその 7。 */
export const SELF_CHECK_REMIND_MAX_DAYS = 7;
/** 値が壊れているときの日数（画面の既定と同じ 3 日前）。 */
export const SELF_CHECK_REMIND_DEFAULT_DAYS = 3;
/** 1 農場に 1 回の実行で出す期限の知らせの月の数。月のキーがいくつあっても、会員 1 人あたりこの数を超えない。 */
export const SELF_CHECK_MAX_MONTHS_PER_RUN = 2;

/**
 * 期限の何日前から知らせるか。画面の選択肢（最大 7 日前）に丸める。
 * - 数でない値、有限でない値: null（出さない。壊れた設定は送らない側に倒す）
 * - 7 を超える整数: 7（画面で選べる最大。大きな値で期限のずっと前から出し続けない）
 * - 整数でない値、負の値: 3（画面の既定）
 */
export function normalizeRemindDays(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v) || v < 0) return SELF_CHECK_REMIND_DEFAULT_DAYS;
  return Math.min(v, SELF_CHECK_REMIND_MAX_DAYS);
}

/** 今季（6 月〜翌 5 月）の期限の月。10 月から翌年 5 月までの 8 か月（画面 seasonMonths と同じ）。 */
export function selfCheckMonthsOf(today: IsoDate): string[] {
  const season = seasonOf(today);
  const months: string[] = [];
  for (const m of [10, 11, 12]) months.push(`${season}-${String(m).padStart(2, "0")}`);
  for (const m of [1, 2, 3, 4, 5]) months.push(`${season + 1}-${String(m).padStart(2, "0")}`);
  return months;
}

/**
 * 知らせの対象にする月のキー。今季の 8 か月に加えて、6〜9 月のあいだは前のシーズンの 5 月分も入れる。
 * 5 月分の期限は 6 月 2〜6 日に来るが、シーズンは 6 月 1 日に替わる。今季の月だけにすると、この数日の知らせが落ちる。
 */
export function selfCheckTargetMonthsOf(today: IsoDate): string[] {
  const months = selfCheckMonthsOf(today);
  const month = Number(today.slice(5, 7));
  return month >= 6 && month <= 9 ? [`${today.slice(0, 4)}-05`, ...months] : months;
}

export interface SelfCheckPlan {
  notices: Notice[];
  /** 今季の月で、今日が知らせる期間の中にある月（記録済みの月を含む。送る側が記録済みかを調べるのに使う） */
  months: string[];
  /** 読み飛ばした欄の数（今季の月でないキー、日付でない値）。中身は出さず、件数だけを記録する */
  skipped: number;
}

/**
 * 自己点検の期限の知らせの計画。期限の「selfCheckRemindDays 日前」から期限の日まで（両端を含む）、記録済みの月を除いて出す。
 * - 対象は今季の月（10 月〜翌 5 月）のキーだけ。会員が書ける欄なので、ほかのキーはいくつあっても読み飛ばす（件数だけ数える）。
 * - selfCheckRemindDays は 0〜7 に丸める（normalizeRemindDays）。
 * - 1 回の実行で出す月は、期限の早い順に SELF_CHECK_MAX_MONTHS_PER_RUN まで。残りは翌日以降（記録は月ごとなので重ならない）。
 *   記録済み（answeredMonths）と、送り済み（sentMonths。呼ぶ側が sentNotices から渡す）の月は、上限に数えない。
 * 二度送らないのは送る側（記録の create）。selfCheckRemindDays が null、欄 selfCheckDue がない、値が日付でない月は出さない。
 * 配信停止の会員には出さない。朝のまとめの設定は見ない。壊れた欄で例外にしない。
 */
export function planSelfCheckDue(
  farm: Farm & { id: string },
  today: IsoDate,
  answeredMonths: readonly string[],
  sentMonths: readonly string[] = [],
): SelfCheckPlan {
  const none: SelfCheckPlan = { notices: [], months: [], skipped: 0 };
  const days = normalizeRemindDays(farm.notify?.selfCheckRemindDays);
  if (days === null) return none;
  const due = farm.selfCheckDue;
  if (typeof due !== "object" || due === null || Array.isArray(due)) return none;
  const uids = activeUids(farm);
  if (uids === null || uids.length === 0) return none;

  const valid = selfCheckTargetMonthsOf(today);
  const keys = Object.keys(due);
  let skipped = keys.filter((k) => !valid.includes(k)).length;
  const inWindow: Array<{ month: string; date: IsoDate }> = [];
  for (const month of valid) {
    if (!Object.hasOwn(due, month)) continue;
    const date: unknown = (due as Record<string, unknown>)[month];
    if (!isIsoDay(date)) {
      skipped += 1;
      continue;
    }
    const left = diffDays(date, today);
    if (left >= 0 && left <= days) inWindow.push({ month, date });
  }
  inWindow.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.month < b.month ? -1 : 1));

  const months = inWindow.map((x) => x.month);
  const send = inWindow.filter((x) => !answeredMonths.includes(x.month) && !sentMonths.includes(x.month)).slice(0, SELF_CHECK_MAX_MONTHS_PER_RUN);
  const notices = send.flatMap((x) => uids.map((uid) => selfCheckDueNotice(farm.id, uid, x.month, x.date)));
  return { notices, months, skipped };
}

/** planSelfCheckDue の知らせだけ。 */
export function selfCheckDueNotices(farm: Farm & { id: string }, today: IsoDate, answeredMonths: readonly string[]): Notice[] {
  return planSelfCheckDue(farm, today, answeredMonths).notices;
}

/**
 * 死亡率の基準に当たったときの知らせ。同じ農場の会員全員へすぐ。notify の設定は見ず、配信停止の会員だけ除く。
 * 当たったかの判定は呼ぶ側（computeMortality）。recordId は deaths の文書 id、date は記録の日。
 */
export function mortalityNotices(farm: Farm & { id: string }, recordId: string, date: IsoDate): Notice[] {
  const uids = activeUids(farm);
  if (uids === null) return [];
  return uids.map((uid) => ({
    farmId: farm.id, uid, subjectId: recordId, event: "mortality_hit" as const, timing: "immediate" as const, level: null, relationKind: null,
    facts: healthNoticeFacts(date), isCorrection: false,
  }));
}

// ── 文面 ──

export interface RenderCtx {
  unsubscribeUrl: string;
  appUrl: string;
}

const trimSlash = (u: string): string => u.replace(/\/+$/, "");

/** http(s) の URL だけ。 */
const safeUrl = (u: string | null): string | null => (u !== null && /^https?:\/\/\S+$/u.test(u) ? u : null);

/** 「岡山県津山市」。確認中は県だけ。 */
function placeOf(n: Notice): string {
  const pref = prefNameOf(n.facts.prefCode);
  return n.event === "reviewing" ? pref : `${pref}${n.facts.muniName ?? ""}`;
}

/** 「12月20日、」。日付がなければ空。 */
const dateLead = (n: Notice): string => (n.facts.date === null ? "" : `${formatJaDate(n.facts.date)}、`);

/** 出典の行の見出し。野鳥は環境省などの発表、期限と死亡率は法令、ほかは県の発表。 */
function sourceLabel(event: NoticeEvent): string {
  if (event === "wild_bird_confirmed") return "発表";
  if (event === "self_check_due" || event === "mortality_hit") return "出典";
  return "県の発表";
}

function unsupported(event: NoticeEvent): never {
  throw new RangeError(`この出来事の文面はありません: ${event}`);
}

export function subjectOf(n: Notice): string {
  const place = placeOf(n);
  switch (n.event) {
    case "suspected":
      return `【疑い】${place}で鳥インフルエンザの疑い`;
    case "confirmed":
      return `【確定】${place}で鳥インフルエンザの発生`;
    case "negated":
      return `${n.isCorrection ? "【訂正】" : "【お知らせ】"}${place}の疑いは否定されました`;
    case "reviewing":
      return `【確認中】${place}の発表を確認しています`;
    case "shipment_lifted":
      return `【解除】${n.facts.muniName ?? place}の搬出制限が解除されました`;
    case "movement_lifted":
      return `【解除】${n.facts.muniName ?? place}の移動制限が解除されました`;
    case "wild_bird_confirmed":
      return `【野鳥】${n.facts.muniName ?? place}で野鳥の高病原性鳥インフルエンザが確定しました`;
    case "self_check_due":
      return n.facts.date === null ? "【自己点検】期限が近づいています" : `【自己点検】${formatJaDate(n.facts.date)}が期限です`;
    case "mortality_hit":
      return n.facts.date === null ? "【死亡数】死亡率が基準に当たる可能性があります" : `【死亡数】${formatJaDate(n.facts.date)}の死亡率が基準に当たる可能性があります`;
    case "daily_overview":
      return `【全国の状況】${formatJaDate(n.subjectId)}`;
    default:
      return unsupported(n.event);
  }
}

/** 発生の事実の 1〜2 文。 */
function factsLine(n: Notice): string {
  const place = placeOf(n);
  const when = dateLead(n);
  switch (n.event) {
    case "suspected":
      return `${when}${place}で、鳥インフルエンザの疑いが発表されました。疑いの段階で、確定ではありません。`;
    case "confirmed":
      return `${when}${place}で、鳥インフルエンザの発生が発表されました。`;
    case "negated":
      return `${n.isCorrection ? "先にお送りしたお知らせの訂正です。" : ""}${when}${place}の疑いは、否定されたことを確認しました。`;
    case "reviewing":
      return `${when}${place}で、鳥インフルエンザに関わる発表がありました。内容を確認しています。どの市町村かは、まだお伝えできません。`;
    case "shipment_lifted":
      return `${when}${place}の搬出制限の解除が発表されました。`;
    case "movement_lifted":
      return `${when}${place}の移動制限の解除が発表されました。`;
    case "wild_bird_confirmed":
      return `${when}${place}で、野鳥の高病原性鳥インフルエンザの確定が発表されました。登録した地点から約 10km 以内の町です。野鳥の確定では、地図の警告の段階は上がりません。`;
    case "self_check_due": {
      const month = /^\d{4}-(\d{2})$/.exec(n.subjectId);
      const label = month ? `${Number(month[1])}月分の` : "";
      return n.facts.date === null ? `${label}自己点検の期限が近づいています。` : `${label}自己点検の期限は、${formatJaDate(n.facts.date)}です。`;
    }
    case "mortality_hit":
      return `${when}登録した鶏舎の死亡数が、告示の基準（1 日の死亡率が、対象期間の平均の 2 倍以上）に当たる可能性があります。${MORTALITY_TEXT.hit}。`;
    default:
      return unsupported(n.event);
  }
}

/** 段階の文。出さない場合は null。 */
function levelSentence(n: Notice): string | null {
  if (n.event === "shipment_lifted") {
    return n.level === 1 ? "搬出制限は解除されました。区域に入っている可能性の表示は、移動制限の解除まで続きます。" : null;
  }
  if (n.event !== "suspected" && n.event !== "confirmed") return null;
  const isSuspected = n.event === "suspected";
  if (n.level === 1) return "区域に入っている可能性があります。県の連絡を確かめてください。";
  if (n.level === 2) {
    if (n.relationKind === "same_muni") return `${FIXED_TEXT.sameMuniLifted}。`; // 移動制限の解除の後の同じ町。「隣町」と書かない
    return isSuspected ? "隣町で疑いの発表がありました。" : "隣町で発生しました。";
  }
  if (n.level === 3) return isSuspected ? "登録した町で疑いの発表がありました。" : "登録した町で発生しました。";
  return null;
}

/** 固定の文（出来事ごと）。URL は行の終わりに置く。 */
function fixedSentence(n: Notice, ctx: RenderCtx): string {
  const app = trimSlash(ctx.appUrl);
  switch (n.event) {
    case "wild_bird_confirmed":
      return "環境省の重点区域と、防疫指針の区域は別のものです。区域に入っているかは、県の連絡で確かめてください。";
    case "self_check_due":
      return `自己点検の報告は、県の様式に沿って、ご自身で出します。記録の画面で報告の文を作れます: ${app}/record/self-check`;
    case "mortality_hit":
      return [
        "この知らせは、入力された数字から自動で計算したもので、診断ではありません。迷うときは、家保へ確かめてください。",
        MORTALITY_TEXT.symptoms + "。",
        `入力を直しても、このメールは取り消せません。入力に誤りがあるときは、記録の画面で確かめてください: ${app}/record/deaths`,
      ].join("\n");
    case "suspected":
    case "confirmed":
      return "公表されるのは市町村までです。区域に入っているかは、県の連絡で確かめてください。";
    case "negated":
      return "否定された事例は、地図の警告の計算から外れます。";
    case "reviewing":
      return "分かり次第、地図に反映します。";
    case "shipment_lifted":
    case "movement_lifted":
      return "地図の表示は、県の発表にあわせて更新します。";
    default:
      return unsupported(n.event);
  }
}

/** 朝のまとめの 1 件分: 見出し、事実、段階の文、出典。 */
function itemLines(n: Notice, ctx: RenderCtx): string[] {
  const lines = [factsLine(n)];
  const level = levelSentence(n);
  if (level !== null) lines.push(level);
  if (n.event === "self_check_due" || n.event === "mortality_hit") lines.push(fixedSentence(n, ctx)); // 次にすることが本文にないと伝わらない
  const src = safeUrl(n.facts.sourceUrl);
  if (src !== null) lines.push(`${sourceLabel(n.event)}: ${src}`);
  return lines;
}

function footer(ctx: RenderCtx): string[] {
  return [`${FIXED_TEXT.prefContactIsAuthority}。`, `くわしく: ${trimSlash(ctx.appUrl)}`, `配信停止: ${ctx.unsubscribeUrl}`];
}

/**
 * 1 件のメール。本文の順: 事実／段階の文／固定の文／出典／県の連絡が正です／くわしく／配信停止。
 */
export function renderNotice(n: Notice, ctx: RenderCtx): { subject: string; text: string } {
  const subject = subjectOf(n);
  const level = levelSentence(n);
  const src = safeUrl(n.facts.sourceUrl);
  const lines = [factsLine(n)];
  if (level !== null) lines.push(level);
  lines.push(fixedSentence(n, ctx));
  if (src !== null) lines.push("", `${sourceLabel(n.event)}: ${src}`);
  lines.push("", ...footer(ctx));
  return { subject, text: lines.join("\n") };
}

const DIGEST_ORDER: Partial<Record<NoticeEvent, number>> = { reviewing: 0, suspected: 0, confirmed: 1, negated: 2, shipment_lifted: 3, movement_lifted: 4, wild_bird_confirmed: 5, self_check_due: 6, mortality_hit: 0 };

/**
 * 朝のまとめ 1 通。全件の事実を並べ、配信停止は 1 回。同じ事例は 疑い、確定、否定 の順（事例は最初に現れた順）。
 * 空は例外（何もない日は送らない）。引数の配列は並べ替えない。
 */
export function renderMorningDigest(list: readonly Notice[], ctx: RenderCtx): { subject: string; text: string } {
  if (list.length === 0) throw new RangeError("朝のまとめが空です。何もない日は送りません");
  const lines = [`${list.length} 件のお知らせをまとめてお送りします。`, "", ...digestItemLines(list, ctx)];
  lines.push(...footer(ctx));
  return { subject: `【朝のまとめ】${list.length} 件`, text: lines.join("\n") };
}

/** 各知らせの節。同じ事例は 疑い、確定、否定 の順（事例は最初に現れた順）。引数の配列は並べ替えない。 */
function digestItemLines(list: readonly Notice[], ctx: RenderCtx): string[] {
  const firstSeen = new Map<string, number>();
  list.forEach((n, i) => {
    if (!firstSeen.has(n.subjectId)) firstSeen.set(n.subjectId, i);
  });
  const ordered = [...list].sort(
    (a, b) => firstSeen.get(a.subjectId)! - firstSeen.get(b.subjectId)! || (DIGEST_ORDER[a.event] ?? 9) - (DIGEST_ORDER[b.event] ?? 9),
  );
  return ordered.flatMap((n) => [`■ ${subjectOf(n)}`, ...itemLines(n, ctx), ""]);
}

/**
 * 会員への 1 通。全国まとめがあれば先頭に置き、ほかの知らせを続ける（送り直しで 2 日分が重なったら、数字は新しい日だけで、古い日の訂正を合わせて出す）。
 * なければ今までと同じ（1 件ならその知らせ、2 件以上なら朝のまとめ）。
 */
export function renderMemberMail(list: readonly Notice[], ctx: RenderCtx): { subject: string; text: string } {
  const overviews = list.filter((n) => n.event === "daily_overview" && n.overview !== undefined);
  const rest = list.filter((n) => n.event !== "daily_overview");
  const latest = overviews.reduce<Notice | null>((best, n) => (best === null || n.subjectId > best.subjectId ? n : best), null);
  if (latest === null) return list.length === 1 ? renderNotice(list[0]!, ctx) : renderMorningDigest(list, ctx);
  const earlier = overviews.filter((n) => n !== latest).map((n) => n.overview!.day);
  const lines = [...overviewLines(latest.overview!.day, latest.overview!.near, ctx.appUrl, earlier), ""];
  if (rest.length > 0) lines.push(`ほかに ${rest.length} 件のお知らせがあります。`, "", ...digestItemLines(rest, ctx));
  lines.push(...footer(ctx));
  return { subject: rest.length === 0 ? subjectOf(latest) : `【朝のまとめ】全国の状況とお知らせ ${rest.length} 件`, text: lines.join("\n") };
}
