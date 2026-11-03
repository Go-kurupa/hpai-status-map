// やること画面に要るデータ。今季の事例と見回りの結果を購読し、地点があれば段階と解除の見込みを計算する。
// 「まだ読めていない」「読めなかった」「地点がない」を④（何もない）にしない。W-03 の useTownLine と同じ作り。
import type { GeoStore } from "@hpai/shared/geo";
import { summarizeWatch } from "@hpai/shared/level";
import { currentSeason } from "@hpai/shared/season";
import type { Case, FarmPoint, IsoDateTime, Level, WatchStatus } from "@hpai/shared/types";
import { useEffect, useMemo, useState } from "react";
import { useDataSource } from "../../data/context";
import { useSpot } from "../../data/spotContext";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { resolveTodo, type TodoResult } from "./todoModel";

export type TodoState =
  | { status: "loading" }
  | { status: "failed" }
  /** 地点がない。町を選ぶ案内を出し、ふだんの項目だけを出す */
  | { status: "no_spot" }
  | { status: "ready"; result: TodoResult };

export interface TodoData {
  state: TodoState;
  spot: FarmPoint | null;
  /** 直近の確認の時刻。確認できた県がなければ null */
  asOf: IsoDateTime | null;
  /** 地点の県の発表を確認できていない（見回りの結果がまだ、またはその県が確認できていない） */
  prefUnconfirmed: boolean;
}

/** ready のときの段階。ready でなければ、ふだんの段階 4（always の項目だけ）として扱う */
export function levelOf(state: TodoState): Level {
  return state.status === "ready" ? state.result.level.level : 4;
}

function useGeo(): { geo: GeoStore | null; failed: boolean } {
  const [s, setS] = useState<{ geo: GeoStore | null; failed: boolean }>({ geo: null, failed: false });
  useEffect(() => {
    let off = false;
    loadWebGeoStore().then(
      (geo) => {
        if (!off) setS({ geo, failed: false });
      },
      () => {
        if (!off) setS({ geo: null, failed: true });
      },
    );
    return () => {
      off = true;
    };
  }, []);
  return s;
}

export function useTodoData(): TodoData {
  const ds = useDataSource();
  const spot = useSpot();
  const now = ds.now();
  const season = currentSeason(now);
  const [cases, setCases] = useState<Case[] | null>(null);
  const [watch, setWatch] = useState<WatchStatus[] | null>(null);
  const { geo, failed: geoFailed } = useGeo();
  const [res, setRes] = useState<{ input: string; value: TodoResult | null } | null>(null);
  const input = JSON.stringify([spot, season]);

  useEffect(() => {
    setCases(null);
    return ds.subscribeCases(season, setCases);
  }, [ds, season]);
  useEffect(() => ds.subscribeWatchStatus(setWatch), [ds]);

  useEffect(() => {
    if (!spot || !geo || cases === null) return;
    let off = false;
    resolveTodo({ spot, cases, season, geo }).then(
      (value) => {
        if (!off) setRes({ input, value });
      },
      () => {
        if (!off) setRes({ input, value: null });
      },
    );
    return () => {
      off = true;
    };
  }, [input, spot, cases, geo, season]);

  const asOf = useMemo(() => {
    const times = (watch ?? [])
      .filter((w) => w.ok && w.checkedAt !== null)
      .map((w) => w.checkedAt as string)
      .filter((t) => !Number.isNaN(Date.parse(t)));
    return times.length === 0 ? null : times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
  }, [watch]);

  const prefUnconfirmed = useMemo(
    () => spot !== null && summarizeWatch(watch ?? [], now).failedPrefCodes.includes(spot.muniCode.slice(0, 2)),
    [spot, watch, now],
  );

  let state: TodoState;
  if (!spot) state = { status: "no_spot" };
  else if (geoFailed) state = { status: "failed" };
  else if (cases === null || geo === null) state = { status: "loading" };
  else if (res === null || res.input !== input) state = { status: "loading" }; // 入力が変わった直後は古い結果を出さない
  else state = res.value === null ? { status: "failed" } : { status: "ready", result: res.value };

  return { state, spot, asOf, prefUnconfirmed };
}
