// 相談の条件に付ける「近くの発生の状況」と町の名前（2026-11-08 豪さんの決定）。新しい判定は作らず、画面がすでに持つ計算をそのまま使う。
// - 区域に入っている可能性: 対策項目の今日のやること（todoModel.ts の resolveTodo）の段階が ① なら possible、それ以外は none。
// - 約 60 km 以内の今季の件数: 地図の「約 60 km 以内」（overviewCounts.ts の casesWithinBand。今季で数える事例だけ）と同じ数え方。
// 地点は登録した農場のマス目（端末の中の地点ではない）。読み込み中・読めない・計算できない・農場の県の発表を確認できていないときは送らない
// （「確認できていません」として扱い、0 件と言わない）。
import { townNameOf } from "@hpai/shared/consult/farmCondition";
import type { ConsultNearby } from "@hpai/shared/consult/types";
import type { GeoStore } from "@hpai/shared/geo";
import { isCountable, summarizeWatch } from "@hpai/shared/level";
import { currentSeason } from "@hpai/shared/season";
import type { Case, FarmPoint, Season, WatchStatus } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { useDataSource } from "../../data/context";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { casesWithinBand } from "../map/overviewCounts";
import { resolveTodo } from "../todo/todoModel";

/** 対策項目と地図と同じ計算で、近くの発生の状況を作る。県の形を読めないなどのときは投げる（呼び手が送らないことにする） */
export async function nearbyOfFarm(i: { point: FarmPoint; cases: readonly Case[]; season: Season; geo: GeoStore }): Promise<ConsultNearby> {
  const todo = await resolveTodo({ spot: i.point, cases: i.cases, season: i.season, geo: i.geo });
  const now = i.cases.filter((c) => c.season === i.season && isCountable(c));
  const count = await casesWithinBand(i.point.meshCode, now, i.geo);
  return { casesWithin60km: count, zone: todo.level.level === 1 ? "possible" : "none" };
}

/** loading: まだ決まっていない。unavailable: 送らない（読めない・確認できていない）。ready: 送る */
export type NearbyState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; nearby: ConsultNearby };

export interface FarmPlace {
  nearby: NearbyState;
  /** 町の名前（「岡山県西粟倉村」）。地理の索引がまだか、読めないか、索引にないときは null（表示だけに使う。送るのはコード） */
  townName: string | null;
}

/** 登録した農場の地点（null なら何も読まない）から、近くの発生の状況と町の名前を作る */
export function useFarmPlace(point: FarmPoint | null): FarmPlace {
  const ds = useDataSource();
  const now = ds.now();
  const season = currentSeason(now);
  const [geo, setGeo] = useState<GeoStore | "failed" | null>(null);
  const [cases, setCases] = useState<Case[] | null>(null);
  const [watch, setWatch] = useState<WatchStatus[] | null>(null);
  const [result, setResult] = useState<{ key: string; value: ConsultNearby | null } | null>(null);
  const active = point !== null;
  const key = JSON.stringify([point, season]);

  useEffect(() => {
    if (!active) return;
    let off = false;
    loadWebGeoStore().then(
      (g) => !off && setGeo(g),
      () => !off && setGeo("failed"),
    );
    return () => {
      off = true;
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    setCases(null);
    return ds.subscribeCases(season, setCases);
  }, [ds, season, active]);
  useEffect(() => (active ? ds.subscribeWatchStatus(setWatch) : undefined), [ds, active]);

  useEffect(() => {
    if (point === null || geo === null || geo === "failed" || cases === null) return;
    let off = false;
    nearbyOfFarm({ point, cases, season, geo }).then(
      (value) => !off && setResult({ key, value }),
      () => !off && setResult({ key, value: null }),
    );
    return () => {
      off = true;
    };
  }, [key, point, season, geo, cases]);

  const townName = point !== null && geo !== null && geo !== "failed" ? townNameOf(geo.index, point.muniCode) : null;
  let nearby: NearbyState;
  if (point === null || geo === "failed") nearby = { status: "unavailable" };
  else if (geo === null || cases === null || watch === null || result === null || result.key !== key) nearby = { status: "loading" };
  // 農場の県の発表を確認できていないときは、区域の判定と件数を送らない（対策項目の「確認できていません」と同じ県の見方）
  else if (result.value === null || summarizeWatch(watch, now).failedPrefCodes.includes(point.muniCode.slice(0, 2))) nearby = { status: "unavailable" };
  else nearby = { status: "ready", nearby: result.value };
  return { nearby, townName };
}
