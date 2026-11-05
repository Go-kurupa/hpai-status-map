// 入口の提案の項目。承認すると見回りの入口に足し、古い入口を止める。退けても何も変えない（設計書 §13）。
// URL と根拠は外から来た文字（エージェントの出力）。文字のまま出す。
import type { ReviewItem } from "@hpai/shared/read/types";
import { Button } from "../../ui/Button";
import { prefNameOf, safeHref } from "./operatorText";
import { useResolver, type ResolveFn } from "./useResolver";

type Proposal = Extract<ReviewItem, { kind: "entrance_proposal" }>;

function UrlLine({ label, url }: { label: string; url: string | null }) {
  if (url === null) return <p>{label}: <span>なし</span></p>;
  const href = safeHref(url);
  return (
    <p>
      {label}: <span className="op-url">{url}</span>
      {href !== null && (
        <>
          {" "}
          <a className="tap-link" href={href} target="_blank" rel="noopener noreferrer">開く</a>
        </>
      )}
    </p>
  );
}

export function ProposalItem({ item, resolve }: { item: Proposal; resolve: ResolveFn }) {
  const r = useResolver(resolve);
  return (
    <article className="op-item">
      <p className="op-kind">入口の提案</p>
      <h2>{prefNameOf(item.prefCode) ?? "県が分かりません"}の入口</h2>
      <UrlLine label="古い入口" url={item.oldUrl} />
      <UrlLine label="新しい入口" url={item.proposedUrl} />
      <p className="op-label">根拠</p>
      <p>{item.rationale}</p>
      <p className="op-note">承認すると、新しい入口を見回りに足し、古い入口を止めます。退けると何も変えません。</p>
      {r.error !== null && <p role="alert" className="op-error">{r.error}</p>}
      <div className="op-actions">
        <Button variant="primary" disabled={r.disabled} onClick={() => void r.run({ itemId: item.id, action: "approve_entrance" })}>
          承認
        </Button>
        <Button disabled={r.disabled} onClick={() => void r.run({ itemId: item.id, action: "reject_entrance" })}>
          退ける
        </Button>
      </div>
      {r.phase === "done" && <p role="status">処理しました（一覧から消えます）</p>}
    </article>
  );
}
