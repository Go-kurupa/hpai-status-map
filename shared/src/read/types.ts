// 読み取りの型（I-03）。型だけを置く。読み取りの型はここだけで、I-01〜I-08、X-07、X-14 が読む。
import type { Case, CaseStage, IsoDateTime, MuniCode, PrefCode, SourceKind, StageDates, StageStamp, WildBird, WildBirdTest } from "../types";

export type DocumentKind =
  | "suspected"
  | "confirmed"
  | "progress"
  | "control_done"
  | "zone_lifted"
  | "negated"
  | "wild_bird"
  | "other_pref"
  | "drill"
  | "notice"
  | "irrelevant";

export type ReadState =
  | "pending"
  | "reading"
  | "published"
  | "review_public"
  | "review_private"
  | "discarded"
  | "skipped_budget";

export interface ReadDate {
  year: number | null;
  month: number;
  day: number;
  time: string | null;
}

export interface Quoted<T> {
  value: T | null;
  quote: string | null;
}

export interface ReadResult {
  kind: DocumentKind;
  kindQuote: string | null;
  multipleCases: boolean;
  prefecture: Quoted<string>;
  municipality: Quoted<string>;
  nationalNo: Quoted<number>;
  prefNo: Quoted<number>;
  birdUse: Quoted<string>;
  housing: Quoted<string>;
  headCount: Quoted<number>;
  negationBasis: Quoted<string>;
  primaryStage: CaseStage | null;
  primaryDate: ReadDate | null;
  primaryDateQuote: string | null;
  stageEvents: Array<{ stage: CaseStage; date: ReadDate; quote: string }>;
  radiiKm: Array<{ km: number; quote: string }>;
  estimates: Array<{ target: "shipment" | "movement" | "surveillance"; date: ReadDate; quote: string }>;
  wildBirds: Array<{
    date: ReadDate;
    prefecture: string;
    municipality: string | null;
    species: string | null;
    test: WildBirdTest;
    quote: string;
  }>;
}

export interface SecondReadResult {
  kind: DocumentKind;
  multipleCases: boolean;
  prefecture: string | null;
  municipality: string | null;
  primaryStage: CaseStage | null;
  primaryDate: ReadDate | null;
  wildBirds: Array<{ date: ReadDate; prefecture: string; municipality: string | null; test: WildBirdTest }>;
}

export type VerifyCheck =
  | "quote_exists"
  | "value_in_quote"
  | "muni_exists"
  | "stage_word"
  | "radius_sentence"
  | "chronology"
  | "year_completion";

export interface VerifyIssue {
  field: string;
  check: VerifyCheck;
  mandatory: boolean;
  detail: string; // detail に引用を入れない
}

export interface NormalizedRead {
  kind: DocumentKind;
  prefCode: PrefCode | null;
  muniCode: MuniCode | null;
  muniName: string | null;
  nationalNo: number | null;
  prefNo: number | null;
  birdUse: string | null;
  housing: string | null;
  headCount: number | null;
  primaryStage: CaseStage | null;
  primaryStamp: StageStamp | null;
  stages: StageDates;
  radiiKm: number[];
  estimates: Case["prefEstimates"];
  negationBasis: string | null;
  yearCompleted: boolean;
  wildBirds: Array<Omit<WildBird, "id" | "season" | "focusZone" | "sourceUrl">>;
}

export interface VerifyReport {
  pass: boolean; // pass は必須の項目だけで決める
  issues: VerifyIssue[];
  droppedOptional: string[];
  normalized: NormalizedRead | null;
}

export type MandatoryField = "kind" | "prefecture" | "municipality" | "primaryStage" | "primaryDate" | "wildBirds";

export interface CompareReport {
  match: boolean;
  mismatches: MandatoryField[];
}

export type PublishDecision =
  | { action: "publish"; negationCandidate: boolean }
  | { action: "review_public" | "review_private"; reasons: string[] }
  | { action: "discard"; reasons?: string[] }; // reasons は破棄の理由（`both_read:<kind>`、発生を示す語があれば `outbreak_words_present`）。DocumentRecord に残せる

export interface DocumentRecord {
  // documents/{sha256(url) 先頭 24 桁}_{指紋 先頭 12 桁}
  id: string;
  sourceId: string;
  prefCode: PrefCode | null;
  url: string;
  title: string;
  contentType: "html" | "pdf";
  storagePath: string;
  fetchedAt: IsoDateTime;
  fingerprint: string;
  hasTextLayer: boolean;
  kind: DocumentKind | null;
  readState: ReadState;
  primary: ReadResult | null;
  second: SecondReadResult | null;
  verify: VerifyReport | null;
  compare: CompareReport | null;
  caseId: string | null;
  error: string | null; // `refusal:<category>`、`format_error`、`max_tokens`、`api_error`
}

export type ReviewItem = { id: string; createdAt: IsoDateTime; resolvedAt: IsoDateTime | null } & (
  | { kind: "document"; documentId: string; url: string; prefCode: PrefCode | null; title: string; reasons: string[]; hasOutbreakWords: boolean }
  | { kind: "entrance_proposal"; prefCode: PrefCode; oldUrl: string | null; proposedUrl: string; sourceKind: SourceKind; rationale: string }
  | {
      kind: "alert";
      alert: "case_stalled" | "negation_candidate" | "national_missing" | "app_only_confirmed" | "watch_failing" | "agent_run_failed" | "mail_failing";
      prefCode: PrefCode | null;
      caseId: string | null;
      message: string;
    }
);
