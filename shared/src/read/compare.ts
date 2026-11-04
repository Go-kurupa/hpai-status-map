// 二重読みの一致の判定（I-04、設計書 §9.4）。主の読み手と別の読み手が、必須の項目で一致するかをプログラムで見る。
// 書き方の違い（苫田郡鏡野町と鏡野町、岡山市北区と岡山市、岡山県と岡山）は一致。
// 年が片方 null なら月日で比べ、時刻は比べない。multipleCases の不一致は kind に数える。
import { prefCodeOfName } from "../pref";
import { normalizeForMatch } from "../text";
import { muniCoreName } from "./names";
import type { CompareReport, DocumentKind, MandatoryField, ReadDate, ReadResult, SecondReadResult, VerifyReport } from "./types";
import { PREF_FILLED_FROM_SOURCE } from "./notes";

const CASE_KINDS: ReadonlySet<DocumentKind> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);

function samePref(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const ca = prefCodeOfName(a);
  const cb = prefCodeOfName(b);
  return ca !== null && cb !== null ? ca === cb : normalizeForMatch(a) === normalizeForMatch(b);
}

function sameMuni(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return muniCoreName(a) === muniCoreName(b);
}

function sameDate(a: ReadDate | null, b: ReadDate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
}

function sameBirds(a: ReadResult["wildBirds"], b: SecondReadResult["wildBirds"]): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  for (const x of a) {
    const j = b.findIndex(
      (y, idx) =>
        !used.has(idx) && samePref(x.prefecture, y.prefecture) && sameMuni(x.municipality, y.municipality) && sameDate(x.date, y.date) && x.test === y.test,
    );
    if (j < 0) return false;
    used.add(j);
  }
  return true;
}

/**
 * 主の都道府県が空で、照合が取得元の県で補った（印がある）ときだけ、補った県で比べる。それ以外は主の読みの値で比べる。
 */
function primaryPrefMatches(primary: ReadResult, second: SecondReadResult, verify: Pick<VerifyReport, "issues" | "normalized"> | null): boolean {
  const filled = primary.prefecture.value === null && verify?.issues.some((i) => i.field === "prefecture" && i.detail === PREF_FILLED_FROM_SOURCE);
  const code = verify?.normalized?.prefCode ?? null;
  if (filled && code !== null) return second.prefecture !== null && prefCodeOfName(second.prefecture) === code;
  return samePref(primary.prefecture.value, second.prefecture);
}

/** verify は主の読みの照合の結果（省略可）。都道府県を取得元の県で補ったかを見るだけに使う。 */
export function compareReads(primary: ReadResult, second: SecondReadResult, verify: Pick<VerifyReport, "issues" | "normalized"> | null = null): CompareReport {
  const mismatches: MandatoryField[] = [];
  if (primary.kind !== second.kind || primary.multipleCases !== second.multipleCases) mismatches.push("kind");
  // 家きんの事例の種類は都道府県、市町村、段階、日付を、野鳥は各行を比べる。他県の対策や訓練などは種類だけ。
  if (CASE_KINDS.has(primary.kind)) {
    if (!primaryPrefMatches(primary, second, verify)) mismatches.push("prefecture");
    if (!sameMuni(primary.municipality.value, second.municipality)) mismatches.push("municipality");
    if (primary.primaryStage !== second.primaryStage) mismatches.push("primaryStage");
    if (!sameDate(primary.primaryDate, second.primaryDate)) mismatches.push("primaryDate");
  } else if (primary.kind === "wild_bird") {
    if (!sameBirds(primary.wildBirds, second.wildBirds)) mismatches.push("wildBirds");
  }
  return { match: mismatches.length === 0, mismatches };
}
