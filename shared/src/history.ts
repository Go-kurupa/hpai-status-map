// 過去の事例（data/history/cases.json）を、段階の計算に使う Case にする（契約 3.1、F-08）。
// 純粋な関数だけ。関連農場（related:true）は段階に数えないので受け付けない。
import type { Case, HistoryCase } from "./types";

/** 過去の 1 事例を Case にする。県の見込み、半径、否定はなく、段階は確認だけ。related:true は throw する。 */
export function historyToCase(h: HistoryCase): Case {
  if (h.related) throw new RangeError(`関連農場は段階に数えません: h${h.season}-${h.no} ${h.muniNameThen}`);
  return {
    id: `h${h.season}-${h.no}`,
    season: h.season,
    nationalNo: h.no,
    prefNo: null,
    prefCode: h.prefCode,
    muniCode: h.muniCode,
    muniName: h.muniNameThen,
    birdUse: h.birdUse,
    housing: h.housing,
    headCount: h.headCount,
    stages: { confirmed: { date: h.date, time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "national",
    sourceUrls: [h.sourceUrl],
    updatedAt: `${h.date}T00:00:00+09:00`,
  };
}

/** related:false の行だけを Case にする（校正、棒、バッジ、API はこちらを使う）。順序は保つ。 */
export function pastCasesOf(rows: readonly HistoryCase[]): Case[] {
  return rows.filter((h) => !h.related).map(historyToCase);
}
