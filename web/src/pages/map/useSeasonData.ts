// 地図の画面が使うデータ。DataSource（購読）と過去の記録を読み、選んだシーズンの SeasonView にする。
// 「まだ読めていない」を 0 件にしない（null のまま持つ）。見回りの結果が届く前は、47 県すべて確認できていない扱い。
import { currentSeason } from "@hpai/shared/season";
import { summarizeWatch } from "@hpai/shared/level";
import type { Case, HistoryCase, IsoDateTime, PrefCode, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataSource } from "../../data/context";
import { buildSeasonView, listSeasonBars, type SeasonView } from "./seasonView";

const MINUTE_MS = 60_000;

export interface SeasonData {
  current: Season;
  selected: Season;
  select(season: Season): void;
  view: SeasonView;
  bars: Array<{ season: Season; label: string; count: number | null }>;
  /** 今季の野鳥。過去のシーズンを選んでも同じ配列を返す（層の filter で隠す。source を替えない） */
  wildBirds: WildBird[];
  /** 見回りで確認できていない県（結果が届く前は 47 県すべて） */
  failedPrefCodes: PrefCode[];
  /** 見回りの結果を受け取れている */
  watchLoaded: boolean;
  /** 直近の確認の時刻。確認できた県がなければ null */
  asOf: IsoDateTime | null;
  historyFailed: boolean;
  retryHistory(): void;
}

export function useSeasonData(): SeasonData {
  const ds = useDataSource();
  const [minute, setMinute] = useState(0);
  const now = ds.now();
  const current = currentSeason(now);

  const [cases, setCases] = useState<Case[] | null>(null);
  const [birds, setBirds] = useState<WildBird[]>([]);
  const [watch, setWatch] = useState<WatchStatus[] | null>(null);
  const [history, setHistory] = useState<HistoryCase[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyTry, setHistoryTry] = useState(0);
  const [picked, setPicked] = useState<Season | null>(null);

  useEffect(() => {
    const id = setInterval(() => setMinute((m) => m + 1), MINUTE_MS); // 「6 時間以内の確認」の判定を進める
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCases(null);
    return ds.subscribeCases(current, setCases);
  }, [ds, current]);

  useEffect(() => {
    setBirds([]);
    return ds.subscribeWildBirds(current, setBirds);
  }, [ds, current]);

  useEffect(() => ds.subscribeWatchStatus(setWatch), [ds]);

  useEffect(() => {
    let off = false;
    setHistoryFailed(false);
    ds.loadHistory().then(
      (rows) => {
        if (!off) setHistory(rows);
      },
      () => {
        if (!off) setHistoryFailed(true);
      },
    );
    return () => {
      off = true;
    };
  }, [ds, historyTry]);

  const retryHistory = useCallback(() => setHistoryTry((n) => n + 1), []);
  const selected = picked ?? current;

  const view = useMemo(
    () => buildSeasonView({ season: selected, current, currentCases: cases, history }),
    [selected, current, cases, history],
  );
  const bars = useMemo(() => listSeasonBars({ current, currentCases: cases, history }), [current, cases, history]);

  // minute は再計算の合図（now が変わるので、依存に入れる）
  const summary = useMemo(() => summarizeWatch(watch ?? [], now), [watch, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const asOf = useMemo(() => {
    const times = (watch ?? [])
      .filter((w) => w.ok && w.checkedAt !== null)
      .map((w) => w.checkedAt as string)
      .filter((t) => !Number.isNaN(Date.parse(t)));
    return times.length === 0 ? null : times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
  }, [watch]);

  return {
    current,
    selected,
    select: setPicked,
    view,
    bars,
    wildBirds: birds,
    failedPrefCodes: summary.failedPrefCodes,
    watchLoaded: watch !== null,
    asOf,
    historyFailed,
    retryHistory,
  };
}
