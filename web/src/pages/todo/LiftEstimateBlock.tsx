// 解除の見込み 1 件分（段階① だけに出す）。防疫指針の決まりから数えた「見込み」で、解除は県が決める。
// 県の連絡が正であることを必ず添える。日付は「見込み」と書き、断定しない。
import { formatJaDate } from "@hpai/shared/jaDate";
import type { LiftEstimate } from "@hpai/shared/lift";
import { TODO_TEXT } from "./texts";

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
          <p>{status === "published" ? TODO_TEXT.liftPublished : TODO_TEXT.liftCalculated}</p>
          <dl className="lift-dates">
            <dt>{TODO_TEXT.movement}</dt>
            <dd>{estimate.movement ? `${formatJaDate(estimate.movement)}${status === "published" ? "" : "ごろ"}` : "未定"}</dd>
            <dt>{TODO_TEXT.surveillance}</dt>
            <dd>{estimate.surveillance ? `${formatJaDate(estimate.surveillance)}ごろ` : "未定"}</dd>
          </dl>
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
