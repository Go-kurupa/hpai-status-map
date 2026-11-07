import { FIXED_TEXT, riskAnywhereParts } from "@hpai/shared/wording";

// 守る文（FIXED_TEXT.riskAnywhere）は URL まで含む 1 本の文字列。画面では文と「出典: 名前」のリンクに分け、長い URL を本文に出さない。
// 文の正は FIXED_TEXT のまま（API、MCP、メールは 1 本の文字列を使う）
const PARTS = riskAnywhereParts();

/** 守る文の本体（出典より前）。画面に出ていないことを確かめるときは、これで探す */
export const RISK_SENTENCE = PARTS.sentence;
/** 出典の名前（リンクの文字） */
export const RISK_SOURCE_NAME = PARTS.sourceName;
/** 出典の URL（リンク先。本文には出さない） */
export const RISK_URL = PARTS.url;
/** 画面に出る守る文の全体。URL を含まない */
export const RISK_LINE_TEXT = `${RISK_SENTENCE}（出典: ${RISK_SOURCE_NAME}）`;

type RiskTag = "p" | "li" | "span";

/** スマホの地図の前の短い形で画面に出る文。URL を含まない */
export const RISK_SHORT_TEXT = `${RISK_SENTENCE}（出典）`;

/**
 * 守る文の 1 行。「文（出典: 名前）」の形で、名前を出典の URL へのリンクにする。as と className は置き場に合わせる。
 * short は、スマホの地図の前の短い形「文（出典）」。360x740 の最初の画面に地図と札を収めるため（出典の名前は RiskSource で地図の下に出す）
 */
export function RiskLine({ as: Tag = "p", className, short = false }: { as?: RiskTag; className?: string; short?: boolean }) {
  if (short) {
    return (
      <Tag className={className}>
        {RISK_SENTENCE}（
        <a href={RISK_URL} target="_blank" rel="noopener noreferrer" aria-label={`出典: ${RISK_SOURCE_NAME}`}>
          出典
        </a>
        ）
      </Tag>
    );
  }
  return (
    <Tag className={className}>
      {RISK_SENTENCE}（出典:{" "}
      <a href={RISK_URL} target="_blank" rel="noopener noreferrer">
        {RISK_SOURCE_NAME}
      </a>
      ）
    </Tag>
  );
}

/** 短い形の守る文に添える出典の 1 行「出典: 名前」。名前をリンクにし、URL は本文に出さない */
export function RiskSource({ className }: { className?: string }) {
  return (
    <p className={className}>
      出典:{" "}
      <a href={RISK_URL} target="_blank" rel="noopener noreferrer">
        {RISK_SOURCE_NAME}
      </a>
    </p>
  );
}

/** 文字列の箇条書きの 1 行。守る文なら RiskLine にし、それ以外はそのまま出す */
export function TextItem({ text }: { text: string }) {
  return text === FIXED_TEXT.riskAnywhere ? <RiskLine as="li" /> : <li>{text}</li>;
}
