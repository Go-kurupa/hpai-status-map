// 見回りが使う道具と共通の型（I-01。I-02、I-12、I-18 も使う）。取得、時計、市町村の形は引数で受け、試験で差し替える。
import type { GeoStore } from "@hpai/shared/geo";
import type { IsoDate, PrefCode, Source } from "@hpai/shared/types";
import type { FetchOutcome, politeFetch } from "./politeFetch";

export interface WatchDeps {
  fetch: typeof politeFetch;
  now(): Date;
  geo: GeoStore;
}

/** 入口 1 つの確認の結果。ok のときだけ etag、lastModified、指紋を入口に保存する（失敗は何も変えない）。 */
export interface CheckResult {
  ok: boolean;
  etag: string | null;
  lastModified: string | null;
  fingerprint: string | null;
}

/** 人が見る箱（I-02 の enqueueReview）に入れる候補。見回りは箱を直接書かず、tick の結果で返す。 */
export interface ReviewNote {
  url: string;
  title: string;
  prefCode: PrefCode | null;
  reason: "unreadable" | "ambiguous_case" | "muni_not_found" | "number_conflict" | "title_unclassified";
  /** 残した文書の id（箱の項目 doc-<id> になる）。 */
  documentId: string;
}

/** 国の解除の発表に対応する事例がなかった（national_missing の候補）。 */
export interface MissingNote {
  url: string;
  prefCode: PrefCode;
  muniName: string;
  nationalNos: number[];
  date: IsoDate;
}

/** 入口の確認が tick に返す知らせ。 */
export interface TickSink {
  reviews: ReviewNote[];
  missing: MissingNote[];
}

export type SourceHandler = (source: Source, deps: WatchDeps, sink: TickSink) => Promise<CheckResult>;
export type Handlers = Partial<Record<Source["kind"], SourceHandler>>;

export const FAILED: CheckResult = { ok: false, etag: null, lastModified: null, fingerprint: null };

/** 取得に失敗した結果（再試行しない）。成功と not_modified は呼び手が扱う。 */
export function isFailure(outcome: FetchOutcome): outcome is Exclude<FetchOutcome, { kind: "ok" } | { kind: "not_modified" }> {
  return outcome.kind !== "ok" && outcome.kind !== "not_modified";
}
