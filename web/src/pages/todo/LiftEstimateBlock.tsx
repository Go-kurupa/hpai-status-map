// 解除の見込み 1 件分（段階① だけに出す）。防疫指針の決まりから数えた「見込み」で、解除は県が決める。
// 県の連絡が正であることを必ず添える。日付は「見込み」と書き、断定しない。
import { formatJaDate } from "@hpai/shared/jaDate";
import type { LiftDateSource, LiftEstimate } from "@hpai/shared/lift";
import type { IsoDate } from "@hpai/shared/types";
import { TODO_TEXT } from "./texts";

/** 日付と出所を 1 行にする。県の日と計算した日を並べても取り違えないよう、日付ごとに出所を添える */
function dateLine(date: IsoDate | null, source: LiftDateSource | null): string {
  if (date === null || source === null) return "未定";
  const day = formatJaDate(date);
  return source === "pref"
    ? `${day}（${TODO_TEXT.liftSourcePref}）`
    : `${day}（${TODO_TEXT.liftEarliestDay}。${TODO_TEXT.liftSourceCalculated}）`;
}

export function LiftEstimateBlock({ muniName, estimate }: { muniName: string; estimate: LiftEstimate }) {
  const { status } = estimate;
  return (
    <article className="lift-block">
      <h3>{muniName ? `${muniName}の発生` : "発生"}</h3>
      {status === "lifted" ? <p>{TODO_TEXT.liftLifted}</p> : null}
      {status === "undetermined" ? (
        <>
          <p>{TODO_TEXT.liftUndetermined}</p>
          {estimate.extendedByChain ? <p>{TODO_TEXT.liftUndeterminedChain}</p> : null}
        </>
      ) : null}
      {status === "published" || status === "calculated" ? (
        <>
          <dl className="lift-dates">
            <dt>{TODO_TEXT.movement}</dt>
            <dd>{dateLine(estimate.movement, estimate.movementSource)}</dd>
            <dt>{TODO_TEXT.surveillance}</dt>
            <dd>{dateLine(estimate.surveillance, estimate.surveillanceSource)}</dd>
          </dl>
          {estimate.movementSource === "calculated" || estimate.surveillanceSource === "calculated" ? (
            <p>{TODO_TEXT.liftEarliest}</p>
          ) : null}
        </>
      ) : null}
      {estimate.extendedByChain && status !== "lifted" ? <p>{TODO_TEXT.liftChain}</p> : null}
      <p>
        {TODO_TEXT.shipment}: {estimate.shipmentText}
      </p>
      <p>{TODO_TEXT.liftAuthority}</p>
    </article>
  );
}
