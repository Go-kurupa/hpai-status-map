// 運営者の確認の箱を解決する操作の型と、純粋な部分（I-07、設計書 §9.6、§10.2、§13）。
// resolveReviewItem と getReviewDetail（functions）と運営者の画面（web）が同じものを読む。Firebase も fetch も使わない。
// 引用（Quoted.quote）はここへ出さない（§9.4）。画面に渡す詳細は値と検査の結果だけ。
import { addDays } from "../dates";
import { PREFS } from "../pref";
import type { CaseStage, IsoDate, MuniCode, PrefCode } from "../types";
import type { DocumentKind, DocumentRecord, MandatoryField, ReadDate, ReviewItem, VerifyCheck } from "./types";

/** 運営者が直して載せる値。市町村は N03 にあるコードで、県の中から選ぶ。 */
export interface CorrectedCaseValues {
  prefCode: PrefCode;
  muniCode: MuniCode;
  stage: CaseStage;
  date: IsoDate;
  time: string | null;
  nationalNo: number | null;
  prefNo: number | null;
  birdUse: string | null;
  housing: string | null;
  headCount: number | null;
  radiiKm: number[];
}

export type ResolveRequest = { itemId: string } & (
  | { action: "publish_corrected"; values: CorrectedCaseValues }
  | { action: "mark_irrelevant" | "confirm_negation" | "reject_negation" | "approve_entrance" | "reject_entrance" | "dismiss_alert" }
);

export type ResolveAction = ResolveRequest["action"];

export interface ResolveResponse {
  ok: true;
  caseId: string | null;
}

/** 文書の項目の詳細。引用を含めない（§9.4）。 */
export interface ReviewDetail {
  kind: DocumentKind | null;
  prefecture: string | null;
  municipality: string | null;
  primaryStage: CaseStage | null;
  primaryDate: ReadDate | null;
  nationalNo: number | null;
  birdUse: string | null;
  housing: string | null;
  headCount: number | null;
  radiiKm: number[];
  issues: Array<{ field: string; check: VerifyCheck; mandatory: boolean }>;
  mismatches: MandatoryField[];
  error: string | null;
}

/** 知らせの言葉（固定）。項目の message は画面に出さない。 */
export const ALERT_TEXT: Readonly<Record<Extract<ReviewItem, { kind: "alert" }>["alert"], string>> = {
  case_stalled: "疑いの続報がありません",
  negation_candidate: "否定の発表があるようです",
  national_missing: "国の一覧にあり、作品になかった事例を載せました",
  app_only_confirmed: "確定が 48 時間たっても国の一覧にありません",
  watch_failing: "24 時間以上読めていません",
  agent_run_failed: "入口を直すエージェントの実行に失敗しました",
  mail_failing: "メールを送れていません。アプリパスワードと 1 日の上限を確かめてください",
  mortality_capped: "死亡率の基準の知らせが、1 農場の 1 日の上限で止まった農場があります。偽の記録か、実際に多くの鶏舎で基準に当たっている可能性があります",
};

/** 項目の種類ごとに許す操作（1 項目 2 つまで）。サーバーの検査と画面のボタンが同じ表を使う。 */
export function actionsFor(item: ReviewItem): ResolveAction[] {
  switch (item.kind) {
    case "document":
      return ["publish_corrected", "mark_irrelevant"];
    case "entrance_proposal":
      return ["approve_entrance", "reject_entrance"];
    case "alert":
      return item.alert === "negation_candidate" ? ["confirm_negation", "reject_negation"] : ["dismiss_alert"];
  }
}

// ── 入力の検査 ──

const STAGES: ReadonlySet<string> = new Set<CaseStage>(["suspected", "confirmed", "culling_done", "control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"]);
const PLAIN_ACTIONS: ReadonlySet<string> = new Set(["mark_irrelevant", "confirm_negation", "reject_negation", "approve_entrance", "reject_entrance", "dismiss_alert"]);
const PREF_CODES: ReadonlySet<string> = new Set(PREFS.map((p) => p.code));
const MAX_TEXT = 100;
const MAX_RADII = 5;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isCount = (x: unknown, min: number, max: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;

function realDate(s: unknown): s is IsoDate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  try {
    addDays(s, 0);
    return true;
  } catch {
    return false;
  }
}

function parseValues(raw: unknown): { ok: true; values: CorrectedCaseValues } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: "直した値がありません" };
  const v = raw;
  const bad = (m: string) => ({ ok: false as const, message: m });
  if (typeof v.prefCode !== "string" || !PREF_CODES.has(v.prefCode)) return bad("都道府県が違います");
  if (typeof v.muniCode !== "string" || !/^\d{5}$/.test(v.muniCode)) return bad("市町村が違います");
  if (typeof v.stage !== "string" || !STAGES.has(v.stage)) return bad("段階が違います");
  if (!realDate(v.date)) return bad("日付が違います");
  if (v.time !== null && (typeof v.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))) return bad("時刻が違います");
  if (v.nationalNo !== null && !isCount(v.nationalNo, 1, 99_999)) return bad("国内の番号が違います");
  if (v.prefNo !== null && !isCount(v.prefNo, 1, 99_999)) return bad("県内の番号が違います");
  if (v.headCount !== null && !isCount(v.headCount, 0, 100_000_000)) return bad("羽数が違います");
  for (const k of ["birdUse", "housing"] as const) {
    const t = v[k];
    if (t !== null && (typeof t !== "string" || t.trim() === "" || t.length > MAX_TEXT)) return bad(k === "birdUse" ? "用途が違います" : "飼い方が違います");
  }
  if (!Array.isArray(v.radiiKm) || v.radiiKm.length > MAX_RADII || !v.radiiKm.every((r) => typeof r === "number" && Number.isFinite(r) && r > 0 && r <= 100)) {
    return bad("半径が違います");
  }
  return {
    ok: true,
    values: {
      prefCode: v.prefCode,
      muniCode: v.muniCode,
      stage: v.stage as CaseStage,
      date: v.date,
      time: v.time as string | null,
      nationalNo: v.nationalNo as number | null,
      prefNo: v.prefNo as number | null,
      birdUse: v.birdUse as string | null,
      housing: v.housing as string | null,
      headCount: v.headCount as number | null,
      radiiKm: [...(v.radiiKm as number[])],
    },
  };
}

/** callable の入力を ResolveRequest にする。形が違えば理由つきで ok:false（呼び出し側が invalid-argument にする）。余計な項目は読み捨てる。 */
export function parseResolveRequest(data: unknown): { ok: true; request: ResolveRequest } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: "リクエストの形が違います" };
  const { itemId, action } = data;
  if (typeof itemId !== "string" || itemId === "" || itemId.length > 200 || itemId.includes("/")) return { ok: false, message: "項目の指定が違います" };
  if (action === "publish_corrected") {
    const parsed = parseValues(data.values);
    return parsed.ok ? { ok: true, request: { itemId, action, values: parsed.values } } : parsed;
  }
  if (typeof action === "string" && PLAIN_ACTIONS.has(action)) {
    return { ok: true, request: { itemId, action } as ResolveRequest };
  }
  return { ok: false, message: "操作が違います" };
}

// ── 詳細 ──

const clip = (s: string | null | undefined): string | null => (typeof s === "string" ? s.slice(0, MAX_TEXT) : null);

/** 文書の記録から、運営者の画面に渡す詳細を作る。値だけで、引用と検査の detail は含めない。 */
export function reviewDetailOf(doc: DocumentRecord): ReviewDetail {
  const p = doc.primary;
  const d = p?.primaryDate ?? null;
  return {
    kind: p?.kind ?? doc.kind ?? null,
    prefecture: clip(p?.prefecture?.value),
    municipality: clip(p?.municipality?.value),
    primaryStage: p?.primaryStage ?? null,
    primaryDate: d === null ? null : { year: d.year ?? null, month: d.month, day: d.day, time: d.time ?? null },
    nationalNo: p?.nationalNo?.value ?? null,
    birdUse: clip(p?.birdUse?.value),
    housing: clip(p?.housing?.value),
    headCount: p?.headCount?.value ?? null,
    radiiKm: (p?.radiiKm ?? []).map((r) => r.km),
    issues: (doc.verify?.issues ?? []).map((i) => ({ field: i.field, check: i.check, mandatory: i.mandatory })),
    mismatches: [...(doc.compare?.mismatches ?? [])],
    error: clip(doc.error),
  };
}
