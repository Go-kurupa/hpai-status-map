// 相談のカードと資料の一覧（/consult/cards.json。build で data/consult/cards.json から写す）。
// 画面に出す引用・資料・根拠の札は、この一覧のデータをそのまま出す。1 度読んだら覚える。失敗したら次の呼び出しでやり直す。
import type { ConsultCard, ConsultCardsFile, ConsultSource } from "@hpai/shared/consult/types";

export interface ConsultCatalog {
  cards: ReadonlyMap<string, ConsultCard>;
  sources: ReadonlyMap<string, ConsultSource>;
}

let pending: Promise<ConsultCatalog> | null = null;

export function loadConsultCatalog(): Promise<ConsultCatalog> {
  if (!pending) {
    pending = fetch("/consult/cards.json")
      .then((res) => {
        if (!res.ok) throw new Error(`カードを読み込めませんでした（${res.status}）`);
        return res.json() as Promise<ConsultCardsFile>;
      })
      .then((file) => ({
        cards: new Map(file.cards.map((c) => [c.id, c] as const)),
        sources: new Map(file.sources.map((s) => [s.id, s] as const)),
      }))
      .catch((e: unknown) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}
