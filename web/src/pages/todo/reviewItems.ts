// 相談から足した見直しの読み出し（会員だけ）。対策項目の画面で 1 度だけ読み、「今日のやること」の行
// （ReviewsSection の ReviewRow）と集計が同じ状態を見る。行で状態を変える・外すと、集計もそのまま変わる。
// 画面の並び（まだ → 後でやる → 済み）は今日のやること（TodayList）が開いたときに 1 度だけ決める。
// ここでの並べ替えは、同じ群の中の順（読み込んだときの順）を決めるだけ。押すたびには並べ替えない。
import { reviewStatusRank } from "@hpai/shared/consult/review";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadConsultCatalog, type ConsultCatalog } from "../consult/cardsData";
import { createReviewStore, type ReviewChange, type ReviewItem, type ReviewStore } from "../consult/reviewStore";

export type ReviewLoad = { status: "loading" } | { status: "failed" } | { status: "ready"; items: ReviewItem[] };

export interface ReviewItems {
  store: ReviewStore;
  load: ReviewLoad;
  /** カードの一覧。読めない間と読めなかったときは null（名前の代わりにカードの id か、数だけを出す） */
  catalog: ConsultCatalog | null;
  /** 保存できた記録を、その行だけに当てる（並びは変えない） */
  applied(id: string, change: ReviewChange): void;
  /** 外せた行を消す */
  removed(id: string): void;
}

/** 読み込んだときの並び。同じ重みは保存の順のまま */
const sortForMorning = (items: ReviewItem[]) =>
  items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => reviewStatusRank(a.it.status) - reviewStatusRank(b.it.status) || a.i - b.i)
    .map((x) => x.it);

/** farmId が null（会員の農場がない・見本の農場）のときは何も読まない */
export function useReviewItems(farmId: string | null): ReviewItems {
  const store = useMemo(() => createReviewStore(async () => farmId), [farmId]);
  const [load, setLoad] = useState<ReviewLoad>({ status: "loading" });
  const [catalog, setCatalog] = useState<ConsultCatalog | null>(null);

  useEffect(() => {
    if (farmId === null) return;
    let off = false;
    setLoad({ status: "loading" });
    store.listReviewItems().then(
      (items) => !off && setLoad({ status: "ready", items: sortForMorning(items) }),
      () => !off && setLoad({ status: "failed" }),
    );
    loadConsultCatalog().then(
      (c) => !off && setCatalog(c),
      () => undefined, // 読み込めなければ、対策の名前の代わりにカードの id を出す（上の確認は数だけ）
    );
    return () => {
      off = true;
    };
  }, [store, farmId]);

  const applied = useCallback(
    (id: string, change: ReviewChange) =>
      setLoad((prev) =>
        prev.status === "ready"
          ? { status: "ready", items: prev.items.map((x) => (x.id === id ? { ...x, ...change, updatedAt: new Date(), mine: true } : x)) }
          : prev,
      ),
    [],
  );
  const removed = useCallback(
    (id: string) => setLoad((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.filter((x) => x.id !== id) } : prev)),
    [],
  );

  return { store, load, catalog, applied, removed };
}
