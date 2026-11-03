// 載せるかの判断（PublishDecision）を、事例、野鳥、運営者の箱への書き込みの計画にする純粋関数（I-05、設計書 §9.4〜9.6、§10.2）。
// Firestore も時計も使わない（now は引数）。書くのは呼び出し側（pipeline.ts のトランザクション）。
// 迷うときは載せず確認中にする。発生を示す文書を黙って捨てない。
import { createHash } from "node:crypto";
import { applyRead, makeReviewingCase, matchCase, nextCaseId } from "@hpai/shared/cases";
import { jstDateOf } from "@hpai/shared/dates";
import type { DocumentRecord, NormalizedRead, PublishDecision, ReadState } from "@hpai/shared/read/types";
import { seasonOf } from "@hpai/shared/season";
import type { Case, CaseStage, IsoDate, PrefCode, WildBird } from "@hpai/shared/types";
import { reviewAlertId, reviewDocumentId, type NewReviewItem } from "../review/queue";

/** 計画に要る文書の項目。 */
export type ApplyDoc = Pick<DocumentRecord, "id" | "url" | "title" | "prefCode" | "fetchedAt">;

export interface ApplyPlan {
  /** 書く事例（確認中の rev- を含む）。 */
  cases: Case[];
  wildBirds: WildBird[];
  /** 運営者の箱に入れる項目（文書の項目と、否定の候補の知らせ）。 */
  reviews: NewReviewItem[];
  readState: ReadState;
  /** 載せた事例の id。確認中の rev- は含めない。 */
  caseId: string | null;
  /** 決めた理由（引用を含めない）。documents に残す。 */
  reasons: string[];
}

/** 予算で読めなかった文書の理由。これがあれば readState は skipped_budget。 */
export const BUDGET_REASONS: readonly string[] = ["budget_stop", "budget_skip_progress"];

const CASE_KINDS: ReadonlySet<string> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);
/** 新しい事例を作ってよい段階。後の段階だけでは事例にしない（前シーズン末の解除など）。 */
const OPENING_STAGES: ReadonlySet<CaseStage | null> = new Set<CaseStage | null>(["suspected", "confirmed"]);

/** 野鳥の id。date|pref|muni|species の先頭 24 桁。市町村は muniCode、なければ muniName、なければ空。種がなければ空。 */
export function wildBirdIdOf(b: { date: IsoDate; prefCode: PrefCode; muniCode: string | null; muniName: string | null; species: string | null }): string {
  const key = `${b.date}|${b.prefCode}|${b.muniCode ?? b.muniName ?? ""}|${b.species ?? ""}`;
  return `wb-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 24)}`;
}

const empty = (readState: ReadState, reasons: string[]): ApplyPlan => ({ cases: [], wildBirds: [], reviews: [], readState, caseId: null, reasons });

/** 文書の確認の項目。hasOutbreakWords は「公開の確認中（rev-）を出したか」（運営者の画面の「公開中か」）。 */
function documentItem(doc: ApplyDoc, normalized: NormalizedRead | null, reasons: string[], isPublic: boolean): NewReviewItem {
  return {
    id: reviewDocumentId(doc.id),
    kind: "document",
    documentId: doc.id,
    url: doc.url,
    prefCode: doc.prefCode ?? normalized?.prefCode ?? null,
    title: doc.title,
    reasons,
    hasOutbreakWords: isPublic,
  };
}

/** 確認中にする。review_public は県が分かり、取得元の県と食い違わないときだけ公開の rev- を作る。 */
function reviewPlan(
  doc: ApplyDoc,
  normalized: NormalizedRead | null,
  action: "review_public" | "review_private",
  reasons: string[],
  now: Date,
): ApplyPlan {
  const readPref = normalized?.prefCode ?? null;
  const mismatch = doc.prefCode !== null && readPref !== null && doc.prefCode !== readPref;
  const prefCode = readPref ?? doc.prefCode;
  const all = [...reasons];
  if (mismatch) all.push("pref_mismatch");
  if (action === "review_public" && prefCode === null) all.push("pref_unknown");
  const isPublic = action === "review_public" && !mismatch && prefCode !== null;
  const unique = [...new Set(all)];
  const readState: ReadState = unique.some((r) => BUDGET_REASONS.includes(r)) ? "skipped_budget" : isPublic ? "review_public" : "review_private";
  const cases = isPublic
    ? [makeReviewingCase({ documentId: doc.id, season: seasonOf(jstDateOf(new Date(doc.fetchedAt))), prefCode: prefCode!, sourceUrl: doc.url }, now)]
    : [];
  return { cases, wildBirds: [], reviews: [documentItem(doc, normalized, unique, isPublic)], readState, caseId: null, reasons: unique };
}

const privateReview = (doc: ApplyDoc, normalized: NormalizedRead | null, reasons: string[], now: Date): ApplyPlan =>
  reviewPlan(doc, normalized, "review_private", reasons, now);

function firstDateOf(c: Case): IsoDate {
  return Object.values(c.stages)
    .map((s) => s.date)
    .sort()[0]!;
}

function wildBirdsPlan(doc: ApplyDoc, n: NormalizedRead, now: Date): ApplyPlan {
  if (n.wildBirds.length === 0) return privateReview(doc, n, ["no_wild_bird_rows"], now);
  const wildBirds = n.wildBirds.map((b): WildBird => ({
    ...b,
    id: wildBirdIdOf(b),
    season: seasonOf(b.date),
    focusZone: { from: null, to: null },
    sourceUrl: doc.url,
  }));
  return { cases: [], wildBirds, reviews: [], readState: "published", caseId: null, reasons: [] };
}

function casePlan(doc: ApplyDoc, n: NormalizedRead, existing: readonly Case[], now: Date): ApplyPlan {
  const negated = n.kind === "negated";
  if (n.prefCode === null || n.muniCode === null || n.muniName === null) return privateReview(doc, n, ["municipality_missing"], now);
  if (doc.prefCode !== null && doc.prefCode !== n.prefCode) return privateReview(doc, n, ["pref_mismatch"], now);
  if (n.primaryStamp === null) return privateReview(doc, n, ["primary_date_missing"], now);

  const m = matchCase(
    { prefCode: n.prefCode, muniCode: n.muniCode, date: n.primaryStamp.date, nationalNo: n.nationalNo, stage: n.primaryStage },
    existing,
  );

  if (m.kind === "ambiguous") {
    // 別の事例にも足さない。否定は公開しない方針なので運営者だけ、それ以外は公開の確認中
    return reviewPlan(doc, n, negated ? "review_private" : "review_public", ["ambiguous_case"], now);
  }

  if (m.kind === "same") {
    const prev = existing.find((c) => c.id === m.caseId);
    if (prev === undefined) return privateReview(doc, n, ["matched_case_missing"], now);
    if (negated && prev.stages.confirmed !== undefined) return privateReview(doc, n, ["negation_on_confirmed"], now);
    const next = applyRead(prev, n, doc.url, "auto", now);
    const reviews: NewReviewItem[] = [];
    if (negated && next.negation === "candidate") reviews.push(negationAlert(doc, next));
    return { cases: [next], wildBirds: [], reviews, readState: "published", caseId: next.id, reasons: [] };
  }

  // new
  if (negated) return privateReview(doc, n, ["no_case_for_negation"], now);
  if (!OPENING_STAGES.has(n.primaryStage)) return privateReview(doc, n, ["no_case_for_stage"], now);
  const created = applyRead(null, n, doc.url, "auto", now);
  const next: Case = { ...created, id: nextCaseId(n.muniCode, firstDateOf(created), existing) };
  return { cases: [next], wildBirds: [], reviews: [], readState: "published", caseId: next.id, reasons: [] };
}

function negationAlert(doc: ApplyDoc, c: Case): NewReviewItem {
  return {
    id: reviewAlertId("negation_candidate", `${c.id}-${doc.id}`),
    kind: "alert",
    alert: "negation_candidate",
    prefCode: c.prefCode,
    caseId: c.id,
    message: "否定の発表があるようです。公式の発表を確かめ、否定を確定するか退けてください。確定の前は事例の段階を変えていません。",
  };
}

/**
 * 載せるかの判断を書き込みの計画にする。
 * existing は同じシーズン、同じ県の事例（確認中を含んでよい）。呼び出し側がトランザクションの中で読んだものを渡す。
 */
export function planApply(input: {
  doc: ApplyDoc;
  decision: PublishDecision;
  normalized: NormalizedRead | null;
  existing: readonly Case[];
  now: Date;
}): ApplyPlan {
  const { doc, decision, normalized, existing, now } = input;
  if (decision.action === "discard") return empty("discarded", decision.reasons ?? []);
  if (decision.action !== "publish") return reviewPlan(doc, normalized, decision.action, decision.reasons, now);

  if (normalized === null) return privateReview(doc, null, ["normalized_missing"], now);
  if (normalized.kind === "wild_bird") return wildBirdsPlan(doc, normalized, now);
  if (!CASE_KINDS.has(normalized.kind)) return privateReview(doc, normalized, ["kind_not_applicable"], now);
  return casePlan(doc, normalized, existing, now);
}
