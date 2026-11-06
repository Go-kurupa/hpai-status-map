// 相談から足した見直し（会員だけ）。対策の相談の「対策項目に足す」で足したカードを並べる。
// 中身はカードの一覧（/consult/cards.json）から引く。農場に保存してあるのはカードの id と、足した時刻と人だけ。
import { EVIDENCE_LABEL } from "@hpai/shared/consult/types";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../ui/Button";
import { loadConsultCatalog, type ConsultCatalog } from "../consult/cardsData";
import { createReviewStore } from "../consult/reviewStore";
import { TODO_TEXT } from "./texts";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; ids: string[] };

export function ReviewsSection({ farmId }: { farmId: string }) {
  const store = useMemo(() => createReviewStore(async () => farmId), [farmId]);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [catalog, setCatalog] = useState<ConsultCatalog | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);

  useEffect(() => {
    let off = false;
    store.listReviews().then(
      (ids) => !off && setLoad({ status: "ready", ids }),
      () => !off && setLoad({ status: "failed" }),
    );
    loadConsultCatalog().then(
      (c) => !off && setCatalog(c),
      () => undefined, // 読めなければ、対策の名前の代わりにカードの id を出す
    );
    return () => {
      off = true;
    };
  }, [store]);

  async function remove(id: string) {
    setRemoveFailed(false);
    try {
      await store.removeReview(id);
      setLoad((prev) => (prev.status === "ready" ? { status: "ready", ids: prev.ids.filter((x) => x !== id) } : prev));
    } catch {
      setRemoveFailed(true);
    }
  }

  return (
    <section className="todo-reviews" role="region" aria-label={TODO_TEXT.reviewsHeading}>
      <h2>{TODO_TEXT.reviewsHeading}</h2>
      {load.status === "failed" ? <p role="alert">{TODO_TEXT.reviewsLoadFailed}</p> : null}
      {load.status === "ready" && load.ids.length === 0 ? (
        <p>
          {TODO_TEXT.reviewsEmpty} <Link to="/consult">{TODO_TEXT.reviewsLink}</Link>
        </p>
      ) : null}
      {load.status === "ready" && load.ids.length > 0 ? (
        <ul className="todo-items">
          {load.ids.map((id) => {
            const card = catalog?.cards.get(id);
            const source = card ? catalog?.sources.get(card.sourceId) : undefined;
            return (
              <li key={id}>
                {card ? (
                  <>
                    <p>{card.action}</p>
                    <p className="todo-note">
                      {EVIDENCE_LABEL[card.evidence]}
                      {source ? `。資料: ${source.title}（${source.publisher}）` : ""}
                    </p>
                  </>
                ) : (
                  <p className="todo-note">{catalog ? TODO_TEXT.reviewsGone : id}</p>
                )}
                <Button onClick={() => void remove(id)}>{TODO_TEXT.reviewsRemove}</Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {removeFailed ? <p role="alert">{TODO_TEXT.reviewsRemoveFailed}</p> : null}
    </section>
  );
}
