// 自分の町の 1 文に要るデータの組み立て。市町村の一覧（索引）を 1 度だけ読み、1 文と過去の 1 文を計算する。
// 計算が終わっていない間、失敗したとき、今季の事例が届いていないときは、④（全国の動き）にせず「読み込んでいます／読めませんでした」にする。
import { loadWebGeoStore } from "../../geo/loadGeo";
import type { GeoStore } from "@hpai/shared/geo";
import { toJstIso } from "@hpai/shared/dates";
import { describePast } from "@hpai/shared/past";
import type { Case, FarmPoint, HistoryCase, MuniCode, PrefCode, Season, WildBird } from "@hpai/shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PastState } from "./TownBanner";
import { resolveTown, withWatchState, type TownLine } from "./townLine";

export function useGeoStore(): { geo: GeoStore | null; failed: boolean } {
  const [state, setState] = useState<{ geo: GeoStore | null; failed: boolean }>({ geo: null, failed: false });
  useEffect(() => {
    let off = false;
    loadWebGeoStore().then(
      (geo) => {
        if (!off) setState({ geo, failed: false });
      },
      () => {
        if (!off) setState({ geo: null, failed: true });
      },
    );
    return () => {
      off = true;
    };
  }, []);
  return state;
}

interface Resolved {
  key: string;
  line: TownLine | null;
  near: MuniCode[];
}

export interface TownViewInput {
  spot: FarmPoint | null;
  town: MuniCode | null;
  /** 今季の事例（選んだシーズンではない）。null は読めていない */
  cases: Case[] | null;
  birds: WildBird[];
  season: Season;
  geo: GeoStore | null;
  now: Date;
  /** 見回りで確認できていない県（結果が届く前は 47 県すべて）。自分の町の県がここにあれば、1 文にそれを加える */
  unwatchedPrefCodes?: readonly PrefCode[];
}

/** 1 文。入力（地点、町）が変わった直後は古い結果を出さず、読み込み中にする */
export function useTownLine(i: TownViewInput): { line: TownLine | null; failed: boolean; nearMuniCodes: MuniCode[] } {
  const [res, setRes] = useState<Resolved | null>(null);
  const key = JSON.stringify([i.spot, i.town]);
  const { spot, town, cases, birds, season, geo } = i;
  const nowRef = useRef(i.now);
  nowRef.current = i.now;

  useEffect(() => {
    if (!geo || cases === null) return;
    let off = false;
    resolveTown({ spot, town, cases, birds, season, geo, asOf: toJstIso(nowRef.current) }).then(
      (r) => {
        if (!off) setRes({ key, line: r.line, near: r.nearMuniCodes });
      },
      () => {
        if (!off) setRes({ key, line: null, near: [] });
      },
    );
    return () => {
      off = true;
    };
  }, [key, spot, town, cases, birds, season, geo]);

  const fresh = res !== null && res.key === key ? res : null;
  const townCode = spot?.muniCode ?? town;
  const townPref = townCode === null ? null : (geo?.index[townCode]?.prefCode ?? townCode.slice(0, 2));
  const unwatched = i.unwatchedPrefCodes;
  const freshLine = fresh?.line ?? null;
  const line = useMemo(
    () => (freshLine !== null && unwatched !== undefined ? withWatchState(freshLine, townPref, unwatched) : freshLine),
    [freshLine, townPref, unwatched],
  );
  return { line, failed: fresh !== null && fresh.line === null, nearMuniCodes: fresh?.near ?? [] };
}

/** 過去の 1 文。読めていない間は読み込み中、読めなかったら失敗（「発生はありません」にしない） */
export function usePast(i: {
  town: MuniCode | null;
  history: HistoryCase[] | null;
  historyFailed: boolean;
  geo: GeoStore | null;
  geoFailed: boolean;
  current: Season;
}): PastState {
  const { town, history, historyFailed, geo, geoFailed, current } = i;
  return useMemo<PastState>(() => {
    if (town === null) return { status: "idle" };
    if (historyFailed || geoFailed) return { status: "failed" };
    if (history === null || geo === null) return { status: "loading" };
    // 索引にない町は隣がなく、過去の行が「発生はありません」に倒れる。「ない」と読ませず、読めなかった扱いにする
    if (!geo.index[town]) return { status: "failed" };
    try {
      return { status: "ready", summary: describePast(town, history, geo, current) };
    } catch {
      return { status: "failed" }; // 壊れた記録でページを落とさない。「発生なし」にも見せない
    }
  }, [town, history, historyFailed, geo, geoFailed, current]);
}
