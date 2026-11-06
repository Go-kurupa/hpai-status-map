// 対策の見直し相談の型。型と定数だけを置く。カードの JSON の形は設計書 6 章に合わせる。

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
  // 条件の印。相談の関数は使わない。
  conditionTags: string[];
  // 引用が原文にあると、プログラムが照合したか。
  quoteVerified?: boolean;
  // 作者が「使う」と決めたか。使うカードは true だけ。
  approved: boolean;
}

export interface ConsultCardsFile {
  sources: ConsultSource[];
  cards: ConsultCard[];
}

// 相談の関数（consultAsk）の返事。関数と画面が同じ型を使う。
export type ConsultNotice = null | "daily_limit" | "budget_stop";

export interface ConsultAskResponse {
  answer: string;
  cards: ConsultCard[];
  outOfScope: boolean;
  /** Claude を呼ばなかった理由（予算の停止、1 日の回数）。呼んだときと、範囲外の問いは null */
  notice: ConsultNotice;
}
