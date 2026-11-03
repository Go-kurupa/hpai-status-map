// 知らせの項目。言葉は固定（項目の message は出さない）。操作は 2 つまで。
// 否定の候補は、確定する前に「訂正のメールが届く」ことを示す（設計書 §10.2、§6）。
import { ALERT_TEXT } from "@hpai/shared/read/review";
import type { ReviewItem } from "@hpai/shared/read/types";
import { useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { prefNameOf } from "./operatorText";
import { useResolver, type ResolveFn } from "./useResolver";

type Alert = Extract<ReviewItem, { kind: "alert" }>;

export function AlertItem({ item, resolve, runAgent }: { item: Alert; resolve: ResolveFn; runAgent: () => Promise<void> }) {
  const r = useResolver(resolve);
  const [agent, setAgent] = useState<"idle" | "busy" | "requested" | "failed">("idle");
  const agentLock = useRef(false);
  const [confirming, setConfirming] = useState(false);

  async function startAgent() {
    if (agentLock.current) return;
    agentLock.current = true;
    setAgent("busy");
    try {
      await runAgent();
      setAgent("requested"); // 成功の後は押せないまま（同じ実行を重ねて頼まない）
    } catch {
      setAgent("failed");
      agentLock.current = false;
    }
  }

  const prefName = prefNameOf(item.prefCode);
  return (
    <article className="op-item">
      <p className="op-kind">知らせ</p>
      <h2>{ALERT_TEXT[item.alert]}</h2>
      {prefName !== null && <p>県: {prefName}</p>}
      {item.caseId !== null && <p>事例: {item.caseId}</p>}
      {item.alert === "negation_candidate" && (
        <p className="op-note">否定を確定すると、この事例の知らせを受け取った会員全員に、訂正のメールが届きます。公式の発表を確かめてから押してください。</p>
      )}
      {item.alert === "mail_failing" && (
        <p className="op-note">この知らせは、メールでは届きません（メールを送れていないため）。この画面で確かめてください。</p>
      )}
      {confirming && (
        <p className="op-note">否定を確定すると取り消せません。この事例の知らせを受け取った会員全員に、訂正のメールが届きます。公式の発表で否定を確かめましたか。</p>
      )}
      {r.error !== null && <p role="alert" className="op-error">{r.error}</p>}
      {agent === "failed" && <p role="alert" className="op-error">実行できませんでした。しばらくしてから、もう一度試してください。</p>}
      {agent === "requested" && <p role="status">実行を依頼しました。結果は、新しい入口の提案としてこの画面に届きます。</p>}
      <div className="op-actions">
        {item.alert === "negation_candidate" ? (
          confirming ? (
            <>
              <Button variant="primary" disabled={r.disabled} onClick={() => void r.run({ itemId: item.id, action: "confirm_negation" })}>
                はい、否定を確定する
              </Button>
              <Button disabled={r.disabled} onClick={() => setConfirming(false)}>
                やめる
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={r.disabled} onClick={() => setConfirming(true)}>
                否定を確定する
              </Button>
              <Button disabled={r.disabled} onClick={() => void r.run({ itemId: item.id, action: "reject_negation" })}>
                退ける
              </Button>
            </>
          )
        ) : (
          <>
            {item.alert === "agent_run_failed" && (
              <Button disabled={agent === "busy" || agent === "requested"} onClick={() => void startAgent()}>
                入口を直すエージェントを実行する
              </Button>
            )}
            <Button variant="primary" disabled={r.disabled} onClick={() => void r.run({ itemId: item.id, action: "dismiss_alert" })}>
              確認した
            </Button>
          </>
        )}
      </div>
      {r.phase === "done" && <p role="status">処理しました（一覧から消えます）</p>}
    </article>
  );
}
