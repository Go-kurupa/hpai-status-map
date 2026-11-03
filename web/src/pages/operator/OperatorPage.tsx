// 運営者の画面 /operator（I-07）。確かめられなかった読み取り、入口の提案、見回りの警告を、運営者が 1 件ずつ決める。
// 「AI は下書き、人が確かめて確定する」の人の側。operator の claim がなければ一覧を出さない（サーバーも claim を確かめる）。
import type { MuniEntry } from "@hpai/shared/geo";
import type { ResolveRequest, ResolveResponse, ReviewDetail } from "@hpai/shared/read/review";
import type { MuniCode } from "@hpai/shared/types";
import { Link, useLocation } from "react-router";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { AsOf } from "../../ui/AsOf";
import { keptSearch } from "../auth/emailLink";
import { AlertItem } from "./AlertItem";
import { DocumentItem } from "./DocumentItem";
import { getDetailCall, resolveCall, runAgentCall } from "./operatorCalls";
import { ProposalItem } from "./ProposalItem";
import { useReviewQueue, type ReviewQueueState } from "./useReviewQueue";
import "./operator.css";

export interface OperatorProps {
  /** 試験用: 箱の状態を渡す（渡さなければ Firestore を購読する） */
  queue?: ReviewQueueState;
  resolve?: (req: ResolveRequest) => Promise<ResolveResponse>;
  getDetail?: (itemId: string) => Promise<ReviewDetail>;
  runAgent?: () => Promise<void>;
  loadMunis?: () => Promise<Readonly<Record<MuniCode, MuniEntry>>>;
  now?: () => Date;
}

const loadMuniIndex = async () => (await loadWebGeoStore()).index;
const systemNow = () => new Date();

function View({ queue, resolve = resolveCall, getDetail = getDetailCall, runAgent = runAgentCall, loadMunis = loadMuniIndex, now = systemNow }: OperatorProps & { queue: ReviewQueueState }) {
  const location = useLocation();

  if (queue.status === "loading") return <p role="status">確かめています</p>;
  if (queue.status === "error") {
    return <p role="alert">読み込めませんでした。通信を確かめて、ページを開き直してください。</p>;
  }
  if (queue.status === "no-claim" || queue.status === "signed-out") {
    return (
      <section className="op-page">
        <h1>運営者の確認</h1>
        <p>運営者だけが使えます。</p>
        {queue.status === "signed-out" && (
          <p>
            <Link to={{ pathname: "/login", search: keptSearch(location.search) }}>ログインする</Link>
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="op-page">
      <h1>運営者の確認</h1>
      <AsOf iso={queue.asOf} />
      {queue.items.length === 0 ? (
        <p>いま確認する項目はありません。</p>
      ) : (
        <>
          <p>確認する項目が {queue.items.length} 件あります。</p>
          {queue.items.map((item) => {
            switch (item.kind) {
              case "document":
                return <DocumentItem key={item.id} item={item} resolve={resolve} getDetail={getDetail} loadMunis={loadMunis} now={now} />;
              case "entrance_proposal":
                return <ProposalItem key={item.id} item={item} resolve={resolve} />;
              case "alert":
                return <AlertItem key={item.id} item={item} resolve={resolve} runAgent={runAgent} />;
            }
          })}
        </>
      )}
    </section>
  );
}

function Live(props: OperatorProps) {
  return <View {...props} queue={useReviewQueue()} />;
}

export default function OperatorPage(props: OperatorProps = {}) {
  return props.queue !== undefined ? <View {...props} queue={props.queue} /> : <Live {...props} />;
}
