// 運営者の画面の言葉と小さな道具。外から来た文字（題、URL、根拠）は、ここを通っても文字のまま画面に出す。
import { PREFS } from "@hpai/shared/pref";
import type { PrefCode } from "@hpai/shared/types";

const FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: "種類",
  prefecture: "都道府県",
  municipality: "市町村",
  primaryStage: "段階",
  primaryDate: "日付",
  wildBirds: "野鳥",
  nationalNo: "国内の番号",
  prefNo: "県内の番号",
  birdUse: "用途",
  housing: "飼い方",
  headCount: "羽数",
  radiiKm: "半径",
  estimates: "見込み日",
  stageEvents: "段階の日付",
  negationBasis: "否定の根拠",
};
const CHECK_LABELS: Readonly<Record<string, string>> = {
  quote_exists: "引用が本文にない",
  value_in_quote: "値が引用と合わない",
  muni_exists: "県の中にその市町村がない",
  stage_word: "段階を示す語がない",
  radius_sentence: "半径の文と合わない",
  chronology: "日付の順序が合わない",
  year_completion: "年を補えない",
};
const REASON_LABELS: Readonly<Record<string, string>> = {
  auto_publish_off: "自動で載せる設定がまだ入っていません",
  multiple_cases: "1 つの文書に複数の事例があります",
  verify_missing: "照合の結果がありません",
  compare_missing: "二重読みの結果がありません",
  verify_failed: "照合に通りませんでした",
  compare_failed: "二重読みと食い違いました",
  ambiguous_case: "同じ事例か判断できません",
  pref_mismatch: "取得元の県と、読んだ県が違います",
  pref_unknown: "県が分かりません",
  municipality_missing: "市町村が分かりません",
  primary_date_missing: "日付が分かりません",
  no_wild_bird_rows: "野鳥の行が見つかりません",
  no_case_for_negation: "否定の対象になる事例がありません",
  no_case_for_stage: "続きの事例がありません",
  negation_on_confirmed: "確定した事例への否定です",
  kind_not_applicable: "事例にならない種類の文書です",
  normalized_missing: "読み取った値がありません",
  matched_case_missing: "続報の事例が見つかりません",
  budget_stop: "費用の上限で読んでいません",
  budget_skip_progress: "費用の上限で進捗報を読んでいません",
  pipeline_error: "読み取りの処理でエラーが出ました",
  case_changed_during_read: "読んでいる間に事例が変わりました",
  outbreak_words_present: "発生を示す語があります",
};

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;
export const checkLabel = (check: string): string => CHECK_LABELS[check] ?? check;

/** 理由の符号を言葉にする。知らない符号はそのまま（文字として出す）。 */
export function reasonText(code: string): string {
  const known = REASON_LABELS[code];
  if (known !== undefined) return known;
  const i = code.indexOf(":");
  if (i > 0) {
    const head = code.slice(0, i);
    const tail = code.slice(i + 1);
    if (head === "compare") return `二重読みの食い違い: ${fieldLabel(tail)}`;
    if (head === "both_read") return `二人の読み手が「${tail}」と読みました`;
    if (head === "operator") return `運営者の操作: ${tail}`;
    if (tail in CHECK_LABELS) return `${fieldLabel(head)}: ${CHECK_LABELS[tail]}`;
  }
  return code;
}

/** http か https の URL だけをリンクにする（javascript: などは文字のまま出す） */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export const prefNameOf = (code: PrefCode | null): string | null => PREFS.find((p) => p.code === code)?.name ?? null;

/** 操作の失敗の言葉。サーバーが返した理由（作品の側の文）は出し、それ以外は固定の文にする */
export function errorText(e: unknown): string {
  const code = String((e as { code?: unknown } | null)?.code ?? "").replace(/^functions\//, "");
  const message = (e as { message?: unknown } | null)?.message;
  if ((code === "failed-precondition" || code === "invalid-argument") && typeof message === "string" && message !== "") {
    const ids = (e as { details?: { candidateIds?: unknown } } | null)?.details?.candidateIds;
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    return list.length > 0 ? `${message}（候補: ${list.join("、")}）` : message;
  }
  if (code === "permission-denied" || code === "unauthenticated") return "運営者としてログインしていません。ログインし直してください。";
  return "処理できませんでした。通信を確かめて、もう一度試してください。";
}
