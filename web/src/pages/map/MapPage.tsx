import { jstDateOf } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { DISTANCE_BAND_KM, isCountable } from "@hpai/shared/level";
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { MuniCode } from "@hpai/shared/types";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { MAP_ATTRIBUTION } from "../../geo/attribution";
import { useDataSource } from "../../data/context";
import { useFormatAsOf } from "../../ui/AsOf";
import { useSpotState } from "../../data/spotContext";
import type { MapViewProps } from "./MapView";
import { CaseListSheet } from "./CaseListSheet";
import { Legend } from "./Legend";
import { listRows, wildBirdRows } from "./listRows";
import { MapChunkBoundary } from "./MapChunkBoundary";
import { MapLinks, NextLinks } from "./MapLinks";
import { MonthBars } from "./MonthBars";
import { countRecentDays, frequentTownCounts, PAST_SEASONS, pastRangeToDate, rangeText, wildBirdCounts } from "./overviewCounts";
import type { PickTarget } from "./pickSpot";
import { countText, SeasonBar, type SeasonBarItem } from "./SeasonBar";
import { SeasonCharts } from "./SeasonCharts";
import { SeasonCompare } from "./SeasonCompare";
import { SpotPicker } from "./SpotPicker";
import { TEXT } from "./texts";
import { TownBanner } from "./TownBanner";
import { TownPicker } from "./TownPicker";
import { monthDay } from "./townLine";
import { useNarrow } from "./useNarrow";
import { useBandCounts, useGeoStore, useNearbyPast, usePast, useTownLine, type BandCount } from "./useTownView";
import { WatchAsOf, WatchLine } from "./WatchLine";
import { useSeasonData } from "./useSeasonData";
import "./map.css";

// 地図（maplibre）は重いので、画面を開いてから別の chunk で読む
const MapView = lazy(() => import("./MapView"));

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const names = (codes: readonly string[]) => codes.map((c) => PREF_NAME.get(c) ?? c).join("、");

/**
 * 札の値。「N 件」の数字だけを太く大きくできる形にする。文（未確認、読めないなど）は文の大きさのまま。
 * 一部未確認は「8 件」と断りに分ける。PC は断りを小さい字で数字の前後に残す（map.css の .stat-qual）。
 * スマホは未確認の断りを各数字に繰り返さず、数字の前の 1 文（stat-unchecked）にまとめる。隠す語は .stat-long（スマホで非表示）
 */
function StatCount({ text, lead }: { text: string; lead?: string }) {
  const count = /^(\d+(?:〜\d+)?) 件$/.exec(text);
  const partial = /^(確認できた範囲では )(\d+)( 件)(（.+）)$/.exec(text);
  return (
    <p className={count ? "stat-value" : "stat-value is-sentence"}>
      {lead ? <span className="stat-long">{lead} </span> : null}
      {count ? (
        <>
          <b>{count[1]}</b> 件
        </>
      ) : partial ? (
        <>
          <span className="stat-long stat-qual">{partial[1]}</span>
          <span className="stat-num">{partial[2]}</span>
          {partial[3]}
          <span className="stat-long stat-qual">{partial[4]}</span>
        </>
      ) : (
        text
      )}
    </p>
  );
}

// 守る文を、文と出典に分ける。文の正は FIXED_TEXT のまま
const RISK_PARTS = /^(.*)（出典: (.*) (https:\S+)）$/.exec(FIXED_TEXT.riskAnywhere)!;
const [, RISK_SENTENCE, RISK_SOURCE, RISK_URL] = RISK_PARTS;

/**
 * 入口の画面。DOM の順はスマホで見る順で、上から 確認の行、守る文、数字の札、切り替え、地図、断り、一覧、残りの札、棒。
 * 塗りがないことを「何もない」と読ませない。64rem 以上の 2 列は map.css の order で組む。
 * replayStats は再現の全国の流れだけが渡す。件数の札を再現の時計で出す（野鳥の札は、再現が野鳥を持たないので出さない）。
 */
/**
 * 見せるまとまり（設計書 2026-11-06-ui-frame 4 章）。now は「今季の発生と地図」（/）、town は「自分の町の過去」、
 * season は「今季の一覧と数」、compare は「過去シーズンとの比べ」。all は再現と見本の中（今の並びのまま全部）。
 */
export type MapSection = "now" | "town" | "season" | "compare" | "all";

const SECTION_TITLE: Record<Exclude<MapSection, "now" | "all">, string> = {
  town: "自分の町の過去",
  season: "今季の一覧と数",
  compare: "過去シーズンとの比べ",
};

export default function MapPage({ replayStats = false, section = "all" }: { replayStats?: boolean; section?: MapSection }) {
  const inMap = section === "now" || section === "all";
  // 地図を出すまとまり。compare は段階 3 の 2 枚の地図ができるまで、選んだシーズンの地図を 1 枚出す
  const showMap = inMap || section === "compare";
  const d = useSeasonData();
  const { view } = d;
  const ds = useDataSource();
  const spotState = useSpotState();
  const { geo, failed: geoFailed } = useGeoStore();
  const narrow = useNarrow();

  // 自分の町の 1 文は、選んだシーズンではなく今季の事例で計算する（棒を押しても色が変わらない）
  const town = spotState.town;
  const townLine = useTownLine({
    spot: spotState.spot,
    town,
    cases: d.currentCases,
    birds: d.wildBirds,
    season: d.current,
    geo,
    now: ds.now(),
    unwatchedPrefCodes: d.failedPrefCodes, // 自分の町の県が未確認なら、1 文にそれを加える（④だけで済ませない）
  });
  const past = usePast({
    town,
    history: d.history,
    historyFailed: d.historyFailed,
    geo,
    geoFailed,
    current: d.current,
  });
  const farmMeshCode = spotState.spot?.meshCode ?? null;
  const nearby = useNearbyPast({
    town,
    meshCode: farmMeshCode,
    history: d.history,
    historyFailed: d.historyFailed,
    geo,
    geoFailed,
    current: d.current,
  });
  const band = useBandCounts({
    meshCode: farmMeshCode,
    cases: d.currentCases,
    history: d.history,
    historyFailed: d.historyFailed,
    geo,
    geoFailed,
    current: d.current,
  });
  const now = ds.now();
  const nowMinute = Math.floor(now.getTime() / 60_000); // 否定した事例が 8 日目に消えるのを、開いたままでも進める
  const rows = useMemo(() => (d.listCases === null ? [] : listRows(d.listCases, new Date(nowMinute * 60_000))), [d.listCases, nowMinute]);
  const birdRows = useMemo(() => wildBirdRows(d.wildBirds), [d.wildBirds]);
  const townName = town && geo ? (geo.index[town]?.name ?? null) : null;

  // 地図の見る場所、町を選ぶ画面、十字
  const [focus, setFocus] = useState<MapViewProps["focus"]>(null);
  const [picking, setPicking] = useState(false);
  const [aiming, setAiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapless, setMapless] = useState(false); // 地図が描けない端末（代わりの地図を出している）
  const mapRef = useRef<PickTarget | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const h1Ref = useRef<HTMLHeadingElement | null>(null);
  const nonce = useRef(0);
  // 会員の農場が後から届いたら、端末内の町や場所を変える画面は閉じる（変えても見える形が変わらない）
  const canEdit = !spotState.readOnly;
  const moveTo = useCallback((kind: "japan" | "muni" | "rings", codes: MuniCode[]) => {
    nonce.current += 1;
    setFocus({ kind, codes, nonce: nonce.current });
  }, []);
  const choose = useCallback(
    (code: MuniCode) => {
      const { clearedSpot } = spotState.setTown(code);
      setNotice(clearedSpot ? TEXT.townCleared : null);
      setPicking(false);
      moveTo("muni", [code]);
    },
    [spotState, moveTo],
  );
  const aim = useCallback(
    (on: boolean) => {
      setAiming(on);
      if (on) {
        setPicking(false);
        if (town) moveTo("muni", [town]); // 十字を合わせやすいよう、自分の町へ寄せる
      }
    },
    [town, moveTo],
  );
  const setPickingOpen = useCallback((open: boolean) => {
    setPicking(open);
    if (open) setAiming(false);
  }, []);
  // 地点があれば距離の輪の全体、町だけならその町が「自分の近く」
  const nearKind = farmMeshCode !== null ? "rings" : "muni";
  const showNear = useCallback(() => {
    if (town !== null) moveTo(nearKind, [town]);
  }, [town, nearKind, moveTo]);
  // 町があれば近くで始める。全国の広さでは輪も町の塗りも見えない。再現の 4 事例だけは全国の広さで見せる
  const startNear = ds.mode !== "replay" || replayStats;
  useEffect(() => {
    if (startNear) showNear();
  }, [startNear, showNear]);
  // 十字を合わせ始めたら、地図の上端を画面の先頭に寄せる（地図の上に町の欄があり、地図が下に隠れやすい）
  useEffect(() => {
    if (aiming) boxRef.current?.scrollIntoView?.({ block: "start" });
  }, [aiming]);
  // 棒を押したら、見出し（なければ地図）へ戻す。見出しが隠れている画面では offsetParent が null になる
  const selectSeason = (s: Parameters<typeof d.select>[0]) => {
    d.select(s);
    const h1 = h1Ref.current;
    (h1 && h1.offsetParent !== null ? h1 : boxRef.current)?.scrollIntoView?.({
      block: "start",
    });
  };
  const noneConfirmed = d.failedPrefCodes.length === PREFS.length;
  // 確認できていない県があるうちは、今季の件数を「確認できた範囲では N 件（M 県は確認できていません）」にする。
  // 47 県とも（見回りの結果が未着のときを含む）確認できていなければ、件数を見出しにしない
  const bars = d.bars.map((b) =>
    b.season === d.current && d.failedPrefCodes.length > 0
      ? {
          ...b,
          unchecked: d.failedPrefCodes.length,
          allUnchecked: noneConfirmed,
        }
      : b,
  );

  const currentBar: SeasonBarItem | null = bars.find((b) => b.season === d.current) ?? null;

  // 毎朝の札。未確認の断りは今季の件数と同じ形にする（0 件を素の「0 件」と読ませない）
  const showStats = view.isCurrent && (ds.mode !== "replay" || replayStats) && currentBar !== null;
  const formatAsOf = useFormatAsOf();
  // 再現のはじまる前は時点を描かない（空の札を出さない）
  const hideAsOfStat = d.asOf !== null && formatAsOf(d.asOf) === null;
  const today = jstDateOf(now);
  const watchFlags = { unchecked: d.failedPrefCodes.length, allUnchecked: noneConfirmed };
  const needsWide = watchFlags.unchecked > 0 && !noneConfirmed;
  const recentCount = useMemo(
    () => (d.currentCases === null ? null : countRecentDays(d.currentCases, d.current, today)),
    [d.currentCases, d.current, today],
  );
  const pastRange = useMemo(() => (d.history === null ? null : pastRangeToDate(d.history, today)), [d.history, today]);
  const pastSeasons = pastRange?.seasons ?? PAST_SEASONS;
  const bandNowText = (c: BandCount) => (c === "failed" ? TEXT.statFailed : countText({ count: c, ...watchFlags }));
  const bandPastText = (c: BandCount) => (c === "failed" ? TEXT.statFailed : countText({ count: c }));
  // 町が分からない発表は距離を計算できない。約 60km 以内の件数に入らないことを札に書く
  const unplaced = (d.currentCases ?? []).filter((c) => c.season === d.current && isCountable(c) && c.muniCode === null).length;
  const frequent = spotState.spot?.frequentMuniCodes;
  const frequentCounts = useMemo(
    () => (d.currentCases === null || !frequent ? null : frequentTownCounts(d.currentCases, frequent, d.current)),
    [d.currentCases, frequent, d.current],
  );
  const hasFrequent = farmMeshCode !== null && (frequent?.length ?? 0) > 0;
  const birdCounts = useMemo(() => wildBirdCounts(d.wildBirds), [d.wildBirds]);
  // 野鳥は環境省の発表で、県の見回りとは別。47 県とも未確認のときだけ、0 件を見出しにしない
  const birdText = !d.wildBirdsLoaded
    ? countText({ count: null })
    : birdCounts.total === 0
      ? countText({ count: 0, allUnchecked: noneConfirmed })
      : countText({ count: birdCounts.total });
  // 発生が 0 件のときと同じく、札に 0 件が出るときは札のすぐ前に置く（0 件だけが先に読まれないように）
  const zeroStat = showStats && (recentCount === 0 || (farmMeshCode !== null && band.now === 0) || (hasFrequent && geo !== null && (frequentCounts?.some((c) => c.count === 0) ?? false)));
  // 町の文のうち、普段の段階 ③④ と読み込み中は地図の下に置いて地図を上げる。重要な文と読めない断りは地図の前に置く
  const lineFailed = townLine.failed || (town !== null && geoFailed);
  const bannerBelowMap = town !== null && !lineFailed && (d.currentCases === null || townLine.line === null || townLine.line.tone === "lv3" || townLine.line.tone === "lv4");
  // 守る文を含む町の文は札より後ろにある。0 件の札を出すときと、町の文が地図の下に動くときは、守る文を札のすぐ前に移す
  const zeroShown = view.total === 0 || zeroStat;
  const lineHasRisk = townLine.line?.details.includes(FIXED_TEXT.riskAnywhere) ?? false;
  // スマホは町の文の全部を地図の下に置く。段階 ①② の文と、読めない断り、町の県が未確認の文（色なし）だけは、地図の前に残す
  const narrowTown = narrow && town !== null;
  const townLead = narrowTown && (lineFailed || (d.currentCases !== null && (townLine.line?.tone === "lv1" || townLine.line?.tone === "lv2" || townLine.line?.tone === "none")));
  const bannerAfterMap = bannerBelowMap || narrowTown;
  const riskMovedUp = showStats && view.loaded && lineHasRisk && (bannerAfterMap || zeroShown);
  const riskAboveStats = view.isCurrent && view.loaded && (riskMovedUp || (zeroShown && !lineHasRisk));
  const bannerLine = riskMovedUp && townLine.line ? { ...townLine.line, details: townLine.line.details.filter((t) => t !== FIXED_TEXT.riskAnywhere) } : townLine.line;

  // 守る文。スマホは出典を短いリンクにする（URL の全文は地図の下）
  const riskText = (className: string) =>
    narrow ? (
      <p className={className}>
        {RISK_SENTENCE}（
        <a href={RISK_URL} target="_blank" rel="noopener noreferrer" aria-label={`${TEXT.listSource}: ${RISK_SOURCE}`}>
          {TEXT.listSource}
        </a>
        ）
      </p>
    ) : (
      <p className={className}>{FIXED_TEXT.riskAnywhere}</p>
    );

  const picker = (
    <>
      <TownPicker
        geo={geo}
        geoFailed={geoFailed}
        town={town}
        readOnly={spotState.readOnly}
        readOnlyNote={spotState.source === "fixed" ? TEXT.spotFixed : undefined}
        picking={picking}
        onPickingChange={setPickingOpen}
        onChoose={choose}
      />
      {notice ? <p role="status">{notice}</p> : null}
    </>
  );

  const bannerProps = {
    muniCode: town,
    muniName: townName,
    loaded: d.currentCases !== null,
    line: bannerLine,
    lineFailed,
    past,
    nearby,
    slow: d.casesSlow,
    showPastDisclaimer: view.isCurrent || !view.loaded,
    riskShownAbove: riskMovedUp,
  };
  const banner = (
    <TownBanner {...bannerProps} part={townLead ? "rest" : "all"} pastBrief={section === "now"}>
      {town === null ? picker : null}
    </TownBanner>
  );
  // スマホの地図の下に送るもの。確認の行の全文、札の残り（数字の 1 行に入らないもの）
  const watchAfterMap = narrow && showStats && d.watchLoaded;
  const failedCount = d.failedPrefCodes.length;
  const failedWho = failedCount <= 2 ? names(d.failedPrefCodes) : TEXT.watchShortCount(failedCount);
  // 約 60km の件数を 0 と読ませない断り。PC は札の数字のすぐ下に置き、スマホは地図の下の残りに置く
  const bandCaveats = (
    <>
      {unplaced > 0 ? <p className="stat-note">{TEXT.statBandUnplaced(unplaced)}</p> : null}
      {band.now === "failed" || band.past === "failed" ? <p className="stat-note">{TEXT.statFailedNote}</p> : null}
    </>
  );
  const bandMore = (
    <>
      <p className="stat-value">
        {TEXT.statBandPast(pastSeasons)} {bandPastText(band.past)}
      </p>
      <p className="stat-note">{TEXT.statBandRelated}</p>
      {narrow ? bandCaveats : null}
    </>
  );
  // PC の札に添える出典や断り。スマホの数字の 1 行には出さない
  const whenLine = (text: string) => (narrow ? null : <p className="stat-when">{text}</p>);
  const casesSource = ds.mode === "replay" ? TEXT.chartsSourceReplay : TEXT.chartsSourceLive;
  // 過去の同じ日までの札。スマホは一覧より後の残りの札で、PC は数字の列の最後。過去は国の事例一覧から数える
  // 題の日付（「10 月 21 日」）は途中で折らない
  const pastDay = monthDay(today);
  const pastTitle = TEXT.statPastToDate(pastSeasons, pastDay);
  const pastDayAt = pastTitle.indexOf(pastDay);
  const pastStat =
    d.history !== null && pastRange === null ? null : (
      <div className="stat stat-past">
        <p className="stat-title">
          {pastTitle.slice(0, pastDayAt)}
          <span className="stat-date">{pastDay}</span>
          {pastTitle.slice(pastDayAt + pastDay.length)}
        </p>
        <StatCount text={pastRange ? rangeText(pastRange) : d.historyFailed ? TEXT.statFailed : countText({ count: null })} />
        {whenLine(TEXT.chartsSourceReplay)}
      </div>
    );
  const frequentStat = hasFrequent ? (
    <div className="stat stat-wide stat-frequent">
      <p className="stat-title">{TEXT.statFrequent}</p>
      {geoFailed ? (
        <p className="stat-value">{TEXT.statFailed}</p>
      ) : geo === null || frequentCounts === null ? (
        <p className="stat-value">{countText({ count: null })}</p>
      ) : (
        frequentCounts.map((c) => (
          <p className="stat-value" key={c.muniCode}>
            {geo.index[c.muniCode]?.name ?? c.muniCode}{" "}
            {countText({
              count: c.count,
              unchecked: d.failedPrefCodes.includes(geo.index[c.muniCode]?.prefCode ?? c.muniCode.slice(0, 2)) ? 1 : 0,
              allUnchecked: noneConfirmed,
            })}
          </p>
        ))
      )}
    </div>
  ) : null;
  // スマホで、全国の件数と同じ文だけの札（まだ確認できていません、など）は繰り返さない
  const repeatsHead = (text: string) => narrow && currentBar !== null && !text.includes("件") && text === countText(currentBar);
  const bandNow = bandNowText(band.now);
  const recentText = countText({ count: recentCount, ...watchFlags });
  // 最初は全国の広さ（focus なし）。動かした先で押された状態を決める
  const showingNear = focus !== null && focus.kind !== "japan";
  // 「自分の近く」の広さでは県のバッジも町の塗りも出ない発表（確認中の県、町の分からない発表）。
  // スマホは地図の下の端に 1 行で出す（2026-11-06 作者の決定。PC は対象外）
  const unplacedByPref = new Map<string, number>();
  for (const c of view.cases) if (c.muniCode === null) unplacedByPref.set(c.prefCode, (unplacedByPref.get(c.prefCode) ?? 0) + 1);
  const reviewingSet = new Set(view.reviewingPrefCodes);
  const unmarked = PREFS.filter((p) => reviewingSet.has(p.code) || unplacedByPref.has(p.code)).map((p) => {
    const n = unplacedByPref.get(p.code);
    const parts = [reviewingSet.has(p.code) ? TEXT.nearUnmarkedReviewing : null, n ? TEXT.nearUnmarkedUnplaced(n) : null];
    return `${p.name} ${parts.filter((s) => s !== null).join("・")}`;
  });
  const showUnmarked = narrow && town !== null && showingNear && !mapless && view.loaded && unmarked.length > 0;

  return (
    <div className="map-page" data-section={section}>
      <h1 ref={h1Ref}>{section === "now" || section === "all" ? `${view.label}の発生状況` : SECTION_TITLE[section]}</h1>
      {section === "town" ? null : view.isCurrent ? (
        <WatchAsOf loaded={d.watchLoaded} line={d.watch} />
      ) : (
        <>
          <p className="as-of">{TEXT.pastAsOf}</p>
          <p className="as-of">
            {view.season}年6月〜{view.season + 1}年5月の記録
          </p>
        </>
      )}

      {view.isCurrent && !view.loaded ? (
        <p className="state-unknown" role="status">
          今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。
          {d.casesSlow ? <> {TEXT.slowLoad}</> : null}
        </p>
      ) : null}
      {!view.isCurrent && !view.loaded ? (
        <p className={d.historyFailed ? "state-unknown" : "state-wait"} role="status">
          過去の記録をまだ読めていません。
          {d.historyFailed ? (
            <>
              {" "}
              <button type="button" className="btn" onClick={d.retryHistory}>
                もう一度読む
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {section !== "town" && view.isCurrent && !watchAfterMap ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}
      {section !== "town" && view.reviewingPrefCodes.length > 0 ? (
        <p className="state-wait">
          確認中の発表がある県: {names(view.reviewingPrefCodes)}
          。件数にはまだ入れていません。
        </p>
      ) : null}
      {/* 札の「0 件」だけが先に読まれないよう、札のすぐ前に置く */}
      {/* PC は未確認の断りを札ごとに繰り返さず、札の上の 1 文にまとめる（2026-11-06 作者の決定）。
          文はスマホの stat-unchecked と同じ。斜線の一文は、すぐ下の確認の行にあるので繰り返さない。
          守る文（riskAnywhere）が札のすぐ前に来る決まりを崩さないよう、その前に置く */}
      {inMap && showStats && !narrow && d.watchLoaded && failedCount > 0 ? (
        <p className="stat-unchecked-wide">
          {/* 文ごとに 1 つの塊にして、狭い右の列（再現）でも「ませ／ん。」と折らない */}
          {noneConfirmed ? null : <span className="stat-sentence">{TEXT.watchShortRange}</span>}
          <span className="stat-sentence">{TEXT.watchShortWho(failedWho)}</span>
        </p>
      ) : null}
      {inMap && riskAboveStats ? riskText("map-notice map-risk") : null}
      {inMap && showStats ? (
        <div className="stat-row">
          <p className="stat-headline">{TEXT.statHeadline}</p>
          {narrow && d.watchLoaded && failedCount > 0 ? (
            <p className="stat-unchecked">
              {noneConfirmed ? null : TEXT.watchShortRange}
              {TEXT.watchShortWho(failedWho)}
              {TEXT.watchFailedTail}
            </p>
          ) : null}
          {farmMeshCode !== null && !repeatsHead(bandNow) ? (
            <div className="stat stat-wide stat-band">
              <div className="stat-band-main">
                <p className="stat-title">
                  {TEXT.statBand(DISTANCE_BAND_KM).slice(0, -TEXT.statBandTail.length)}
                  <span className="stat-long">{TEXT.statBandTail}</span>
                </p>
                <StatCount text={bandNow} lead={TEXT.statBandNow} />
              </div>
              {whenLine(TEXT.statBandWhen)}
              {narrow ? null : bandCaveats}
            </div>
          ) : null}
          <div className={currentBar.unchecked && !currentBar.allUnchecked ? "stat stat-wide stat-national" : "stat stat-national"}>
            <p className="stat-title">発生した件数</p>
            <StatCount text={countText(currentBar)} />
            {whenLine(casesSource)}
          </div>
          {repeatsHead(recentText) ? null : (
            <div className={needsWide ? "stat stat-wide stat-recent" : "stat stat-recent"}>
              <p className="stat-title">
                {TEXT.statRecent.slice(0, -TEXT.statRecentTail.length)}
                <span className="stat-long">{TEXT.statRecentTail}</span>
              </p>
              <StatCount text={recentText} />
              {whenLine(casesSource)}
            </div>
          )}
          {hideAsOfStat ? null : (
            <div className="stat stat-time">
              <p className="stat-title">時刻</p>
              <WatchAsOf loaded={d.watchLoaded} line={d.watch} />
            </div>
          )}
          {narrow ? null : pastStat}
        </div>
      ) : null}
      {section === "town" ? (
        <TownBanner {...bannerProps} part="all">
          {town === null ? picker : null}
        </TownBanner>
      ) : null}
      {inMap && townLead ? <TownBanner {...bannerProps} part="lead" /> : null}
      {inMap && !bannerAfterMap ? banner : null}

      {showMap ? (
        <>
      {town !== null ? (
        <div className="map-scope" role="group" aria-label={TEXT.mapScopeAria}>
          <button type="button" aria-pressed={showingNear} onClick={showNear}>
            {TEXT.mapNear}
          </button>
          <button type="button" aria-pressed={!showingNear} onClick={() => moveTo("japan", [])}>
            {TEXT.japan}
          </button>
        </div>
      ) : null}

      <div className="map-box" ref={boxRef}>
        <MapChunkBoundary>
          <Suspense fallback={<p role="status">地図を読み込んでいます</p>}>
            <MapView
              view={view}
              wildBirds={d.wildBirds}
              failedPrefCodes={d.failedPrefCodes}
              myMuniCode={town}
              nearMuniCodes={townLine.nearMuniCodes}
              farmMeshCode={farmMeshCode}
              focus={focus}
              pickMode={picking && canEdit}
              onSelectMuni={picking && canEdit ? choose : undefined}
              onMapReady={(map) => {
                mapRef.current = map as unknown as PickTarget;
              }}
              onUnsupported={() => {
                setMapless(true);
                setAiming(false);
              }}
            />
          </Suspense>
        </MapChunkBoundary>
        {aiming && canEdit && !mapless ? <div className="crosshair" aria-hidden="true" /> : null}
        {/* 町を選ぶ前は切り替えがないので、拡大の後に全国へ戻る口を地図の隅に置く */}
        {narrow && town === null && !mapless ? (
          <button type="button" className="map-home-btn" onClick={() => moveTo("japan", [])}>
            {TEXT.japan}
          </button>
        ) : null}
        {showUnmarked ? (
          <div className="near-unmarked">
            <p>
              {TEXT.nearUnmarkedLead}
              {/* 県ごとに 1 つの塊にして、「確／認中」のように語の途中で折らない */}
              {unmarked.slice(0, 3).map((item, i) => (
                <span key={item}>
                  {i > 0 ? "、" : null}
                  <span className="near-unmarked-item">{item}</span>
                </span>
              ))}
              {unmarked.length > 3 ? TEXT.nearUnmarkedMore(unmarked.length - 3) : null}
            </p>
            <button type="button" onClick={() => moveTo("japan", [])}>
              {TEXT.nearUnmarkedJapan}
            </button>
          </div>
        ) : null}
      </div>

      <p className="map-disclaimer">色がない場所は、発生の報告がないだけです。これから出ないという意味ではありません。</p>
      {farmMeshCode !== null ? <p className="map-ring-note">{TEXT.ringNote}</p> : null}
      {narrow && riskAboveStats ? (
        <p className="map-risk-source">
          {TEXT.listSource}: {RISK_SOURCE}{" "}
          <a href={RISK_URL} target="_blank" rel="noopener noreferrer">
            {RISK_URL}
          </a>
        </p>
      ) : null}
      {watchAfterMap ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}
      {inMap && showStats && (farmMeshCode !== null || hasFrequent) ? (
        <div className="stat-below">
          {farmMeshCode !== null ? (
            <div className="stat-band-more">
              <p className="stat-title">{TEXT.statBand(DISTANCE_BAND_KM)}</p>
              {bandMore}
            </div>
          ) : null}
          {frequentStat}
        </div>
      ) : null}
      {inMap && bannerAfterMap ? banner : null}
      {inMap && town !== null ? picker : null}
      <Legend isCurrent={view.isCurrent} />

      {mapless ? null : (
        <p className="map-attribution">
          {MAP_ATTRIBUTION.map((html, i) => (
            // 出典の文は geo/attribution.ts の固定の文（外からの入力を含まない）
            <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </p>
      )}

      {inMap ? (
      <SpotPicker
        getMap={() => mapRef.current}
        geo={geo}
        deviceSpot={spotState.deviceSpot}
        readOnly={spotState.readOnly}
        saveFailed={spotState.saveFailed}
        aiming={aiming}
        onAimingChange={aim}
        onSet={(spot) => {
          spotState.setDeviceSpot(spot);
          setNotice(null);
        }}
        onClear={spotState.clearDeviceSpot}
        mapless={mapless}
        town={town}
      />
      ) : null}
        </>
      ) : null}

      {section === "season" || section === "compare" || section === "all" ? (
      <CaseListSheet
        rows={rows}
        birds={view.isCurrent ? birdRows : null}
        loaded={d.listCases !== null}
        unwatchedCount={view.isCurrent ? d.failedPrefCodes.length : 0}
      />
      ) : null}

      {showStats && ((inMap && narrow && pastStat !== null) || (ds.mode !== "replay" && (section === "season" || section === "all"))) ? (
        <div className="stat-rest">
          {inMap && narrow ? pastStat : null}
          {ds.mode === "replay" || !(section === "season" || section === "all") ? null : (
            <div className="stat stat-wide">
              <p className="stat-title">{TEXT.statBirds}</p>
              <p className="stat-value">{birdText}</p>
              {d.wildBirdsLoaded && birdCounts.total > 0 ? <p className="stat-note">{TEXT.statBirdsBreakdown(birdCounts.confirmed, birdCounts.screening)}</p> : null}
              <p className="stat-note">{TEXT.statBirdsNote}</p>
              <p className="stat-note">
                <Link to="/trends" className="tap-link">
                  {TEXT.statBirdsLink}
                </Link>
              </p>
            </div>
          )}
        </div>
      ) : null}

      {section === "compare" || section === "all" ? <SeasonBar bars={bars} selected={d.selected} onSelect={selectSeason} current={d.current} /> : null}

      {/* 再現（去年の再現）は日付を過去に置いた画面なので、今日の比べは出さない */}
      {ds.mode === "replay" || !(section === "compare" || section === "all") ? null : (
        <SeasonCompare
          today={today}
          current={d.current}
          currentCases={d.currentCases}
          history={d.history}
          historyFailed={d.historyFailed}
          asOf={d.asOf}
          unchecked={d.failedPrefCodes.length}
          allUnchecked={noneConfirmed}
        />
      )}

      {/* 札と同じ条件で出す（今季だけ。再現は全国の流れだけで、再現の時計までを描く） */}
      {showStats && (section === "season" || section === "all") ? (
        <SeasonCharts
          loaded={view.loaded}
          allUnchecked={noneConfirmed}
          countByPref={view.countByPref}
          cases={view.cases}
          season={view.season}
          today={today}
          failedPrefCodes={d.failedPrefCodes}
          asOfText={d.asOf === null ? null : formatAsOf(d.asOf)}
          source={ds.mode === "replay" ? TEXT.chartsSourceReplay : TEXT.chartsSourceLive}
          note={riskAboveStats || lineHasRisk ? null : riskText("map-notice")}
        />
      ) : null}

      {!view.isCurrent && view.loaded && section !== "town" ? <p className="map-notice">{FIXED_TEXT.pastDisclaimer}</p> : null}
      {view.undatedCases > 0 && (section === "season" || section === "compare" || section === "all") ? (
        <p className="map-note">日付のない事例が {view.undatedCases} 件あり、月の棒には入っていません。</p>
      ) : null}

      {section === "season" || section === "compare" || section === "all" ? (
        <MonthBars months={view.months} loaded={view.loaded} allUnchecked={view.isCurrent && noneConfirmed} past={!view.isCurrent} />
      ) : null}
      {section === "now" ? <NextLinks /> : null}
      {section === "all" ? <MapLinks /> : null}
    </div>
  );
}
