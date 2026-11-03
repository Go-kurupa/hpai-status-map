// メールの知らせ（契約 3.2、2.3、設計書 §6）。誰にいつ知らせるかを決め、文面を作る。純粋な計算だけ（送信は functions/src/notify/）。
//
// 段階は relationToCase だけで得る（判定を複製しない）。距離を使うので、呼ぶ前に
// await geo.ensurePrefs(...) を済ませること（未読み込みの県は GeoNotLoadedError。黙って④にしない）。
// 確認中（reviewing）は距離を見ない。
import { formatJaDate } from "./jaDate";
import { relationToCase } from "./level";
import { PREFS } from "./pref";
import { GeoNotLoadedError, type GeoStore } from "./geo";
import type { Case, CaseStage, Farm, FarmPoint, IsoDate, IsoDateTime, Level, LevelReasonKind, NotifySettings, PrefCode } from "./types";
import { FIXED_TEXT } from "./wording";

export type NoticeEvent =
  | "suspected" | "confirmed" | "reviewing" | "negated" | "shipment_lifted" | "movement_lifted"
  | "wild_bird_confirmed" | "self_check_due" | "mortality_hit";
export type NoticeTiming = "immediate" | "morning";

/** sentNotices/{noticeDocId(...)}。重複防止は会員単位。 */
export interface SentNotice {
  farmId: string;
  uid: string;
  subjectId: string; // caseId、wildBirdId、"YYYY-MM"、deathRecordId
  event: NoticeEvent;
  timing: NoticeTiming;
  state: "queued" | "sent" | "failed";
  queuedAt: IsoDateTime;
  sentAt: IsoDateTime | null;
}

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
 * - 再現（replay）は出さない。確認中は最初の 1 回だけ。
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
 * - 疑い、確定、否定、解除: 段階（relationToCase）と農場の設定で決める。morning は morningDigest でも切る。
 * - 否定で、同じ事例の疑いか確定の送れた（sent）記録のある会員は、isCorrection:true。
 *   今は ④ でも、設定を切っていても届く（朝）。受け取っていない会員は isCorrection:false で、設定に従う。
 * - 確認中: 同じ県の農場へすぐ。設定で止めず、段階を持たない。
 * - 搬出制限の解除は、同じ事例の移動制限がもう解除されているなら出さない（移動制限の解除が先に伝わる）。
 * 読めない農場（会員か配信停止の欄が配列でない）は送らない側に倒す。位置が壊れた農場はその農場だけ飛ばす。
 */
export function planCaseNotices(i: {
  event: NoticeEvent;
  caseDoc: Case;
  farms: ReadonlyArray<Farm & { id: string }>;
  geo: GeoStore;
  alreadySent: readonly SentNotice[];
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
        out.push({ farmId: farm.id, uid, subjectId: caseDoc.id, event, timing: "immediate", level: null, relationKind: null, facts, isCorrection: false });
      }
      continue;
    }

    let relation: ReturnType<typeof relationToCase>;
    try {
      relation = relationToCase(farmPoint(farm), basis, geo);
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

function unsupported(event: NoticeEvent): never {
  throw new RangeError(`この出来事の文面はまだありません（M-13 が足します）: ${event}`);
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

/** 固定の文（出来事ごと）。 */
function fixedSentence(n: Notice): string {
  switch (n.event) {
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
function itemLines(n: Notice): string[] {
  const lines = [factsLine(n)];
  const level = levelSentence(n);
  if (level !== null) lines.push(level);
  const src = safeUrl(n.facts.sourceUrl);
  if (src !== null) lines.push(`県の発表: ${src}`);
  return lines;
}

function footer(ctx: RenderCtx): string[] {
  return [`${FIXED_TEXT.prefContactIsAuthority}。`, `くわしく: ${trimSlash(ctx.appUrl)}`, `配信停止: ${ctx.unsubscribeUrl}`];
}

/**
 * 1 件のメール。本文の順: 事実／段階の文／固定の文／出典／県の連絡が正です／くわしく／配信停止。
 * 野鳥、期限、死亡率の文面は M-13 が足すまで例外。
 */
export function renderNotice(n: Notice, ctx: RenderCtx): { subject: string; text: string } {
  const subject = subjectOf(n);
  const level = levelSentence(n);
  const src = safeUrl(n.facts.sourceUrl);
  const lines = [factsLine(n)];
  if (level !== null) lines.push(level);
  lines.push(fixedSentence(n));
  if (src !== null) lines.push("", `県の発表: ${src}`);
  lines.push("", ...footer(ctx));
  return { subject, text: lines.join("\n") };
}

const DIGEST_ORDER: Partial<Record<NoticeEvent, number>> = { reviewing: 0, suspected: 0, confirmed: 1, negated: 2, shipment_lifted: 3, movement_lifted: 4 };

/**
 * 朝のまとめ 1 通。全件の事実を並べ、配信停止は 1 回。同じ事例は 疑い、確定、否定 の順（事例は最初に現れた順）。
 * 空は例外（何もない日は送らない）。引数の配列は並べ替えない。
 */
export function renderMorningDigest(list: readonly Notice[], ctx: RenderCtx): { subject: string; text: string } {
  if (list.length === 0) throw new RangeError("朝のまとめが空です。何もない日は送りません");
  const firstSeen = new Map<string, number>();
  list.forEach((n, i) => {
    if (!firstSeen.has(n.subjectId)) firstSeen.set(n.subjectId, i);
  });
  const ordered = [...list].sort(
    (a, b) => firstSeen.get(a.subjectId)! - firstSeen.get(b.subjectId)! || (DIGEST_ORDER[a.event] ?? 9) - (DIGEST_ORDER[b.event] ?? 9),
  );
  const lines = [`${list.length} 件のお知らせをまとめてお送りします。`, ""];
  for (const n of ordered) lines.push(`■ ${subjectOf(n)}`, ...itemLines(n), "");
  lines.push(...footer(ctx));
  return { subject: `【朝のまとめ】${list.length} 件`, text: lines.join("\n") };
}
