// 読み取りの試験の型と置き場所（I-06）。
// 正解（answers/*.json）は事実の値と出典の URL だけを持つ。本文と引用は持たない（公開リポジトリ。県の文章を転載しない）。
import path from "node:path";
import type { CaseStage, IsoDate, PrefCode, Season, WildBirdTest } from "@hpai/shared/types";
import type { DocumentKind } from "@hpai/shared/read/types";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const ANSWERS_DIR = path.join(ROOT, "evals", "answers");
/** 作った文書（実在の農場や人を指さない。冒頭に「試験のために作った文書です」）。公開してよい。 */
export const FABRICATED_DIR = path.join(ROOT, "evals", "fabricated");
/** 取得した原文の控え。.gitignore 済み（data/private/）。公開しない。 */
export const FIXTURE_DIR = path.join(ROOT, "data", "private", "fixtures", "eval");
/** 実際の応答、バッチ ID。.gitignore 済み。応答の本文と引用はここにだけ置く。 */
export const PRIVATE_RUNS_DIR = path.join(ROOT, "data", "private", "eval-runs");
/** 過去分の読み取り（公開しない）。 */
export const PRIVATE_BACKFILL_DIR = path.join(ROOT, "data", "private", "backfill");
/** 公開してよい結果（事実のみ）。summary.json は X-09 が読む。 */
export const RESULTS_DIR = path.join(ROOT, "evals", "results");

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * title は読み手に「題:」として渡す文字列で、本番の入力と同じにする: 国の発表は月別一覧のリンクの文字列（filterMaffItems が返す題）、
 * 県の発表は取得した一覧ページのリンクの文字列（末尾のファイルの大きさの表記は除く）、一覧のない文書は HTML の見出しか PDF の表題の行。
 * 作った文書は冒頭の題の行。
 *
 * 正解。file は id で始まるファイル名: 作った文書は FABRICATED_DIR、実在の文書は FIXTURE_DIR の下。
 * primaryStage / primaryDate は「この文書がいちばん新しく知らせる段階とその日」。段階を知らせない文書（進捗の報など）は両方 null。
 * 正解の段階が null の文書では、日付は採点で比べない。
 * radiiKm は移動制限区域と搬出制限区域の半径だけ。区域の外への自粛の要請の距離（京都、岐阜の型）は入れない。
 * wildBirds の date は「その行の結果が出た日」（簡易検査の陽性、遺伝子検査の結果、検出の発表の日）。
 */
export interface EvalAnswer {
  id: string;
  url: string | null; // 作った文書は null
  fabricated: boolean;
  file: string | null;
  season: Season;
  title: string;
  contentType: "html" | "pdf";
  kind: DocumentKind;
  prefCode: PrefCode | null;
  muniName: string | null;
  primaryStage: CaseStage | null;
  primaryDate: IsoDate | null;
  nationalNo: number | null;
  headCount: number | null;
  radiiKm: number[];
  wildBirds: Array<{ date: IsoDate; prefCode: PrefCode; muniName: string | null; test: WildBirdTest }> | null;
}
