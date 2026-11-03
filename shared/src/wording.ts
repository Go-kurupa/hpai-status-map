import { normalizeForMatch } from "./text";

/** 使ってはいけない語。件数 0 や区域の外を「安全」と読ませない。 */
export const FORBIDDEN_PHRASES: readonly string[] = ["区域の外です", "安全", "安心"];

/** 空白や改行で割れていても見つける。 */
export function findForbiddenPhrases(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return FORBIDDEN_PHRASES.filter((phrase) => normalized.includes(normalizeForMatch(phrase)));
}

export const FIXED_TEXT = {
  /** 県の連絡が正 */
  prefContactIsAuthority: "県の連絡が正です",
  /** 国の報告書の言葉（出典つき） */
  riskAnywhere:
    "件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典: 農林水産省 疫学調査報告書 https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf）",
  pastDisclaimer: "過去の記録です。これからの発生を予測するものではありません",
  replayBanner: "去年の再現です",
  /** /area、API、MCP の全段階 */
  areaNoDistance: "距離は見ていません。地点を登録すると区域の可能性が分かります",
  sameMuniLifted: "この町で発生しました（移動制限は解除されました）",
} as const;
