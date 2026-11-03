// 契約 2.1〜2.4。日時は Timestamp を使わず JST の ISO 8601 文字列。

// ── 2.1 基本と公開データ ──
export type PrefCode = string; // "01"〜"47"
export type MuniCode = string; // 5 桁。政令市は市のコード。区のコードを保存しない
export type MeshCode = string; // 3 次メッシュ 8 桁
export type Season = number; // 2025 = 2025-06-01〜2026-05-31
export type IsoDate = string; // "2025-12-20"
export type IsoDateTime = string; // "2025-12-20T09:00:00+09:00"
export interface StageStamp {
  date: IsoDate;
  time: string | null; // null は「時刻の記載なし」
}
export type CaseStage =
  | "suspected"
  | "confirmed"
  | "culling_done"
  | "control_done"
  | "shipment_lifted"
  | "movement_lifted"
  | "surveillance_lifted"; // §10.2 は枝分かれするので順序のある 1 値にしない
export type StageDates = Partial<Record<CaseStage, StageStamp>>;
export type NegationState = "none" | "candidate" | "negated";
// reviewing 県名とリンクだけ公開／auto 照合と二重読みに合格／national 国の定型文か過去の資料／operator 運営者が確定／replay 再現
export type ConfirmState = "reviewing" | "auto" | "national" | "operator" | "replay";
export interface Case {
  id: string; // 確認中は `rev-${documentId}`、過去は `h${season}-${no}`
  season: Season;
  nationalNo: number | null;
  prefNo: number | null;
  prefCode: PrefCode;
  muniCode: MuniCode | null;
  muniName: string | null; // reviewing のときだけ null
  birdUse: string | null;
  housing: string | null; // 公表どおりの語
  headCount: number | null;
  stages: StageDates;
  radiiKm: number[]; // 空なら既定 10km
  prefEstimates: { shipment: IsoDate | null; movement: IsoDate | null; surveillance: IsoDate | null };
  negation: NegationState;
  negatedAt: IsoDateTime | null;
  confirmState: ConfirmState;
  sourceUrls: string[];
  updatedAt: IsoDateTime;
}
export type WildBirdTest = "screening_positive" | "hpai_confirmed" | "negative";
export interface WildBird {
  id: string;
  season: Season;
  date: IsoDate;
  prefCode: PrefCode;
  muniCode: MuniCode | null;
  muniName: string | null;
  species: string | null;
  test: WildBirdTest;
  focusZone: { from: IsoDate | null; to: IsoDate | null }; // 読まないので今は null
  sourceUrl: string;
}
export interface WatchStatus {
  // watchStatus/{prefCode}。全入口が成功のときだけ ok
  prefCode: PrefCode;
  checkedAt: IsoDateTime | null;
  ok: boolean;
  lastOkAt: IsoDateTime | null;
  failingSince: IsoDateTime | null;
}
export interface WatchSummary {
  asOf: IsoDateTime;
  okCount: number;
  failedCount: number;
  failedPrefCodes: PrefCode[];
}
export interface HistoryCase {
  // data/history/cases.json
  season: Season;
  no: number;
  prefCode: PrefCode;
  muniCode: MuniCode;
  muniNameThen: string;
  date: IsoDate;
  birdUse: string | null;
  housing: string | null;
  headCount: number | null;
  sourceUrl: string;
  related: boolean; // 関連農場。件数（52、25、84、11、51、24）に入れない
}
// `related:true` を見るのは `describePast`（町の履歴に「関連農場」と明示）だけ。
// 棒、バッジ、校正、API は `related:false` だけを使う。

// ── 2.2 サーバーのデータ ──
export type SourceKind = "maff_press" | "maff_season" | "moe" | "pref_fixed" | "pref_rss" | "pref_press_list";
export interface SourceSeed {
  prefCode: PrefCode | null;
  url: string;
  kind: SourceKind;
  confirmedOn: IsoDate;
  note: string | null;
}
export interface RuntimeSettings {
  // usage/settings
  softLimitJpy: number;
  hardLimitJpy: number;
  jpyPerUsd: number;
  autoPublishEnabled: boolean; // I-06 の合格と利用者の確認の後に true
  primaryModel: string;
  primaryEffort: "low" | "medium" | "high" | "xhigh" | "max";
  secondModel: string;
}
export const DEFAULT_RUNTIME_SETTINGS: Readonly<RuntimeSettings> = Object.freeze({
  softLimitJpy: 2000,
  hardLimitJpy: 2500,
  jpyPerUsd: 150,
  autoPublishEnabled: false,
  primaryModel: "claude-opus-5-5",
  primaryEffort: "medium",
  secondModel: "claude-haiku-5-5",
});
export type EvalMetricName =
  | "documents"
  | "read_refusals"
  | "format_errors"
  | "primary_muni_errors"
  | "primary_stage_errors"
  | "primary_date_errors"
  | "primary_headcount_errors"
  | "published_mandatory_errors"
  | "published_headcount_errors"
  | "auto_published_documents"
  | "review_documents"
  | "second_reader_mismatches"
  | "tamper_rejected"
  | "detection_prev_season" // 前季 24/24。I-01 の国の判定の結果から
  | "detection_title_classification"; // 国の題 70 件の分類
export interface EvalSummary {
  // evals/results/summary.json。I-06 が書き、X-09 が読む
  measuredAt: IsoDateTime;
  metrics: Array<{ name: EvalMetricName; value: number; denominator: number | null; unit: string; note: string | null }>;
  unmeasured: string[]; // 測っていないものはここに入れ、0 と書かない
  costPerDocumentUsd: number | null;
}

// ── 2.3 会員のデータ ──
export type Production = "layer" | "broiler";
export type FarmHousing = "windowless" | "open" | "free_range";
export interface NotifySettings {
  level1: boolean;
  level2: boolean;
  level3: boolean;
  morningDigest: boolean;
  selfCheckRemindDays: number | null;
}
export interface Farm {
  // farms/{farmId}
  name: string;
  memberUids: string[];
  unsubscribedUids: string[]; // サーバーだけが書く
  meshCode: MeshCode; // 緯度経度のフィールドを持たない
  muniCode: MuniCode;
  prefCode: PrefCode;
  frequentMuniCodes: MuniCode[];
  production: Production | null;
  housing: FarmHousing | null; // M-05 で入れる。null は未設定
  kahoContact: string;
  notify: NotifySettings;
  selfCheckDue: Record<string, IsoDate>; // "YYYY-MM" → 期限日（§8）
  updatedAt: IsoDateTime;
}
export interface House {
  name: string;
  birdType: string;
  flockSize: number;
  empty: boolean;
}
export type ExclusionKind = "disease" | "equipment" | "temperature" | "disaster" | "empty" | "other";
export interface DeathRecord {
  // farms/{farmId}/deaths/{date}_{houseId}。入力者を持たない
  date: IsoDate;
  houseId: string;
  deaths: number;
  flockSizeAt: number; // 羽数の変更で過去の率が動かない【計】
  exclusion: { kind: ExclusionKind; note: string } | null;
}
export type SelfCheckItemNo = "17" | "18" | "19" | "22" | "23" | "25" | "27";
export type CheckRecord = // farms/{farmId}/checks/{id}。入力者を持たない
  | { kind: "disinfection"; date: IsoDate; itemId: string }
  | { kind: "self_inspection"; date: IsoDate; month: string; answers: Record<SelfCheckItemNo, "ok" | "ng" | null> };
export interface CaseDraft {
  // caseDrafts/{caseId}
  caseId: string;
  workerMessage: string;
  source: "claude" | "template";
  createdAt: IsoDateTime;
}

// ── 2.4 段階 ──
export type Level = 1 | 2 | 3 | 4;
export type LevelReasonKind = "within_radius" | "same_muni" | "adjacent" | "frequent";
export interface LevelReason {
  caseId: string;
  level: Level;
  kind: LevelReasonKind;
  distanceKm: number | null;
  radiusKm: number | null;
}
export interface LevelResult {
  level: Level;
  reasons: LevelReason[]; // reasons は当たった事例すべて、段階の高い順
  shipmentLifted: boolean; // ① の事例で搬出制限が解除済み
  inSurveillanceNote: boolean; // 監視強化区域の説明を出す（段階に数えない）
}
export interface FarmPoint {
  meshCode: MeshCode;
  muniCode: MuniCode;
  frequentMuniCodes: MuniCode[];
}
export interface AreaStatus {
  // /area/{code} と API。地点がないので距離を見ない
  muniCode: MuniCode;
  muniName: string;
  prefCode: PrefCode;
  asOf: IsoDateTime;
  level: 1 | 2 | 4;
  sameMuniCases: Case[];
  adjacentCases: Case[];
  wildBirds: WildBird[];
  sourceUrls: string[];
}
export type ChecklistClass = "always" | "if_in_zone" | "good_to_check";
