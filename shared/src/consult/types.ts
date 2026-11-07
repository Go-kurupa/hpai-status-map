// 対策の見直し相談の型。型と定数だけを置く。カードの JSON の形は設計書 6 章に合わせる。

import type { FarmRearing, Production } from "../types";
import type { ConsultStats } from "./stats";

// 根拠の強さ（画面では EVIDENCE_LABEL の札で出す）。
export type Evidence =
  | "obligation"
  | "outbreak-finding"
  | "study-association"
  | "study-no-difference"
  | "recommendation"
  | "expert-estimate";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  obligation: "義務",
  "outbreak-finding": "発生農場の調査で見つかった不備",
  "study-association": "研究で関係あり",
  "study-no-difference": "研究では効果が測られていない",
  recommendation: "公的機関の推奨",
  "expert-estimate": "専門家の推定",
};

export type SourceKind = "law" | "guideline" | "report" | "pamphlet" | "paper" | "guide";

// 自由に使える資料の許可証だけ。ここにないものは読み込みで弾く。
export type ConsultLicense = "PDL1.0" | "CC BY" | "CC BY 4.0" | "OGL v3.0" | "US Gov";

export interface ConsultSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  // 取得日（YYYY-MM-DD、または日時）。
  fetchedAt: string;
  // 国内の資料なら true、海外なら false。
  domestic: boolean;
  kind: SourceKind;
  license: ConsultLicense;
  // 許可証を人が資料の頁で確かめたか。
  licenseVerified: boolean;
  // 調査の種類（論文など）。ないものは null。
  studyDesign: string | null;
}

export interface ConsultCard {
  id: string;
  // 出どころの短い名前（画面の見出し用）。
  origin: string;
  // 対策。
  action: string;
  // 効く条件（どんな農場に当てはまるか）。
  appliesTo: string;
  evidence: Evidence;
  evidenceNote: string;
  // 原文の引用。空は不可。
  quote: string;
  sourceId: string;
  // 資料の中の場所（章、頁など）。
  locator: string;
  caveats: string[];
  // 条件の印。相談の関数も画面も使わない。data/consult/cards.json と scripts/consult の組み立て・照合が持つ（カードの分類の記録として残す）。
  conditionTags: string[];
  // 引用が原文にあると、プログラムが照合したか。scripts/consult の照合が書く記録で、相談の関数も画面も読まない。
  quoteVerified?: boolean;
  // 作者が「使う」と決めたか。使うカードは true だけ。
  approved: boolean;
}

export interface ConsultCardsFile {
  sources: ConsultSource[];
  cards: ConsultCard[];
}

/** 会員 1 人が 1 日（日本時間）に頼める回数（話題と文の合計）。関数と画面の文が同じ数を使う。 */
export const CONSULT_DAILY_LIMIT = 10;

// 相談の関数（consultAsk）の返事。関数と画面が同じ型を使う。
//  - daily_limit / budget_stop: Claude を呼ばなかった（1 日の回数、月の予算）
//  - unavailable: Claude を呼んだが答えを作れなかった（通信の失敗、形の違い、途中で切れた、鍵を読めない）。拒否は含まない
export type ConsultNotice = null | "daily_limit" | "budget_stop" | "unavailable";

/** 画面に出す資料の情報（応答のカードに付ける。静的な cards.json に頼らずに出典を出すため）。 */
export type ConsultSourceInfo = Pick<ConsultSource, "id" | "title" | "publisher" | "url" | "domestic" | "license">;

/** 応答のカード。カードのデータそのものに、その資料の情報を付ける。 */
export type ConsultAnswerCard = ConsultCard & { source: ConsultSourceInfo };

export interface ConsultAskResponse {
  answer: string;
  cards: ConsultAnswerCard[];
  outOfScope: boolean;
  /** Claude を呼ばなかった理由（予算の停止、1 日の回数）か、答えを作れなかったこと（unavailable）。それ以外は null */
  notice: ConsultNotice;
  /**
   * 続けて聞く候補（Claude の下書き。検査に通ったものだけ、CONSULT_MAX_FOLLOW_UPS 個まで）。答えがないときは空。
   * 古い関数の返事にはないので、画面は無いものとして扱う。
   */
  followUps?: string[];
  /**
   * 発生の件数の表（Claude が数え方を選び、プログラムが過去の事例から数えたもの。stats.ts）。件数の問いでなければ null。
   * 古い関数の返事にはないので、画面は無いものとして扱う。
   */
  stats?: ConsultStats | null;
  /**
   * 今回の相談に付けた農場の条件（関数が検査して Claude に渡したもの）。条件を付けなかった相談にはない。
   * 古い関数の返事と、この項目ができる前の記録にもないので、画面は無いものとして扱う。
   */
  farm?: ConsultFarmCondition;
}

/**
 * 相談に付ける農場の条件。本人が農場の設定に登録し、その相談で「この飼い方で相談する」を選んだときだけ送る。
 * 飼育目的（production）と飼い方（rearing）だけ。登録のない側の項目は入れない（推測で埋めない）。鶏舎の造り（housing）は入れない。
 * Claude にはカードを選ぶ材料として渡し、根拠にはしない（根拠はカードだけ）。
 */
export interface ConsultFarmCondition {
  production?: Production;
  rearing?: FarmRearing;
}

/** 続けて聞くときに、画面が関数へ渡す前の往復（同じ相談の直前の分だけ）。根拠にはしない。問いの意味を読む材料。 */
export interface ConsultTurn {
  question: string;
  answer: string;
}

/** 関数へ渡す前の往復の数の上限。 */
export const CONSULT_MAX_HISTORY = 3;
/** 聞く文の長さの上限（文字の数）。画面の入力欄と関数が同じ数を使う。前の往復の問いも同じ上限。 */
export const CONSULT_MAX_QUESTION = 300;
/** 前の往復の答えの長さの上限（文字の数）。答えの検査の上限と同じ。 */
export const CONSULT_HISTORY_ANSWER_MAX = 500;
/** 続けて聞く候補の数の上限。 */
export const CONSULT_MAX_FOLLOW_UPS = 2;
/** 続けて聞く候補 1 つの長さの上限（文字の数）。 */
export const CONSULT_FOLLOW_UP_MAX_CHARS = 30;
