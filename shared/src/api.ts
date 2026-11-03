// 公開 API と公開 MCP の共通の型と、公開してよい形にする純粋関数（契約 3.9、X-12）。
// 公開するのは公開の事実だけ。会員の農場、地点、記録、メール、運営者の箱、確認中の内部の理由は、型にも関数にも出てこない。
// 事例、野鳥、確認状況は「許す項目を 1 つずつ写す」。文書をそのまま広げない（余分な項目が混ざっても外へ出ない）。
import { diffDays, jstDateOf } from "./dates";
import { PREFS } from "./pref";
import { FIXED_TEXT } from "./wording";
import type {
  AreaStatus,
  Case,
  CaseStage,
  IsoDateTime,
  PrefCode,
  StageDates,
  WatchStatus,
  WatchSummary,
  WildBird,
} from "./types";

/** 公開 API の応答の外側。asOf はいつ時点か、sources は出典の URL、notices は必ず添える文。 */
export interface ApiEnvelope<T> {
  asOf: IsoDateTime;
  notices: string[];
  sources: string[];
  /** 見回りの確認状況。事例や野鳥の答えには必ず添える（件数 0 を「発生なし」と読ませない） */
  watch?: WatchSummary;
  data: T;
}

/** 確認中（reviewing）の事例は県名と原文のリンクだけ。updatedAt も出さない（日付を公開しない）。 */
export type ApiCase = Omit<Case, "updatedAt"> & { updatedAt: IsoDateTime | null };
export type ApiCases = ApiEnvelope<ApiCase[]>;
export type ApiArea = ApiEnvelope<Omit<AreaStatus, "sameMuniCases" | "adjacentCases"> & { sameMuniCases: ApiCase[]; adjacentCases: ApiCase[] }>;
export type ApiWatch = ApiEnvelope<WatchSummary & { prefectures: WatchStatus[] }>;
export type ApiWildBirds = ApiEnvelope<WildBird[]>;

/** 過去の資料がある最初のシーズン（data/history）。これより前は 400。 */
export const API_MIN_SEASON = 2020;

/** 否定した事例を残す日数（一覧と同じ。8 日目に消える。設計書 §10.2） */
const NEGATED_KEEP_DAYS = 7;
/** 自由に近い文字列の上限。外の文書から来た語が長い文になって返らないようにする。 */
const TEXT_MAX = 100;

const STAGES: readonly CaseStage[] = [
  "suspected",
  "confirmed",
  "culling_done",
  "control_done",
  "shipment_lifted",
  "movement_lifted",
  "surveillance_lifted",
];

const clip = (s: string | null | undefined): string | null => (typeof s === "string" ? s.slice(0, TEXT_MAX) : null);
const dayOrNull = (s: string | null | undefined): string | null => (typeof s === "string" ? s : null);

function publicStages(stages: StageDates | undefined): StageDates {
  const out: StageDates = {};
  for (const k of STAGES) {
    const v = stages?.[k];
    if (v) out[k] = { date: v.date, time: v.time ?? null };
  }
  return out;
}

/**
 * 否定した事例は negatedAt から 7 日は返り、8 日目に返らない。negatedAt が読めないときは隠さない。
 * 一覧（web の listRows）と同じ規則。
 */
export function isCaseVisible(c: Case, now: Date): boolean {
  if (c.negation !== "negated" || c.negatedAt === null) return true;
  const t = Date.parse(c.negatedAt);
  if (!Number.isFinite(t)) return true;
  return diffDays(jstDateOf(now), jstDateOf(new Date(t))) <= NEGATED_KEEP_DAYS;
}

/** 公開してよい形の事例。確認中は県名、確認中、リンクだけ。 */
export function toPublicCase(c: Case): ApiCase {
  const base = { id: c.id, season: c.season, prefCode: c.prefCode, confirmState: c.confirmState, sourceUrls: [...c.sourceUrls] };
  if (c.confirmState === "reviewing") {
    return {
      ...base,
      nationalNo: null,
      prefNo: null,
      muniCode: null,
      muniName: null,
      birdUse: null,
      housing: null,
      headCount: null,
      stages: {},
      radiiKm: [],
      prefEstimates: { shipment: null, movement: null, surveillance: null },
      negation: "none",
      negatedAt: null,
      updatedAt: null,
    };
  }
  return {
    ...base,
    nationalNo: c.nationalNo ?? null,
    prefNo: c.prefNo ?? null,
    muniCode: c.muniCode ?? null,
    muniName: clip(c.muniName),
    birdUse: clip(c.birdUse),
    housing: clip(c.housing),
    headCount: typeof c.headCount === "number" ? c.headCount : null,
    stages: publicStages(c.stages),
    radiiKm: (c.radiiKm ?? []).filter((r) => Number.isFinite(r)),
    prefEstimates: {
      shipment: dayOrNull(c.prefEstimates?.shipment),
      movement: dayOrNull(c.prefEstimates?.movement),
      surveillance: dayOrNull(c.prefEstimates?.surveillance),
    },
    negation: c.negation,
    negatedAt: dayOrNull(c.negatedAt),
    updatedAt: c.updatedAt,
  };
}

export function toPublicWildBird(b: WildBird): WildBird {
  return {
    id: b.id,
    season: b.season,
    date: b.date,
    prefCode: b.prefCode,
    muniCode: b.muniCode ?? null,
    muniName: clip(b.muniName),
    species: clip(b.species),
    test: b.test,
    focusZone: { from: dayOrNull(b.focusZone?.from), to: dayOrNull(b.focusZone?.to) },
    sourceUrl: b.sourceUrl,
  };
}

export function toPublicWatchStatus(w: WatchStatus): WatchStatus {
  return {
    prefCode: w.prefCode,
    checkedAt: dayOrNull(w.checkedAt),
    ok: w.ok === true,
    lastOkAt: dayOrNull(w.lastOkAt),
    failingSince: dayOrNull(w.failingSince),
  };
}

/** 47 都道府県の行を PREFS の順に。記録のない県は未確認（ok:false）の行にする。 */
export function watchRows(all: readonly WatchStatus[]): WatchStatus[] {
  return PREFS.map((p) => {
    const found = all.find((w) => w.prefCode === p.code);
    return found
      ? toPublicWatchStatus(found)
      : { prefCode: p.code, checkedAt: null, ok: false, lastOkAt: null, failingSince: null };
  });
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
export const prefNameOf = (code: PrefCode): string => PREF_NAME.get(code) ?? code;

/** 「47 都道府県のうち N 件を確認、M 件は確認できていません（県名）」（設計書 §9.7）。未確認を発生なしと読ませない一文を足す。 */
export function watchNotice(w: WatchSummary): string {
  if (w.failedCount === 0) return `${PREFS.length} 都道府県すべてを、直近 6 時間以内に見回りました（${w.asOf} 時点）。`;
  const names = w.failedPrefCodes.map(prefNameOf).join("、");
  return `${PREFS.length} 都道府県のうち ${w.okCount} 件を確認、${w.failedCount} 件は確認できていません（${names}。${w.asOf} 時点）。確認できていない県の「載っていない」は、発生がないという意味ではありません。`;
}

/** どの応答にも添える 2 文。県の連絡が正であること、シーズン中はどこでもリスクがあること。 */
export function baseNotices(): string[] {
  return [FIXED_TEXT.prefContactIsAuthority, FIXED_TEXT.riskAnywhere];
}
