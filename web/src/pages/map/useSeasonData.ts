// 地図の画面が使うデータ。DataSource（購読）と過去の記録を読み、選んだシーズンの SeasonView にする。
// 「まだ読めていない」を 0 件にしない（null のまま持つ）。見回りの結果が届く前は、47 県すべて確認できていない扱い。
import { currentSeason } from "@hpai/shared/season";
import type { Case, HistoryCase, IsoDateTime, PrefCode, Season, WatchStatus, WildBird } from "@hpai/shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataSource } from "../../data/context";
import { buildSeasonView, listSeasonBars, type SeasonView } from "./seasonView";
import { watchLine, type WatchLineResult } from "./watchLineText";

const MINUTE_MS = 60_000;
/** 今季の事例がこれだけたっても読めなければ、読み込み直しの案内を出す（データの口の型は変えない） */
export const CASES_SLOW_MS = 15_000;

export interface SeasonData {
  current: Season;
  selected: Season;
  select(season: Season): void;
  view: SeasonView;
  bars: Array<{ season: Season; label: string; count: number | null }>;
  /** 今季の事例そのもの（読めていなければ null）。選んだシーズンに関わらず今季。自分の町の 1 文はこれで計算する */
  currentCases: Case[] | null;
  /** 過去の記録（読めていなければ null） */
  history: HistoryCase[] | null;
  /** 今季の野鳥。過去のシーズンを選んでも同じ配列を返す（層の filter で隠す。source を替えない） */
  wildBirds: WildBird[];
  /** 今季の野鳥を受け取れている。読めていない間の空の配列を 0 件にしない */
  wildBirdsLoaded: boolean;
  /** 一覧の元になる事例。今季は届いたもの全部（確認中と否定の直後も一覧には出す）、過去は数えた事例。読めていなければ null */
  listCases: Case[] | null;
  /** 確認状況の 1 行（結果が届く前は 47 県すべて確認できていない扱い） */
  watch: WatchLineResult;
  /** 確認できていない県（ホームページを読み込めていない。結果が届く前は 47 県すべて） */
  failedPrefCodes: PrefCode[];
  /** 確認できていない県の、1 回目に読めなかった時刻（記録のある県だけ） */
  watchSince: Partial<Record<PrefCode, IsoDateTime>>;
  /** 確認の結果を受け取れている */
  watchLoaded: boolean;
  /** 直近の確認の時刻。確認できた県がなければ null */
  asOf: IsoDateTime | null;
  /** 今季の事例が 15 秒たっても読めていない */
  casesSlow: boolean;
  historyFailed: boolean;
  retryHistory(): void;
}

export function useSeasonData(): SeasonData {
  const ds = useDataSource();
  const [minute, setMinute] = useState(0);
  const now = ds.now();
  const current = currentSeason(now);

  const [cases, setCases] = useState<Case[] | null>(null);
  const [casesSlow, setCasesSlow] = useState(false);
  const [birds, setBirds] = useState<WildBird[]>([]);
  const [birdsLoaded, setBirdsLoaded] = useState(false);
  const [watch, setWatch] = useState<WatchStatus[] | null>(null);
  const [history, setHistory] = useState<HistoryCase[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyTry, setHistoryTry] = useState(0);
  const [picked, setPicked] = useState<Season | null>(null);

  useEffect(() => {
    const id = setInterval(() => setMinute((m) => m + 1), MINUTE_MS); // 「7 時間以内の確認」の判定を進める
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCases(null);
    return ds.subscribeCases(current, setCases);
  }, [ds, current]);

  useEffect(() => {
    setCasesSlow(false);
    if (cases !== null) return;
    const id = setTimeout(() => setCasesSlow(true), CASES_SLOW_MS);
    return () => clearTimeout(id);
  }, [ds, current, cases === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBirds([]);
    setBirdsLoaded(false);
    return ds.subscribeWildBirds(current, (rows) => {
      setBirds(rows);
      setBirdsLoaded(true);
    });
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
  const line = useMemo(() => watchLine(watch ?? [], now), [watch, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const watchSince = useMemo(() => {
    const out: Partial<Record<PrefCode, IsoDateTime>> = {};
    for (const w of watch ?? []) if (w.failingSince && line.failedPrefCodes.includes(w.prefCode)) out[w.prefCode] = w.failingSince;
    return out;
  }, [watch, line]);
  const listCases = useMemo<Case[] | null>(() => {
    if (!view.loaded) return null;
    return view.isCurrent ? (cases ?? []).filter((c) => c.season === view.season) : [...view.cases];
  }, [view, cases]);

  return {
    current,
    selected,
    select: setPicked,
    view,
    bars,
    currentCases: cases,
    history,
    wildBirds: birds,
    wildBirdsLoaded: birdsLoaded,
    listCases,
    watch: line,
    failedPrefCodes: line.failedPrefCodes,
    watchSince,
    watchLoaded: watch !== null,
    asOf: line.asOf,
    casesSlow,
    historyFailed,
    retryHistory,
  };
}
