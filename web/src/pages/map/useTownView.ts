// 自分の町の 1 文に要るデータの組み立て。市町村の一覧（索引）を 1 度だけ読み、1 文と過去の 1 文を計算する。
// 計算が終わっていない間、失敗したとき、今季の事例が届いていないときは、④（全国の動き）にせず「読み込んでいます／読めませんでした」にする。
import { loadWebGeoStore } from "../../geo/loadGeo";
import type { GeoStore } from "@hpai/shared/geo";
import { toJstIso } from "@hpai/shared/dates";
import { pastCasesOf } from "@hpai/shared/history";
import { isCountable } from "@hpai/shared/level";
import { countSmallFlocks, describePast, type NearbyPastSummary } from "@hpai/shared/past";
import type { Case, FarmPoint, HistoryCase, MeshCode, MuniCode, PrefCode, Season, WildBird } from "@hpai/shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NearbyPastState } from "./NearbyPast";
import { casesWithinBand, nearbyPastByCenter, nearbyPastFromMesh, pastSeasonsOf } from "./overviewCounts";
import type { PastState } from "./TownBanner";
import { neighborPrefsOf, resolveTown, withWatchState, type TownLine } from "./townLine";

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
  /** 見回りで確認できていない県（結果が届く前は 47 県すべて）。自分の町の県と隣の県がここにあれば、1 文にそれを加える */
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
  // 区域は県をまたぐので、隣の市町村がある県の未確認も伝える
  const neighborPrefs = useMemo(() => (geo && townCode !== null ? neighborPrefsOf(townCode, geo) : []), [geo, townCode]);
  const line = useMemo(
    () => (freshLine !== null && unwatched !== undefined ? withWatchState(freshLine, townPref, unwatched, neighborPrefs) : freshLine),
    [freshLine, townPref, unwatched, neighborPrefs],
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

/** null は読み込み中、"failed" は読めなかった。どちらも 0 件にしない */
export type BandCount = number | null | "failed";

function useBandCount(meshCode: MeshCode | null, cases: readonly Case[] | null, geo: GeoStore | null): BandCount {
  const [res, setRes] = useState<{ meshCode: MeshCode; value: BandCount } | null>(null);
  useEffect(() => {
    if (meshCode === null || cases === null || !geo) return;
    let off = false;
    casesWithinBand(meshCode, cases, geo).then(
      (n) => {
        if (!off) setRes({ meshCode, value: n });
      },
      () => {
        if (!off) setRes({ meshCode, value: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [meshCode, cases, geo]);
  // 地点が変わった直後は古い結果を出さない。事例の更新の間は前の値のまま（ちらつかせない）
  return cases !== null && res?.meshCode === meshCode ? res.value : null;
}

/** 約 60km 以内の今季と過去のシーズンの件数。関連農場は除く。地点がなければ計算しない（県の形を読まない） */
export function useBandCounts(i: {
  meshCode: MeshCode | null;
  cases: readonly Case[] | null;
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  geo: GeoStore | null;
  geoFailed: boolean;
  current: Season;
}): { now: BandCount; past: BandCount } {
  const { cases, history, current } = i;
  const nowCases = useMemo(() => (cases ? cases.filter((c) => c.season === current && isCountable(c)) : null), [cases, current]);
  const pastCases = useMemo(() => {
    if (!history) return null;
    const seasons = new Set(pastSeasonsOf(history, current));
    return pastCasesOf(history).filter((c) => seasons.has(c.season));
  }, [history, current]);
  const now = useBandCount(i.meshCode, nowCases, i.geo);
  const past = useBandCount(i.meshCode, pastCases, i.geo);
  return { now: i.geoFailed ? "failed" : now, past: i.geoFailed || (history === null && i.historyFailed) ? "failed" : past };
}

/**
 * 周辺の町の過去の発生。地点があればマス目から町の面まで（約 60km の札と同じ）、町だけなら町の中心どうし。
 * 読めていない間は読み込み中、読めなかったら失敗（0 件にしない）。町だけのときは県の形を読まない。
 */
export function useNearbyPast(i: {
  town: MuniCode | null;
  meshCode: MeshCode | null;
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  geo: GeoStore | null;
  geoFailed: boolean;
  current: Season;
}): NearbyPastState {
  const { town, meshCode, history, historyFailed, geo, geoFailed, current } = i;
  const [fromMesh, setFromMesh] = useState<{ meshCode: MeshCode; summary: NearbyPastSummary | null } | null>(null);
  useEffect(() => {
    if (town === null || meshCode === null || history === null || !geo) return;
    let off = false;
    nearbyPastFromMesh(meshCode, history, geo, current).then(
      (summary) => {
        if (!off) setFromMesh({ meshCode, summary });
      },
      () => {
        if (!off) setFromMesh({ meshCode, summary: null });
      },
    );
    return () => {
      off = true;
    };
  }, [town, meshCode, history, geo, current]);
  return useMemo<NearbyPastState>(() => {
    if (town === null) return { status: "idle" };
    if (historyFailed || geoFailed) return { status: "failed" };
    if (history === null || geo === null) return { status: "loading" };
    let summary: NearbyPastSummary | null;
    if (meshCode !== null) {
      if (fromMesh === null || fromMesh.meshCode !== meshCode) return { status: "loading" }; // 地点が変わった直後は古い結果を出さない
      summary = fromMesh.summary;
    } else {
      try {
        summary = nearbyPastByCenter(town, history, geo, current);
      } catch {
        summary = null;
      }
    }
    if (summary === null) return { status: "failed" };
    return {
      status: "ready",
      basis: meshCode !== null ? "mesh" : "center",
      summary,
      smallFlocks: countSmallFlocks(history, pastSeasonsOf(history, current)),
      current,
    };
  }, [town, meshCode, history, historyFailed, geo, geoFailed, current, fromMesh]);
}
