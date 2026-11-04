// Claude の下書きの返事に共通の検査（長さの上限と URL の拒否）。近隣への説明文と声かけ文の両方が使う（S-28）。
// 下書きは人が確認して確定するが、長い文や外への URL が混ざると、確認が漏れやすくなる。
import { normalizeForMatch } from "@hpai/shared/text";

/** 長さ（文字の数）が上限を超えたら too_long、URL らしいものがあれば url。理由の符号だけを返し、文の断片は入れない。 */
export function lengthAndUrlFailures(text: string, maxChars: number): string[] {
  const failures: string[] = [];
  if (Array.from(text).length > maxChars) failures.push("too_long");
  if (/https?:|www\./iu.test(normalizeForMatch(text))) failures.push("url");
  return failures;
}
