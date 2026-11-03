// 国の PDF の文字層は部首用の文字で出る。照合と語の検索はすべて normalizeForMatch を通す。

// CJK 部首補助（U+2E80〜）は NFKC で変わらないので、表で直す。「部首 + 漢字」の組を空白で区切る。
// 康熙部首（U+2F00〜。⾼ ⿃ など）は NFKC で直る。
const RADICAL_TABLE = "⺠民 ⻁虎 ⻄西 ⻅見 ⻆角 ⻈言 ⻉貝 ⻊足 ⻋車 ⻑長 ⻘青 ⻝食 ⻣骨 ⻤鬼 ⻨麦 ⻩黄 ⻫斉 ⻭歯 ⻯竜 ⻲亀";

const RADICAL_MAP: ReadonlyMap<string, string> = new Map(
  RADICAL_TABLE.split(" ").map((pair) => {
    const [radical, kanji] = [...pair];
    return [radical!, kanji!] as const;
  }),
);
const RADICAL_PATTERN = new RegExp(`[${[...RADICAL_MAP.keys()].join("")}]`, "gu");

/** NFKC、⻘⻲⻑ の変換表、空白と改行の除去、ヶ→ケ。 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(RADICAL_PATTERN, (c) => RADICAL_MAP.get(c) ?? c)
    .replace(/\s+/gu, "")
    .replace(/ヶ/gu, "ケ");
}

const HPAI_WORDS = /鳥インフル|高病原性|疑似患畜|HPAI/u;

/** 正規化の後に 鳥インフル|高病原性|疑似患畜|HPAI を探す。語の判定はこれだけ。 */
export function hasHpaiWord(text: string): boolean {
  return HPAI_WORDS.test(normalizeForMatch(text));
}
