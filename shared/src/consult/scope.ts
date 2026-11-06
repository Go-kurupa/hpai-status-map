// 対策の見直し相談: 範囲外の問いの見分け。健康・区域・診断の問いは、Claude を呼ばずに決まった文を返す。
import { normalizeForMatch } from "../text";

// 決まった文（作者の決定 9）。1 文字も変えない。
export const OUT_OF_SCOPE_TEXT = "集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。";

// 健康の語。単独の「うつる」「感染する」は鶏舎や農場の間の話にもなるので入れない。
// 人の文脈の語（人に、人へ、人間、人の健康）があるときだけ、うつる、感染するも健康の問いになる。
const HEALTH_WORDS = ["人に", "人へ", "人間", "人の健康", "健康", "受診", "病院", "卵を食べ", "肉を食べ"];
const ZONE_WORDS = ["制限区域", "搬出制限", "移動制限", "区域に入"];
const DIAGNOSIS_WORDS = ["診断", "元気がない", "症状", "死んだ", "死亡が", "鳥インフルですか", "陽性"];

const OUT_OF_SCOPE_WORDS = [...HEALTH_WORDS, ...ZONE_WORDS, ...DIAGNOSIS_WORDS];

export function isOutOfScopeQuestion(q: string): boolean {
  const s = normalizeForMatch(q);
  return OUT_OF_SCOPE_WORDS.some((w) => s.includes(w));
}
