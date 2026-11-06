import type { MuniCode } from "@hpai/shared/types";
import { useEffect, useState } from "react";

/** 1 地区: [名前, 緯度, 経度]（国土交通省「大字・町丁目位置参照情報」の目安の点。scripts/build-oaza.ts が作る） */
export type OazaRow = [name: string, lat: number, lng: number];
type OazaPref = Record<string, OazaRow[]>;

const cache = new Map<string, Promise<OazaPref>>();

/**
 * 県ごとの地区の一覧（data/oaza/{県}.json を copy-web-data が web/public/oaza/ へ置く）。県ごとに 1 度だけ読む。
 * 場所合わせで地図を寄せるためだけに使い、地区の名前も位置も保存・送信しない。
 */
export function fetchOazaPref(prefCode: string): Promise<OazaPref> {
  let p = cache.get(prefCode);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}oaza/${prefCode}.json`).then((res) => {
      if (!res.ok) throw new Error(`地区の一覧を読めませんでした（${res.status}）`);
      return res.json() as Promise<OazaPref>;
    });
    // 失敗は覚えない（次に開いたときにもう一度読む）
    p.catch(() => cache.delete(prefCode));
    cache.set(prefCode, p);
  }
  return p;
}

/** 試験のため */
export function clearOazaCache(): void {
  cache.clear();
}

export type OazaState = { status: "idle" | "loading" | "failed" } | { status: "ready"; rows: readonly OazaRow[] };

/** 町の地区の一覧。町がなければ idle。県のファイルにその町がなければ空の一覧 */
export function useOaza(town: MuniCode | null | undefined, prefCode: string | null | undefined): OazaState {
  const [state, setState] = useState<OazaState>({ status: "idle" });
  useEffect(() => {
    if (!town || !prefCode) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    fetchOazaPref(prefCode).then(
      (pref) => {
        if (alive) setState({ status: "ready", rows: pref[town] ?? [] });
      },
      () => {
        if (alive) setState({ status: "failed" });
      },
    );
    return () => {
      alive = false;
    };
  }, [town, prefCode]);
  return state;
}
