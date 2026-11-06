// 対策の見直し相談: 範囲外の問いの見分け。健康・区域・診断の問いは、Claude を呼ばずに決まった文を返す。
import { normalizeForMatch } from "../text";

// 決まった文（作者の決定 9）。1 文字も変えない。
export const OUT_OF_SCOPE_TEXT = "集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。";

// 予防の印。あるときは、うつる・感染の語だけでは止めない（「人から鶏へうつさない方法」は対策の問い）。
const PREVENTION_MARKS = ["防ぐ", "防止", "予防", "ないため", "ないよう", "うつさない", "させない", "持ち込ま", "対策"];

// 健康の問い。「人」「人に」「健康」だけでは止めない（業者の人に消毒を頼む、鶏の健康管理、は対策の問い）。
// 人の語の後 8 字以内に、うつる・感染・移る・影響があるときだけ止める。予防の印があれば止めない。
const HUMAN_SPREAD = /(?:人間|ヒト|人|従業員|家族|子ども|子供).{0,8}?(?:うつ|感染|移|影響)/u;
// 食べ物の語は、人が食べる問いの形だけ。単独の「鶏肉」「卵を食べ」（卵を食べる野鳥）は止めない。
const HEALTH_WORDS = [
  "人の健康", "健康被害", "健康への影響", "受診", "病院",
  "卵を食べても", "卵は食べ", "卵は大丈夫", "鶏肉を食べ", "鶏肉は食べ", "鶏肉は大丈夫",
];
const ZONE_WORDS = ["制限区域", "搬出制限", "移動制限", "区域に入"];
// 診断の問い。「死んだ鶏の処理」のような対策の問いは止めない。
// 鳥インフルの直後にこの形が続くときだけ。間に字を挟むと「鳥インフルエンザ対策は何ですか」まで止まる。
const DIAGNOSIS_FLU = /鳥インフル(?:エンザ)?(?:ですか|でしょうか|かも|の疑い|かどうか)/u;
// 「感染しないためには」のような予防の問いにも出る形。予防の印があれば止めない。
const DIAGNOSIS_FLU_INFECTED = /鳥インフル(?:エンザ)?(?:にかか|に感染)/u;
// 窓は 4 字。「死亡の原因になる野生動物の侵入を防ぐには」は対策の問いなので、「の原因に」は除く。
const DIAGNOSIS_DEATH = /(?:死んだ|死んで|死に|死亡)(?!の原因に).{0,4}?(?:増え|多い|急に|続|原因|なぜ|理由)/u;
const DIAGNOSIS_WORDS = ["元気がない", "元気ない", "ぐったり", "症状", "診断", "陽性"];

const OUT_OF_SCOPE_WORDS = [...HEALTH_WORDS, ...ZONE_WORDS, ...DIAGNOSIS_WORDS];
// 予防の印があっても止めるもの。
const OUT_OF_SCOPE_PATTERNS = [DIAGNOSIS_FLU, DIAGNOSIS_DEATH];
// 予防の印がないときだけ止めるもの。
const PREVENTABLE_PATTERNS = [HUMAN_SPREAD, DIAGNOSIS_FLU_INFECTED];

export function isOutOfScopeQuestion(q: string): boolean {
  const s = normalizeForMatch(q);
  if (OUT_OF_SCOPE_WORDS.some((w) => s.includes(w)) || OUT_OF_SCOPE_PATTERNS.some((re) => re.test(s))) return true;
  if (PREVENTION_MARKS.some((m) => s.includes(m))) return false;
  return PREVENTABLE_PATTERNS.some((re) => re.test(s));
}
