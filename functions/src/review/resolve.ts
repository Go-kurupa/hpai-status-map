// 運営者の確認の箱を解決する（I-07、設計書 §9.6、§10.2、§13）。「AI は下書き、人が確かめて確定する」の人の側。
// 運営者の claim はここで確かめる（画面の表示だけで守らない）。1 件の操作は 1 つのトランザクション（読みを先に済ませてから書く）。
// cases に書くのは upsertCaseIn / deleteReviewingCaseIn だけ（契約 2.7）。sources に書くのは「入口の承認」だけ。
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { applyRead, matchCase, nextCaseId } from "@hpai/shared/cases";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { checkCorrectedStage } from "@hpai/shared/read/correctedCheck";
import { actionsFor, parseResolveRequest, reviewDetailOf, type CorrectedCaseValues, type ResolveRequest, type ResolveResponse, type ReviewDetail } from "@hpai/shared/read/review";
import type { DocumentKind, DocumentRecord, NormalizedRead, ReviewItem } from "@hpai/shared/read/types";
import { seasonOf } from "@hpai/shared/season";
import type { Case, CaseStage, IsoDate, Source, SourceKind } from "@hpai/shared/types";
import { isAllowedUrl } from "../agent/prefDomains";
import { deleteReviewingCaseIn, upsertCaseIn } from "../read/upsert";

export interface ResolveDeps {
  db: Firestore;
  /** 市町村の索引だけを使う（県の形は読まない）。 */
  geo: GeoStore;
  now(): Date;
}

export interface Caller {
  uid: string;
  /** custom claim の operator */
  operator: boolean;
}

/** 運営者でなければ投げる。claim は request.auth.token から（クライアントの申告ではない）。 */
export function assertOperator(caller: Caller | null): asserts caller is Caller {
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.operator) throw new HttpsError("permission-denied", "運営者だけが使えます");
}

/** 新しい事例を作ってよい段階（apply.ts と同じ。後の段階だけでは事例にしない）。 */
const OPENING_STAGES: ReadonlySet<CaseStage> = new Set<CaseStage>(["suspected", "confirmed"]);
/** 提案できる入口の種類（X-14 と同じ）。 */
const PROPOSABLE: ReadonlySet<SourceKind> = new Set<SourceKind>(["pref_fixed", "pref_rss", "pref_press_list"]);

/** 段階に近い文書の種類（NormalizedRead.kind。applyRead が見るのは negated かどうかだけ。ここでは negated にしない）。 */
const KIND_OF_STAGE: Readonly<Record<CaseStage, DocumentKind>> = {
  suspected: "suspected",
  confirmed: "confirmed",
  culling_done: "progress",
  control_done: "control_done",
  shipment_lifted: "zone_lifted",
  movement_lifted: "zone_lifted",
  surveillance_lifted: "zone_lifted",
};

const sha24 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 24);

function normalizedOf(v: CorrectedCaseValues, muniName: string): NormalizedRead {
  const stamp = { date: v.date, time: v.time };
  return {
    kind: KIND_OF_STAGE[v.stage],
    prefCode: v.prefCode,
    muniCode: v.muniCode,
    muniName,
    nationalNo: v.nationalNo,
    prefNo: v.prefNo,
    birdUse: v.birdUse,
    housing: v.housing,
    headCount: v.headCount,
    primaryStage: v.stage,
    primaryStamp: stamp,
    stages: { [v.stage]: stamp },
    radiiKm: v.radiiKm,
    estimates: { shipment: null, movement: null, surveillance: null },
    negationBasis: null,
    yearCompleted: false,
    wildBirds: [],
  };
}

const firstDateOf = (c: Case): IsoDate => Object.values(c.stages).map((s) => s.date).sort()[0]!;

type DocItem = Extract<ReviewItem, { kind: "document" }>;
type AlertItem = Extract<ReviewItem, { kind: "alert" }>;
type ProposalItem = Extract<ReviewItem, { kind: "entrance_proposal" }>;

interface Ctx {
  tx: Transaction;
  deps: ResolveDeps;
  nowJst: string;
  /** 項目に足して書く記録（publish_corrected の前と後）。 */
  extra: Record<string, unknown>;
}

/** 文書の記録に、人が決めたことを理由として足す（引用を含めない符号）。 */
const withReason = (cur: unknown, reason: string): string[] => [...new Set([...(Array.isArray(cur) ? (cur as string[]) : []), reason])];

async function publishCorrected(ctx: Ctx, item: DocItem, v: CorrectedCaseValues): Promise<string> {
  const { tx, deps } = ctx;
  const entry = deps.geo.index[v.muniCode];
  if (!entry || entry.prefCode !== v.prefCode) throw new HttpsError("invalid-argument", "その県に、この市町村のコードはありません");

  // 読み: 文書、同じ県・同じシーズンの事例
  const docRef = deps.db.doc(`documents/${item.documentId}`);
  const docSnap = await tx.get(docRef);
  const caseSnap = await tx.get(deps.db.collection("cases").where("prefCode", "==", v.prefCode).where("season", "==", seasonOf(v.date)));
  const existing = caseSnap.docs.map((d) => d.data() as Case);

  // 読み手の経路と同じ検査: 未来の日付、シーズン外、既にある段階との食い違い・順序の逆転は載せない（打ち間違いで正しい日付を上書きしない）
  const docData = docSnap.exists ? (docSnap.data() as DocumentRecord) : null;
  const season = seasonOf(jstDateOf(new Date(docData?.fetchedAt ?? item.createdAt)));
  const matchInput = { prefCode: v.prefCode, muniCode: v.muniCode, date: v.date, nationalNo: v.nationalNo, stage: v.stage };
  const m = matchCase(matchInput, existing);
  if (m.kind === "ambiguous") {
    throw new HttpsError("failed-precondition", "同じ事例か判断できません。候補の事例を確かめてください", { candidateIds: m.candidateIds });
  }
  const prev = m.kind === "same" ? (existing.find((c) => c.id === m.caseId) ?? null) : null;
  if (m.kind === "same" && prev === null) throw new HttpsError("failed-precondition", "続報の事例が見つかりません。もう一度開き直してください");
  if (prev === null && !OPENING_STAGES.has(v.stage)) {
    throw new HttpsError("failed-precondition", "続きの事例がないので、疑いか確定の段階で載せてください");
  }

  const checked = checkCorrectedStage(v, { today: jstDateOf(deps.now()), season, previousStages: prev?.stages ?? null });
  if (!checked.ok) throw new HttpsError(checked.code, checked.message);

  const created = applyRead(prev, normalizedOf(v, entry.name), item.url, "operator", deps.now());
  const next: Case = prev === null ? { ...created, id: nextCaseId(v.muniCode, firstDateOf(created), existing) } : created;

  // 書き。変更の前（読み取った値、足す前の段階）と後（直した値）を項目に残す
  const { issues: _i, mismatches: _m, error: _e, kind: _k, ...readValues } = docData === null ? ({} as ReviewDetail) : reviewDetailOf(docData);
  ctx.extra.resolution = {
    before: docData === null || docData.primary === null ? null : readValues,
    after: v,
    caseBefore: prev === null ? null : { stages: prev.stages },
  };
  upsertCaseIn(tx, next);
  deleteReviewingCaseIn(tx, item.documentId);
  if (docSnap.exists) {
    tx.update(docRef, { readState: "published", caseId: next.id, reasons: withReason(docSnap.data()?.reasons, "operator:publish_corrected") });
  }
  return next.id;
}

async function markIrrelevant(ctx: Ctx, item: DocItem): Promise<null> {
  const { tx, deps } = ctx;
  const docRef = deps.db.doc(`documents/${item.documentId}`);
  const docSnap = await tx.get(docRef);
  deleteReviewingCaseIn(tx, item.documentId);
  if (docSnap.exists) tx.update(docRef, { readState: "discarded", reasons: withReason(docSnap.data()?.reasons, "operator:mark_irrelevant") });
  return null;
}

async function confirmNegation(ctx: Ctx, item: AlertItem): Promise<string> {
  const { tx, deps, nowJst } = ctx;
  if (item.caseId === null) throw new HttpsError("failed-precondition", "事例の指定がありません");
  const snap = await tx.get(deps.db.doc(`cases/${item.caseId}`));
  const c = snap.data() as Case | undefined;
  if (c === undefined) throw new HttpsError("failed-precondition", "事例が見つかりません。「退ける」で閉じてください");
  if (c.negation !== "candidate" || c.stages.confirmed !== undefined) {
    throw new HttpsError("failed-precondition", "この事例は否定の候補ではなくなっています。「退ける」で閉じてください");
  }
  // 段階と記録は消さない（§10.2）
  upsertCaseIn(tx, { ...c, negation: "negated", negatedAt: nowJst, updatedAt: nowJst });
  return c.id;
}

async function rejectNegation(ctx: Ctx, item: AlertItem): Promise<string | null> {
  const { tx, deps, nowJst } = ctx;
  if (item.caseId === null) return null;
  const snap = await tx.get(deps.db.doc(`cases/${item.caseId}`));
  const c = snap.data() as Case | undefined;
  // 候補でなくなった事例は変えない（確定の段階が加わって、すでに退けられている場合など）
  if (c !== undefined && c.negation === "candidate") upsertCaseIn(tx, { ...c, negation: "none", negatedAt: null, updatedAt: nowJst });
  return item.caseId;
}

async function approveEntrance(ctx: Ctx, item: ProposalItem): Promise<null> {
  const { tx, deps } = ctx;
  let url: URL;
  try {
    url = new URL(item.proposedUrl);
  } catch {
    throw new HttpsError("failed-precondition", "提案の URL を読めません");
  }
  if (url.protocol !== "https:") throw new HttpsError("failed-precondition", "提案の URL が https ではありません");
  // 多重の守り: 箱に入るのは提案の道具（取得前にドメインを検査する）だけだが、承認の側でも、その項目の県の公式ドメインの https だけを通す。
  if (!isAllowedUrl(item.prefCode, url)) throw new HttpsError("failed-precondition", "提案の URL がその県の公式ドメインの外です");
  if (!PROPOSABLE.has(item.sourceKind)) throw new HttpsError("failed-precondition", "提案の入口の種類が違います");

  const id = sha24(item.proposedUrl);
  const newRef = deps.db.doc(`sources/${id}`);
  const newSnap = await tx.get(newRef);
  const oldSnap = item.oldUrl !== null && item.oldUrl !== item.proposedUrl ? await tx.get(deps.db.collection("sources").where("url", "==", item.oldUrl)) : null;

  const today = jstDateOf(deps.now());
  if (newSnap.exists) {
    // 別の県の入口として登録された URL は有効にしない（その項目の県の source だけを有効にする）
    if ((newSnap.data() as Partial<Source>).prefCode !== item.prefCode) throw new HttpsError("failed-precondition", "この URL は別の県の入口として登録されています");
    // 数えた失敗の回数や指紋を消さない
    tx.update(newRef, { enabled: true, confirmedOn: today });
  } else {
    const source: Source = {
      id,
      prefCode: item.prefCode,
      url: item.proposedUrl,
      kind: item.sourceKind,
      confirmedOn: today,
      note: "運営者が承認した提案",
      group: (parseInt(id.slice(0, 8), 16) % 3) as 0 | 1 | 2,
      enabled: true,
      lastCheckedAt: null,
      lastOkAt: null,
      etag: null,
      lastModified: null,
      fingerprint: null,
      failureCount: 0,
    };
    tx.create(newRef, source);
  }
  for (const d of oldSnap?.docs ?? []) {
    if (d.id !== id && (d.data() as Partial<Source>).prefCode === item.prefCode) tx.update(d.ref, { enabled: false });
  }
  return null;
}

/** 操作を 1 件解決する。成功したら項目に resolvedAt、resolvedBy、resolvedAction を書く。 */
export async function handleResolveReviewItem(deps: ResolveDeps, caller: Caller | null, data: unknown): Promise<ResolveResponse> {
  assertOperator(caller);
  const parsed = parseResolveRequest(data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.message);
  const req: ResolveRequest = parsed.request;

  const now = deps.now();
  const nowJst = toJstIso(now);
  const caseId = await deps.db.runTransaction(async (tx): Promise<string | null> => {
    const itemRef = deps.db.doc(`reviewQueue/${req.itemId}`);
    const snap = await tx.get(itemRef);
    if (!snap.exists) throw new HttpsError("not-found", "項目が見つかりません");
    const item = snap.data() as ReviewItem;
    if ((item.resolvedAt ?? null) !== null) throw new HttpsError("failed-precondition", "この項目はすでに解決済みです");
    if (!actionsFor(item).includes(req.action)) throw new HttpsError("failed-precondition", "この項目にはその操作を使えません");

    const ctx: Ctx = { tx, deps, nowJst, extra: {} };
    let result: string | null = null;
    // actionsFor が種類と操作の組を確かめ済み。ここでは型を絞るだけ
    switch (req.action) {
      case "publish_corrected":
        result = await publishCorrected(ctx, item as DocItem, req.values);
        break;
      case "mark_irrelevant":
        result = await markIrrelevant(ctx, item as DocItem);
        break;
      case "confirm_negation":
        result = await confirmNegation(ctx, item as AlertItem);
        break;
      case "reject_negation":
        result = await rejectNegation(ctx, item as AlertItem);
        break;
      case "approve_entrance":
        result = await approveEntrance(ctx, item as ProposalItem);
        break;
      case "reject_entrance":
      case "dismiss_alert":
        break; // 項目を閉じるだけ（入口の却下は sources を変えない、§13）
    }
    tx.update(itemRef, { resolvedAt: nowJst, resolvedBy: caller.uid, resolvedAction: req.action, ...ctx.extra });
    return result;
  });
  return { ok: true, caseId };
}

/** 文書の項目の詳細（読み取った値と検査の結果）。引用を返さない（§9.4）。 */
export async function handleGetReviewDetail(deps: ResolveDeps, caller: Caller | null, data: unknown): Promise<ReviewDetail> {
  assertOperator(caller);
  const itemId = (data as { itemId?: unknown } | null)?.itemId;
  if (typeof itemId !== "string" || itemId === "" || itemId.length > 200 || itemId.includes("/")) throw new HttpsError("invalid-argument", "項目の指定が違います");

  const itemSnap = await deps.db.doc(`reviewQueue/${itemId}`).get();
  if (!itemSnap.exists) throw new HttpsError("not-found", "項目が見つかりません");
  const item = itemSnap.data() as ReviewItem;
  if (item.kind !== "document") throw new HttpsError("failed-precondition", "文書の項目ではありません");
  const docSnap = await deps.db.doc(`documents/${item.documentId}`).get();
  if (!docSnap.exists) throw new HttpsError("not-found", "文書の記録が見つかりません");
  return reviewDetailOf(docSnap.data() as DocumentRecord);
}
