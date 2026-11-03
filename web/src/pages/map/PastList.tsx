import type { PastHit } from "@hpai/shared/past";
import { monthDay } from "./townLine";
import { TEXT } from "./texts";

/** 1 行の文。関連農場は「関連農場」と明示し、日付は本体の発生日として出す（関連農場の日付は本体から借りた行がある） */
function hitText(h: PastHit): string {
  const where = h.relation === "same" ? `${h.muniNameThen}（この町）` : `${h.muniNameThen}（隣町）`;
  if (h.related) {
    // 関連農場の日付は、本体から借りたものがある。自分の発生日として見せず、本体の発生日として出す
    const of = h.parentDate ? `（${monthDay(h.parentDate)}の発生に関連）` : "";
    return `${h.ago}　${where}　${h.no} 例目の関連農場${of}`;
  }
  return `${h.ago}　${monthDay(h.date)}　${where}で発生`;
}

/** この町と隣町の過去の発生。色を使わない事実の一覧（設計書 §15） */
export function PastList({ hits }: { hits: readonly PastHit[] }) {
  if (hits.length === 0) return null;
  return (
    <details className="past-details">
      <summary>{TEXT.pastDetails}</summary>
      <ul className="past-list" aria-label="過去の発生">
        {hits.map((h, i) => (
          <li key={`${h.season}-${h.no}-${h.related ? "r" : "m"}-${h.muniCode}-${i}`}>
            {hitText(h)}{" "}
            <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer">
              出典
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
