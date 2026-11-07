import { normalizeForMatch } from "./text";

/** 使ってはいけない語。件数 0 や区域の外を「安全」と読ませない。 */
export const FORBIDDEN_PHRASES: readonly string[] = ["区域の外です", "安全", "安心"];

/** 空白や改行で割れていても見つける。 */
export function findForbiddenPhrases(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return FORBIDDEN_PHRASES.filter((phrase) => normalized.includes(normalizeForMatch(phrase)));
}

/**
 * 過去の発生について言わないこと（設計書 §11「過去の発生の文言」の「言わないこと」）。
 * normalizeForMatch（NFKC、空白と改行の除去）の後の文字列に当てる。事実として言ってよい文
 * （「10 km 以内の区域」「2 年前に隣町で発生しました（記録）」「水辺が近い農場に発生が多い傾向」など）は落とさない。
 */
export const PAST_NG_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "また発生しやすい", re: /(?:また|再び)発生しやすい|再発しやすい/u },
  { label: "この町も危ない", re: /この町も危ない/u },
  // 「感染症」（隣町から感染症の情報）は事実の文なので落とさない
  { label: "隣町からうつる", re: /隣町から(?:の感染(?!症)|感染(?!症)|うつ[るりっ]|移[るりっ]|広が[るりっ])/u },
  { label: "危険地帯", re: /危険地帯/u },
  { label: "ホットスポット", re: /ホットスポット/u },
  // 距離で確率や安全度を言わない: 「X km 以内なら…」「感染確率は Y%」「半径 X km 以内では感染確率が高い」
  { label: "X km 以内なら（距離による言い切り）", re: /\d+(?:\.\d+)?(?:km|キロ(?:メートル)?)(?:以内|圏内)(?:なら|であれば|ならば)/iu },
  { label: "感染確率", re: /感染確率/u },
  { label: "発生の N 割は農場間", re: /発生.{0,5}の.{0,3}\d+割[はが]農場間|\d+割の発生[はが]農場間/u },
];

/** 画面、メール、API の文面にある、禁句と過去の発生の NG の語。見つかった語の一覧（なければ空）。 */
export function findWordingViolations(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return [...findForbiddenPhrases(text), ...PAST_NG_PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.label)];
}

/**
 * 下書きの検査（drafts.ts）が見つけて落とす語。画面にもメールにも出さない検出用の語で、禁句の置き場の wording.ts に置く
 * （文言の総点検は wording.ts を走査の対象にしない）。
 */
/** 煽る語。 */
export const SENSATIONAL_WORDS = ["危険", "危ない", "緊急事態", "非常事態", "パニック", "恐怖", "壊滅", "猛威", "爆発", "まん延", "蔓延", "大流行", "絶対", "ホットスポット", "また発生しやすい"] as const;
/** 「大丈夫」という言い切りの語。 */
export const REASSURANCE_WORDS = ["大丈夫", "平気です", "ご安心"] as const;

export const FIXED_TEXT = {
  /** 県の連絡が正 */
  prefContactIsAuthority: "県の連絡が正です",
  /** 国の報告書の言葉（出典つき） */
  riskAnywhere:
    "件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典: 農林水産省 疫学調査報告書 https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf）",
  pastDisclaimer: "過去の記録です。これからの発生を予測するものではありません",
  replayBanner: "去年の再現です",
  /** /area、API、MCP の全段階 */
  areaNoDistance: "町だけを選んでいるので、農場からの距離は見ていません。農場の地点を登録すると、区域に入るかを確かめられます",
  sameMuniLifted: "この町で発生しました（移動制限は解除されました）",
} as const;

/** 守る文 riskAnywhere の部品。文の本体、出典の名前、出典の URL */
export interface RiskAnywhereParts {
  sentence: string;
  sourceName: string;
  url: string;
}

/**
 * 守る文 riskAnywhere を、文の本体・出典の名前・URL に分ける。画面で URL を本文に出さず、出典の名前をリンクにするため。
 * 文の正は FIXED_TEXT.riskAnywhere のまま（API、MCP、メールは 1 本の文字列を使う）。形が変わったら気づけるよう、合わなければ止める。
 */
export function riskAnywhereParts(): RiskAnywhereParts {
  const m = /^(.+)（出典: (.+) (https:\/\/\S+)）$/u.exec(FIXED_TEXT.riskAnywhere);
  if (!m) throw new Error("FIXED_TEXT.riskAnywhere が「文（出典: 名前 URL）」の形ではありません");
  return { sentence: m[1]!, sourceName: m[2]!, url: m[3]! };
}
