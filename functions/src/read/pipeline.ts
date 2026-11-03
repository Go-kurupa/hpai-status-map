// 保存された新しい文書を読み、照合と二重読みで判断し、事例に流し込む一連の流れ（I-05、設計書 §9.4〜9.6、§15）。
// 実際の Claude は client の先にあり、試験では偽物に差し替える。確かめられないものは確認中に倒し、発生を示す文書を黙って捨てない。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import type { DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { decideReadBudget } from "@hpai/shared/budget";
import { matchCase } from "@hpai/shared/cases";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { compareReads } from "@hpai/shared/read/compare";
import { decidePublication, hasOutbreakWords } from "@hpai/shared/read/publish";
import type { CompareReport, DocumentRecord, NormalizedRead, PublishDecision, ReadResult, ReadState, SecondReadResult, VerifyReport } from "@hpai/shared/read/types";
import { verifyRead } from "@hpai/shared/read/verify";
import { seasonOf } from "@hpai/shared/season";
import type { Case, PrefCode, RuntimeSettings, Source } from "@hpai/shared/types";
import { bucket, db } from "../admin";
import type { NewReviewItem } from "../review/queue";
import { recordUsage } from "../usage/record";
import { readRuntimeSettings, readUsageMonth } from "../usage/settings";
import { planApply, type ApplyPlan } from "./apply";
import { readPrimary, readSecond, type ReadAttempt, type ReadInput } from "./claude";
import { deleteReviewingCaseIn, upsertCaseIn } from "./upsert";

export interface PipelineDeps {
  client: Anthropic;
  geo: GeoStore;
  now(): Date;
  /** 試験用の継ぎ目: 判断を終えてから結果を書くまでの間に呼ぶ（その間に別の文書が事例を作る競合を再現する）。 */
  afterJudge?: () => Promise<void>;
}

export type ReadOutcome = { status: "skipped" } | { status: "done"; readState: ReadState; caseId: string | null };

/** 事例の種類（段階を持つもの）。 */
const CASE_KINDS: ReadonlySet<string> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);

const errMessage = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : "unknown");

/** 読んだ結果。失敗の理由と使用量（拒否も課金される）は呼び手が積む。 */
interface Outcome {
  read: ReadResult | null;
  second: SecondReadResult | null;
  verify: VerifyReport | null;
  compare: CompareReport | null;
  decision: PublishDecision;
  /** 事例の計画に渡す、照合を通った値。 */
  normalized: NormalizedRead | null;
  error: string | null;
  /** 発生を示す語が題か本文にある（書く時に判断を確認中へ倒すとき、公開にするかを決める）。 */
  outbreak: boolean;
  /**
   * 時系列の検査（verifyRead の previous）に使った事例の状態の印。書く時にトランザクションで読み直した状態と違えば、redo で検査をやり直す。
   * null は検査の対象ではない（段階がない、事例の種類ではない）。
   */
  judgedKey: string | null;
  /** previous を替えて照合と判断をやり直す（純粋。トランザクションの中で呼ぶ）。 */
  redo: ((previous: Case | null) => { verify: VerifyReport; decision: PublishDecision; normalized: NormalizedRead | null }) | null;
}

/** 事例の状態の印（id と段階の日付）。なければ "none"。 */
export function caseStateKey(c: Case | null): string {
  if (c === null) return "none";
  const stages = Object.entries(c.stages)
    .map(([stage, stamp]) => `${stage}@${stamp?.date ?? ""}`)
    .sort()
    .join(",");
  return `${c.id}|${stages}`;
}

/** 文書の本文（raw/{id}.txt。PDF は文字層）と PDF。取れなければ空と null（読めなかったことは判断が確認中に倒す）。 */
async function loadBody(rec: DocumentRecord): Promise<{ text: string; pdfBase64: string | null }> {
  let text = "";
  try {
    text = (await bucket().file(`raw/${rec.id}.txt`).download())[0].toString("utf8");
  } catch (e) {
    logger.warn("本文を読めませんでした", { documentId: rec.id, message: errMessage(e) });
  }
  let pdfBase64: string | null = null;
  if (rec.contentType === "pdf") {
    try {
      pdfBase64 = (await bucket().file(rec.storagePath).download())[0].toString("base64");
    } catch (e) {
      logger.warn("PDF を読めませんでした", { documentId: rec.id, message: errMessage(e) });
    }
  }
  return { text, pdfBase64 };
}

/** 取得元が県の入口（pref_*）なら、その県。国の発表（県をまたぐ）や取得元がなければ null。 */
async function sourcePrefCodeOf(rec: DocumentRecord): Promise<PrefCode | null> {
  try {
    const snap = await db.doc(`sources/${rec.sourceId}`).get();
    const s = snap.data() as Partial<Source> | undefined;
    return s !== undefined && typeof s.kind === "string" && s.kind.startsWith("pref_") ? (s.prefCode ?? null) : null;
  } catch (e) {
    logger.warn("取得元を読めませんでした", { documentId: rec.id, message: errMessage(e) });
    return null;
  }
}

/** 使用量を積む。失敗しても文書の処理は止めない（費用の数え漏れより、文書を落とさないことを優先する）。 */
async function addUsage(model: string, attempt: ReadAttempt<unknown>, now: Date, s: RuntimeSettings): Promise<void> {
  if (attempt.usage === undefined) return;
  try {
    await recordUsage(model, attempt.usage, now, s);
  } catch (e) {
    logger.error("使用量を積めませんでした", { model, message: errMessage(e) });
  }
}

const failureCode = (a: Extract<ReadAttempt<unknown>, { ok: false }>): string => (a.reason === "refusal" ? `refusal:${a.detail}` : a.reason);

/** 同じ県、同じシーズンの事例（トランザクションの外。照合の「前の事例」を決めるためだけに使う）。 */
async function casesOf(prefCode: PrefCode, season: number): Promise<Case[]> {
  const snap = await db.collection("cases").where("prefCode", "==", prefCode).where("season", "==", season).get();
  return snap.docs.map((d) => d.data() as Case);
}

async function judge(rec: DocumentRecord, deps: PipelineDeps, now: Date, settings: RuntimeSettings, text: string, pdfBase64: string | null): Promise<Outcome> {
  const docText = `${rec.title}\n${text}`;
  const budget = decideReadBudget(await readUsageMonth(now), settings, rec.title);

  // 予算で止めた: 読まない。read:null と同じ扱いで、理由だけ予算にする
  if (budget !== "read") {
    const budgetReason = budget === "stop" ? "budget_stop" : "budget_skip_progress";
    const d = decidePublication({ read: null, verify: null, compare: null, hasTextLayer: rec.hasTextLayer, docText, autoPublishEnabled: settings.autoPublishEnabled });
    const decision = d.action === "publish" || d.action === "discard" ? d : { ...d, reasons: [budgetReason] };
    return { read: null, second: null, verify: null, compare: null, decision, normalized: null, error: null, outbreak: hasOutbreakWords(docText), judgedKey: null, redo: null };
  }

  // 両方の読み手を同時に呼ぶ。別の読み手には主の結果を渡さない（同じ入力だけ）
  const input: ReadInput = { title: rec.title, url: rec.url, text: pdfBase64 === null && text !== "" ? text : null, pdfBase64 };
  const [p, s] = await Promise.all([readPrimary(deps.client, input, settings), readSecond(deps.client, input, settings)]);
  await Promise.all([addUsage(settings.primaryModel, p, now, settings), addUsage(settings.secondModel, s, now, settings)]);

  const read = p.ok ? p.value : null;
  const second = s.ok ? s.value : null;
  const error = !p.ok ? failureCode(p) : !s.ok ? `second:${failureCode(s)}` : null;

  const compare = read !== null && second !== null ? compareReads(read, second) : null;
  let verify: VerifyReport | null = null;
  let judgedKey: string | null = null;
  let redo: Outcome["redo"] = null;
  if (read !== null) {
    const season = seasonOf(jstDateOf(new Date(rec.fetchedAt)));
    const doc = { text, hasTextLayer: rec.hasTextLayer, season };
    // announcedOn（発表日）は取得のときに取り出して保存したもの。取り出せなかった（null、古い文書）なら「本日」だけの引用は確認中に回る（安全な側）
    const opts = { sourcePrefCode: await sourcePrefCodeOf(rec), announcedOn: rec.announcedOn ?? null };
    verify = verifyRead(read, doc, deps.geo, null, opts);
    redo = (previous) => {
      const v = verifyRead(read, doc, deps.geo, previous, opts);
      const d = decidePublication({ read, verify: v, compare, hasTextLayer: rec.hasTextLayer, docText, autoPublishEnabled: settings.autoPublishEnabled });
      return { verify: v, decision: d, normalized: v.normalized };
    };
    const n = verify.normalized;
    if (verify.pass && n !== null && CASE_KINDS.has(n.kind) && n.prefCode !== null && n.muniCode !== null && n.primaryStamp !== null && n.primaryStage !== null) {
      // 同じ事例の続報なら、前の事例を渡して時系列を見直す
      const existing = await casesOf(n.prefCode, seasonOf(n.primaryStamp.date));
      const m = matchCase({ prefCode: n.prefCode, muniCode: n.muniCode, date: n.primaryStamp.date, nationalNo: n.nationalNo, stage: n.primaryStage }, existing);
      const previous = m.kind === "same" ? (existing.find((c) => c.id === m.caseId) ?? null) : null;
      judgedKey = caseStateKey(previous);
      if (previous !== null) verify = verifyRead(read, doc, deps.geo, previous, opts);
    }
  }
  const decision = decidePublication({ read, verify, compare, hasTextLayer: rec.hasTextLayer, docText, autoPublishEnabled: settings.autoPublishEnabled });
  return { read, second, verify, compare, decision, normalized: verify?.normalized ?? null, error, outbreak: hasOutbreakWords(docText), judgedKey, redo };
}

/**
 * 箱の項目を書く（読みはすべて済ませてから）。なければ作る。
 * すでにあって未解決なら、既存の項目を残して理由を足す（見回りが先に入れた項目の理由を失わない）。
 * すでにあって解決済みの文書の項目は、新しい内容を失わないよう別の id で作る。
 */
function queueItems(tx: Transaction, items: NewReviewItem[], snaps: DocumentSnapshot[], now: Date): void {
  items.forEach((item, i) => {
    const snap = snaps[i]!;
    const ref = db.doc(`reviewQueue/${item.id}`);
    if (!snap.exists) {
      tx.create(ref, { ...item, createdAt: toJstIso(now), resolvedAt: null });
      return;
    }
    const cur = snap.data() as { resolvedAt?: string | null; reasons?: string[]; prefCode?: PrefCode | null };
    if (item.kind !== "document") return; // 同じ知らせはもうある
    if ((cur.resolvedAt ?? null) === null) {
      const reasons = [...new Set([...(cur.reasons ?? []), ...item.reasons])];
      tx.update(ref, { reasons, hasOutbreakWords: item.hasOutbreakWords, prefCode: cur.prefCode ?? item.prefCode });
      return;
    }
    tx.create(db.doc(`reviewQueue/${item.id}-${now.getTime()}`), { ...item, id: `${item.id}-${now.getTime()}`, createdAt: toJstIso(now), resolvedAt: null });
  });
}

/** 結果を書く。cases、wildBirds、箱、documents を 1 つのトランザクションで書く。 */
async function finalize(rec: DocumentRecord, o: Outcome, now: Date): Promise<{ readState: ReadState; caseId: string | null }> {
  const docRef = db.doc(`documents/${rec.id}`);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(docRef);
    if (cur.data()?.readState !== "reading") return { readState: (cur.data()?.readState ?? "reading") as ReadState, caseId: (cur.data()?.caseId ?? null) as string | null }; // 別の経路で決着済み

    // 読み: 事例（同じ県、同じシーズン）→ 計画 → 箱の項目
    const n = o.normalized;
    let existing: Case[] = [];
    if (o.decision.action === "publish" && n !== null && n.prefCode !== null && n.primaryStamp !== null) {
      const snap = await tx.get(db.collection("cases").where("prefCode", "==", n.prefCode).where("season", "==", seasonOf(n.primaryStamp.date)));
      existing = snap.docs.map((d) => d.data() as Case);
    }
    // 判断のあとに同じ事例が変わっていたら、今の状態で時系列の検査と判断をやり直す（通らなければ確認中になる）
    let decision = o.decision;
    let verify = o.verify;
    let normalized = n;
    if (decision.action === "publish" && n !== null && o.judgedKey !== null && n.prefCode !== null && n.muniCode !== null && n.primaryStamp !== null) {
      const m = matchCase({ prefCode: n.prefCode, muniCode: n.muniCode, date: n.primaryStamp.date, nationalNo: n.nationalNo, stage: n.primaryStage }, existing);
      const previousNow = m.kind === "same" ? (existing.find((c) => c.id === m.caseId) ?? null) : null;
      if (caseStateKey(previousNow) !== o.judgedKey) {
        if (o.redo !== null) {
          const r = o.redo(previousNow);
          decision = r.decision;
          verify = r.verify;
          normalized = r.normalized;
        } else {
          decision = { action: o.outbreak ? "review_public" : "review_private", reasons: ["case_changed_during_read"] }; // やり直せないときは確認中
        }
      }
    }
    const plan: ApplyPlan = planApply({ doc: rec, decision, normalized, existing, now });
    const boxSnaps = await Promise.all(plan.reviews.map((item) => tx.get(db.doc(`reviewQueue/${item.id}`))));

    // 書き
    for (const c of plan.cases) upsertCaseIn(tx, c);
    if (plan.readState === "published") deleteReviewingCaseIn(tx, rec.id); // 読み直しで載せたとき、前の確認中を残さない
    for (const b of plan.wildBirds) tx.set(db.doc(`wildBirds/${b.id}`), b);
    queueItems(tx, plan.reviews, boxSnaps, now);
    tx.update(docRef, {
      kind: o.read?.kind ?? null,
      readState: plan.readState,
      primary: o.read,
      second: o.second,
      verify,
      compare: o.compare,
      caseId: plan.caseId,
      error: o.error,
      reasons: plan.reasons,
    });
    return { readState: plan.readState, caseId: plan.caseId };
  });
}

/**
 * 文書 1 件を読む。pending のときだけ動き、reading に変えてから進める（同じ文書の 2 回目の起動は何もしない）。
 * 途中で例外が出ても reading のまま取り残さず、確認中（発生の語があれば公開）に倒す。
 */
export async function readDocument(docId: string, deps: PipelineDeps): Promise<ReadOutcome> {
  const ref = db.doc(`documents/${docId}`);
  const rec = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.readState !== "pending") return null;
    tx.update(ref, { readState: "reading" });
    return snap.data() as DocumentRecord;
  });
  if (rec === null) return { status: "skipped" };

  const now = deps.now();
  let text = "";
  try {
    const settings = await readRuntimeSettings();
    const body = await loadBody(rec);
    text = body.text;
    const outcome = await judge(rec, deps, now, settings, body.text, body.pdfBase64);
    await deps.afterJudge?.();
    const done = await finalize(rec, outcome, now);
    return { status: "done", ...done };
  } catch (e) {
    logger.error("読み取りの流れが失敗したので確認中に倒します", { documentId: docId, message: errMessage(e) });
    const outbreak = hasOutbreakWords(`${rec.title}\n${text}`);
    const decision: PublishDecision = { action: outbreak ? "review_public" : "review_private", reasons: ["pipeline_error"] };
    const done = await finalize(rec, { read: null, second: null, verify: null, compare: null, decision, normalized: null, error: "pipeline_error", outbreak, judgedKey: null, redo: null }, now);
    return { status: "done", ...done };
  }
}
