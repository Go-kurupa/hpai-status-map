import { jstDateOf } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { DISTANCE_BAND_KM, isCountable } from "@hpai/shared/level";
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { MuniCode, Season } from "@hpai/shared/types";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MAP_ATTRIBUTION } from "../../geo/attribution";
import { useDataSource } from "../../data/context";
import { useFormatAsOf } from "../../ui/AsOf";
import { RiskLine, RiskSource } from "../../ui/RiskLine";
import { loadMarkSize, saveMarkSize, type MarkSize } from "../../data/spot";
import { useSpotState } from "../../data/spotContext";
import type { MapViewProps } from "./MapView";
import { CaseListSheet } from "./CaseListSheet";
import { Legend } from "./Legend";
import { mesh3Center } from "@hpai/shared/mesh";
import { birdsFarText, usePrefAnchors } from "./birdOutside";
import { listRows, wildBirdRows } from "./listRows";
import { MapChunkBoundary } from "./MapChunkBoundary";
import { SectionTabs } from "../../ui/SectionTabs";
import { RecentAlert, recentAlertItems } from "./RecentAlert";
import { TownCasesPanel } from "./TownCasesPanel";
import { CompareOverlay } from "./CompareOverlay";
import { parseRegion, regionOf, type RegionId } from "../../geo/regions";
import { regionMuniCodes, ScopeButtons, type Scope } from "./ScopeButtons";
import { buildSeasonView } from "./seasonView";
import { ExploreLink, MapLinks, NextLinks } from "./MapLinks";
import { MonthBars } from "./MonthBars";
import { birdPrefsText } from "./birdStat";
import { casesNearCenter, countRecentDays, frequentTownCounts, PAST_SEASONS, pastRangeToDate, rangeText, wildBirdCounts } from "./overviewCounts";
import { SPOT_MIN_ZOOM, type PickTarget } from "./pickSpot";
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

/**
 * 町の欄の約 60 km 以内の件数の 1 行。札（StatCount）と違い、スマホでも見出し（今季、過去 6 シーズン）と未確認の断りを隠さない。
 * 「N 件」の数字だけを太くする
 */
function BandLine({ lead, text }: { lead: string; text: string }) {
  const count = /^(\d+(?:〜\d+)?) 件$/.exec(text);
  return (
    <p className="stat-value">
      {lead}{" "}
      {count ? (
        <>
          <b>{count[1]}</b> 件
        </>
      ) : (
        text
      )}
    </p>
  );
}

/**
 * 入口の画面。DOM の順はスマホで見る順で、上から 確認の行、守る文、数字の札、切り替え、地図、断り、一覧、残りの札、棒。
 * 塗りがないことを「何もない」と読ませない。64rem 以上の 2 列は map.css の order で組む。
 * replayStats は再現の全国の流れだけが渡す。件数の札を再現の時計で出す（野鳥の札は、再現が野鳥を持たないので出さない）。
 */
/**
 * 見せるまとまり（設計書 2026-11-06-ui-frame 4 章）。now は「今季の発生と地図」（/）、town は「選択地域の過去」、
 * season は「今季の一覧と数」、compare は「過去シーズンとの比べ」。all は再現と見本の中（今の並びのまま全部）。
 */
export type MapSection = "now" | "town" | "season" | "compare" | "all";

const SECTION_TITLE: Record<Exclude<MapSection, "now" | "all">, string> = {
  town: "選択地域の過去",
  season: "今季の一覧と数",
  compare: "地図で比べる過去の発生",
};

export default function MapPage({ replayStats = false, section = "all" }: { replayStats?: boolean; section?: MapSection }) {
  const inMap = section === "now" || section === "all";
  // 地図を出すまとまり。compare は 2 つのシーズンを 1 枚に重ねた地図（CompareOverlay。設計書 2026-11-06-data-explore E8）
  const showMap = inMap || section === "compare";
  const d = useSeasonData();
  const { view } = d;
  // 比べるシーズン（設計書 2026-11-06-data-explore E12）。地図の上のシーズンのボタンだけで選ぶ（初めは 1 年前と今季）【AI の既定案】。
  // 下のシーズンの棒（d.selected）は一覧と月の件数のシーズンを選ぶだけで、比べるシーズンには触らない（棒を押して比べのシーズンが
  // 黙って替わらないように。11/7 の横断レビューの指摘）。2 つなら重ね合わせ、1 つか 3 つ以上なら最後の発生の色
  const [cmpSeasons, setCmpSeasons] = useState<Season[]>(() => [d.current - 1, d.current]);
  const cmpViews = useMemo(
    () => cmpSeasons.map((s) => (s === view.season ? view : buildSeasonView({ season: s, current: d.current, currentCases: d.currentCases, history: d.history }))),
    [cmpSeasons, view, d.current, d.currentCases, d.history],
  );
  const pickCmpSeasons = (next: Season[]) => setCmpSeasons([...new Set(next)].sort((a, b) => a - b));
  // 画面に出ている地図の中身。比べは選んだシーズンを全部見て、今季の断り（読めていない、確認の行）を出す（どれかが今季なら）
  const shownViews = section === "compare" ? cmpViews : [view];
  const reviewingShown = [...new Set(shownViews.flatMap((v) => v.reviewingPrefCodes))];
  const firstPicked = useRef(false);
  useEffect(() => {
    if (section !== "compare" || firstPicked.current) return;
    firstPicked.current = true;
    d.select(d.current - 1);
    // 開いたときに 1 度だけ。d は毎回作り直されるので依存に入れない
  }, [section]);
  const ds = useDataSource();
  const spotState = useSpotState();
  const { geo, failed: geoFailed } = useGeoStore();
  // 野鳥の印の位置（町の中心、なければ県の代表の位置）を地図と同じに決めるため（約 60 km より遠い野鳥の帯）
  const prefAnchors = usePrefAnchors();
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
    unwatchedSince: d.watchSince, // 1 回目に読めなかった時刻を 1 文に添える
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
  // 鶏舎の場所として印を描き、「鶏舎の付近」と呼ぶのは、本人の端末の場所か会員の農場だけ（2026-11-07 作者の決定 A）。
  // 再現や見本の仮の地点（fixed）は農場の場所ではないので、印を描かず、今までの呼び方のまま
  const ownFarm = farmMeshCode !== null && spotState.source !== "fixed";
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
  // 選ぶ画面を開いた時の、町の欄の置き場（地図の後ろか）。開いている間に置き場が変わると選ぶ画面が作り直され、入力が消えるので固定する
  const [pickSlot, setPickSlot] = useState<boolean | null>(null);
  const [aiming, setAiming] = useState(false);
  // 鶏舎の印の大きさ（見た目だけ。保存は約 1km のマス目のまま。2026-11-07 作者の決定）。端末に覚える
  const [markSize, setMarkSize] = useState<MarkSize>(() => loadMarkSize());
  const pickMarkSize = (size: MarkSize) => {
    setMarkSize(size);
    saveMarkSize(size);
  };
  // 鶏舎の場所の候補を確かめている間（SpotPicker が知らせる）。この間と十字を合わせている間は、町の欄の置き場を地図の後ろに固定する
  const [spotCandidate, setSpotCandidate] = useState(false);
  // 合わせ始めた時の町の欄の置き場（地図の後ろなら true）。合わせている間と候補を確かめている間はこれに固定する。
  // 画面に出ている置き場は、描いた後に shownSlot へ写す（捨てられた描画の値を使わない）
  const [spotSlot, setSpotSlot] = useState<boolean | null>(null);
  const shownSlot = useRef<boolean | null>(null);
  const holdSlot = useCallback(() => setSpotSlot((cur) => cur ?? shownSlot.current), []);
  // SpotPicker は候補を入れるのと同じ更新の中で知らせる（決めた直後に固定が一瞬外れて欄が作り直されないように）
  const onSpotCandidate = useCallback(
    (has: boolean) => {
      setSpotCandidate(has);
      if (has) holdSlot();
    },
    [holdSlot],
  );
  // 場所合わせ中は、町の形などが後から届いても選択地域付近へ寄せ直さない（決められる拡大まで寄せた結果が消える）
  const aimingRef = useRef(false);
  aimingRef.current = aiming;
  const [notice, setNotice] = useState<string | null>(null);
  const [mapless, setMapless] = useState(false); // 地図が描けない端末（代わりの地図を出している）
  const mapRef = useRef<PickTarget | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const h1Ref = useRef<HTMLHeadingElement | null>(null);
  const nonce = useRef(0);
  // 会員の農場が後から届いたら、端末内の町や場所を変える画面は閉じる（変えても見える形が変わらない）
  const canEdit = !spotState.readOnly;
  const moveTo = useCallback((kind: "japan" | "muni" | "rings", codes: MuniCode[], minZoom?: number) => {
    nonce.current += 1;
    setFocus(minZoom === undefined ? { kind, codes, nonce: nonce.current } : { kind, codes, nonce: nonce.current, minZoom });
  }, []);
  const choose = useCallback(
    (code: MuniCode) => {
      const { clearedSpot } = spotState.setTown(code);
      setNotice(clearedSpot ? TEXT.townCleared : null);
      setPicking(false);
      moveTo("muni", [code]);
      // スマホは自分の町の欄が地図の下にある。決めた結果が見えるよう、地図の上端へ戻す（設計書 2026-11-06-town-picker D5）
      if (narrow) boxRef.current?.scrollIntoView?.({ block: "start" });
    },
    [spotState, moveTo, narrow],
  );
  const aim = useCallback(
    (on: boolean) => {
      setAiming(on);
      if (on) {
        holdSlot();
        setPicking(false);
        // 十字を合わせやすいよう、自分の町へ寄せる。大きな町でも、そのまま「ここに決める」を押せる拡大まで寄せる
        if (town) moveTo("muni", [town], SPOT_MIN_ZOOM);
      }
    },
    [town, moveTo, holdSlot],
  );
  const setPickingOpen = useCallback((open: boolean) => {
    setPicking(open);
    if (open) setAiming(false);
  }, []);
  // 地点があれば距離の輪の全体、町だけならその町が「選択地域付近」
  // 地点がなく町だけ選んだ人は、町の中心から距離の輪を描く（設計書 2026-11-06-ui-frame 決定 6）。「選択地域付近」は輪の全体が入る広さ
  const ringCenter = farmMeshCode === null && town !== null && geo ? (geo.index[town]?.center ?? null) : null;
  const nearKind = farmMeshCode !== null || ringCenter !== null ? "rings" : "muni";
  // 地図で押した町（設計書 2026-11-06-ui-frame 決定 4）。今季の発生の地図だけ
  const [inspected, setInspected] = useState<MuniCode | null>(null);
  const showNear = useCallback(() => {
    if (town !== null) moveTo(nearKind, [town]);
  }, [town, nearKind, moveTo]);
  // 町があれば近くで始める。全国の広さでは輪も町の塗りも見えない。再現の 4 事例だけは全国の広さで見せる
  // 比べを「条件で見る」から ?region= で開いたときは、その地方へ寄せ、選択地域付近へは動かさない（設計書 2026-11-06-data-explore E15）
  const [searchParams] = useSearchParams();
  const [regionParam] = useState<RegionId | null>(() => (section === "compare" ? parseRegion(searchParams.get("region")) : null));
  const startNear = (ds.mode !== "replay" || replayStats) && regionParam === null;
  // 町だけの人は、町の形が届くまで動かさない。届く前は町の中心が分からず、町へ寄ってから輪の広さへもう一度動いてしまう
  const geoPending = farmMeshCode === null && town !== null && geo === null && !geoFailed;
  // 比べの広さのボタンを一度でも押したら、自動で選択地域付近へ寄せ直さない（町の形や会員の農場が後から届くと showNear が作り直されるため。
  // 押された印と地図の寄せ先がずれないように）
  const userScoped = useRef(regionParam !== null);
  useEffect(() => {
    if (startNear && !geoPending && !userScoped.current && !aimingRef.current) showNear();
  }, [startNear, geoPending, showNear]);
  // 比べの広さのボタン（1 段。押された印は最後に押した 1 つ）。地方へ寄せるには町の形が要るので、届く前に押されたら届いてから寄せる
  const [cmpScope, setCmpScope] = useState<Scope>(() => regionParam ?? (town !== null && startNear ? "near" : "japan"));
  const pendingRegion = useRef<RegionId | null>(regionParam);
  const goRegion = useCallback(
    (id: RegionId) => {
      userScoped.current = true;
      setCmpScope(id);
      if (geo) moveTo("muni", regionMuniCodes(id, Object.keys(geo.index)));
      else pendingRegion.current = id;
    },
    [geo, moveTo],
  );
  useEffect(() => {
    const id = pendingRegion.current;
    if (!geo || id === null) return;
    pendingRegion.current = null;
    moveTo("muni", regionMuniCodes(id, Object.keys(geo.index)));
  }, [geo, moveTo]);
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
  // 最初の画面の赤い枠（直近 14 日の発生）。今季が読めてから並べる。野鳥がまだ読めていなければ養鶏場などだけを並べ、枠にそのことを書き添える
  // （野鳥が読めないだけで、養鶏場の発生まで黙って消さない。2026-11-07 点検の指摘）
  const recentItems = useMemo(
    () => (d.currentCases === null ? [] : recentAlertItems({ cases: d.currentCases, birds: d.wildBirdsLoaded ? d.wildBirds : [], current: d.current, today })),
    [d.currentCases, d.wildBirdsLoaded, d.wildBirds, d.current, today],
  );
  const birdPrefs = useMemo(() => birdPrefsText(d.wildBirds), [d.wildBirds]);
  // 野鳥は環境省の発表で、県の見回りとは別。47 県とも未確認のときだけ、0 件を見出しにしない
  const birdText = !d.wildBirdsLoaded
    ? countText({ count: null })
    : birdCounts.total === 0
      ? countText({ count: 0, allUnchecked: noneConfirmed })
      : countText({ count: birdCounts.total });
  // 発生が 0 件のときと同じく、札に 0 件が出るときは札のすぐ前に置く（0 件だけが先に読まれないように）
  const zeroStat = showStats && (recentCount === 0 || (hasFrequent && geo !== null && (frequentCounts?.some((c) => c.count === 0) ?? false)));
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
  // 鶏舎の場所を合わせている間と候補を確かめている間は、町の欄の置き場を合わせ始めた時のままにする。
  // 町の文の段階が途中で変わって欄が地図の前後に動くと、場所の欄が作り直されて候補や地区の選択が消えるため
  const spotBusy = inMap && canEdit && (aiming || spotCandidate);
  // 地域が未選択の最初の画面は、案内を時点のすぐ下の帯にする（置き場を固定し、地図の前後に動かさない）
  const promptTop = inMap && town === null;
  const bannerSlotAfterMap = picking && pickSlot !== null ? pickSlot : spotBusy && spotSlot !== null ? spotSlot : bannerAfterMap;
  useEffect(() => {
    shownSlot.current = bannerSlotAfterMap;
  });
  // 合わせ終わって候補もなくなったら、固定を外す
  useEffect(() => {
    if (!spotBusy) setSpotSlot(null);
  }, [spotBusy]);
  const riskMovedUp = showStats && view.loaded && lineHasRisk && (bannerAfterMap || zeroShown);
  const riskAboveStats = view.isCurrent && view.loaded && (riskMovedUp || (zeroShown && !lineHasRisk));
  // 鶏舎から約 60 km 以内の件数（町の欄の鶏舎の場所の下。2026-11-07 作者の決定 A）。今季が 0 件なら、守る文を件数のすぐ前に置く
  // （札の前にもう出ているときは繰り返さない）。そのときは町の文から守る文を外し、同じ欄で 2 度書かない
  const showBand = inMap && showStats && farmMeshCode !== null;
  const bandRisk = showBand && band.now === 0 && !riskAboveStats;
  const bannerLine =
    (riskMovedUp || bandRisk) && townLine.line ? { ...townLine.line, details: townLine.line.details.filter((t) => t !== FIXED_TEXT.riskAnywhere) } : townLine.line;

  // 守る文。「文（出典: 名前）」の形で、名前を出典へのリンクにする（長い URL を本文に出さない）。
  // スマホの札の前の 1 文だけは短い「文（出典）」にする（360x740 の最初の画面に札と地図を収める。shell.spec）。出典の名前は地図の下の行に出す
  const riskText = (className: string, short = false) => <RiskLine className={className} short={short} />;

  const picker = (
    <>
      <TownPicker
        geo={geo}
        geoFailed={geoFailed}
        town={town}
        readOnly={spotState.readOnly}
        readOnlyNote={spotState.source === "fixed" ? TEXT.spotFixed : undefined}
        hasSpot={spotState.deviceSpot !== null}
        mapHint={showMap}
        picking={picking}
        onPickingChange={(open) => {
          // 開いた時の置き場を覚えておく（下の bannerSlotAfterMap）
          setPickSlot(open ? bannerAfterMap : null);
          setPickingOpen(open);
        }}
        onChoose={choose}
      />
      {notice ? <p role="status">{notice}</p> : null}
    </>
  );

  const bandBox = showBand ? (
    <div className="farm-band">
      <p className="farm-band-title">{ownFarm ? TEXT.bandTitle(DISTANCE_BAND_KM) : TEXT.statBand(DISTANCE_BAND_KM)}</p>
      {bandRisk ? riskText("town-note") : null}
      <BandLine lead={TEXT.statBandNow} text={bandNowText(band.now)} />
      <BandLine lead={TEXT.statBandPast(pastSeasons)} text={bandPastText(band.past)} />
      {/* 約 60km の件数を 0 と読ませない断り */}
      {unplaced > 0 ? <p className="stat-note">{TEXT.statBandUnplaced(unplaced)}</p> : null}
      {band.now === "failed" || band.past === "failed" ? <p className="stat-note">{TEXT.statFailedNote}</p> : null}
      <p className="stat-note">
        {TEXT.statBandWhen}。{TEXT.statBandRelated}
      </p>
    </div>
  ) : null;
  const spotPicker = (
    <SpotPicker
      getMap={() => mapRef.current}
      geo={geo}
      deviceSpot={spotState.deviceSpot}
      deviceOaza={spotState.spotOaza}
      readOnly={spotState.readOnly}
      saveFailed={spotState.saveFailed}
      aiming={aiming}
      onAimingChange={aim}
      onSet={(spot, oaza) => {
        spotState.setDeviceSpot(spot, oaza);
        setNotice(null);
      }}
      onClear={spotState.clearDeviceSpot}
      mapless={mapless}
      town={town}
      onAimAt={(lng, lat) => {
        // 地区（大字）の目安の点へ寄せる。点は寄せる先にだけ使い、保存しない（決めるのは十字の下の約 1km のマス目）
        nonce.current += 1;
        setFocus({ kind: "point", codes: town ? [town] : [], nonce: nonce.current, at: [lng, lat] });
      }}
      onCandidateChange={onSpotCandidate}
      registerHref="/settings/farm"
    />
  );
  // 選択地域の行のすぐ下に、鶏舎の場所と約 60 km 以内の件数（2026-11-07 作者の決定 A）。今季の地図の画面だけ
  const spotRow = inMap ? (
    <>
      {spotPicker}
      {bandBox}
    </>
  ) : undefined;

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
    // 約 60 km の件数の前に守る文を出したときも、過去の行で繰り返さない
    riskShownAbove: riskMovedUp || bandRisk,
  };
  const banner = (
    <TownBanner
      {...bannerProps}
      part={townLead ? "rest" : "all"}
      pastBrief={section === "now"}
      onPickTown={section === "now" ? setInspected : undefined}
      hideNationalHead={section === "now"}
      nameAction={town !== null ? picker : undefined}
      spotRow={spotRow}
    >
      {town === null ? picker : null}
    </TownBanner>
  );
  // スマホの地図の下に送るもの。確認の行の全文、札の残り（数字の 1 行に入らないもの）
  const watchAfterMap = narrow && showStats && d.watchLoaded;
  const failedCount = d.failedPrefCodes.length;
  // 選択地域付近で比べているときに「数で見る」へ渡す地方。端末に残った値が県の番号でなくても落とさない（2026-11-07 点検の指摘）
  const nearPref = town === null ? null : town.slice(0, 2);
  const nearRegion = nearPref !== null && PREF_NAME.has(nearPref) ? regionOf(nearPref) : null;
  const failedWho = failedCount <= 2 ? names(d.failedPrefCodes) : TEXT.watchShortCount(failedCount);
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
  const recentText = countText({ count: recentCount, ...watchFlags });
  // 最初は全国の広さ（focus なし）。動かした先で押された状態を決める
  const showingNear = focus !== null && focus.kind !== "japan";
  // 「選択地域付近」の広さでは県のバッジも町の塗りも出ない発表（確認中の県、町の分からない発表）。
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
  // 約 60 km より遠い野鳥の陽性（2026-11-07 作者の決定 C）。鶏舎の付近・選択地域付近で、輪の中心（鶏舎のマス目の中心か町の中心）から
  // 約 60 km より遠い野鳥の陽性を県名で知らせる。印の位置は地図と同じ決め方（birdOutside.ts）。再現では出さない
  const nearCenter: [number, number] | null =
    farmMeshCode !== null ? ((c) => [c.lng, c.lat] as [number, number])(mesh3Center(farmMeshCode)) : town !== null && geo ? (geo.index[town]?.center ?? null) : null;
  const birdsFar = nearCenter === null || geo === null || !d.wildBirdsLoaded ? null : birdsFarText(d.wildBirds, nearCenter, geo.index, prefAnchors, DISTANCE_BAND_KM);
  const showBirdsFar = section === "now" && ds.mode !== "replay" && town !== null && showingNear && !mapless && birdsFar !== null;
  // 「選択地域付近」で、約 60 km 以内に今季の発生がないときだけ「確認されていません」と出す（2026-11-06 作者の決定）。
  // 1 件以上あるとき、全国の見方、再現、数えられないとき（町の分からない発表がある、まだ読めていない）は出さない
  const nowCountable = d.currentCases === null ? null : d.currentCases.filter((c) => c.season === d.current && isCountable(c));
  const nearCount =
    section !== "now" || ds.mode === "replay" || !showingNear || town === null || geo === null || nowCountable === null || nowCountable.some((c) => c.muniCode === null)
      ? null
      : farmMeshCode !== null
        ? typeof band.now === "number"
          ? band.now
          : null
        : casesNearCenter(town, nowCountable, geo);

  // 鶏舎の印の大きさの切り替え（見た目だけ。2026-11-07 作者の決定）。地図に印があるときだけ出す
  const markSizeGroup =
    ownFarm && !mapless ? (
      <div className="mark-size" role="group" aria-label={TEXT.markSizeLabel}>
        <span className="mark-size-label" aria-hidden="true">
          {TEXT.markSizeLabel}
        </span>
        {(["l", "m", "s"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={markSize === k} onClick={() => pickMarkSize(k)}>
            {TEXT.markSizeNames[k]}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="map-page" data-section={section}>
      {section === "now" || section === "season" ? <SectionTabs group="now" /> : null}
      {section === "compare" || section === "town" ? <SectionTabs group="past" /> : null}
      <h1 ref={h1Ref}>{section === "now" || section === "all" ? `${view.label}の発生状況` : SECTION_TITLE[section]}</h1>
      {/* 比べは、どちらかが今季なら今季の時点、どちらも過去なら過去の記録の断り */}
      {section === "town" ? null : section === "compare" ? (
        shownViews.some((v) => v.isCurrent) ? (
          <WatchAsOf loaded={d.watchLoaded} line={d.watch} />
        ) : (
          <p className="as-of">{TEXT.pastAsOf}</p>
        )
      ) : view.isCurrent ? (
        <WatchAsOf loaded={d.watchLoaded} line={d.watch} />
      ) : (
        <>
          <p className="as-of">{TEXT.pastAsOf}</p>
          <p className="as-of">
            {view.season}年6月〜{view.season + 1}年5月の記録
          </p>
        </>
      )}
      {/* 地域が未選択のときは、町を選ぶ案内を時点のすぐ下に帯で置く。数字の欄と地図より先に読まれるように（2026-11-07 作者の決定 案 A）。
          守る文は札のすぐ前のまま（この帯はその前に置く） */}
      {/* 直近 14 日の発生の赤い枠（2026-11-07 作者の決定）。最初の地図の画面だけ。再現は日付を過去に置いた画面なので出さない。
          地域を選ぶ帯より前で、守る文と札の並び（守る文は札のすぐ前）には入らない */}
      {section === "now" && ds.mode !== "replay" ? (
        <RecentAlert
          items={recentItems}
          today={today}
          limit={narrow ? 3 : 5}
          compact={narrow}
          uncheckedNote={[d.watchLoaded && failedCount > 0 ? TEXT.watchShortWho(failedWho) : null, d.wildBirdsLoaded ? null : TEXT.recentAlertBirdsPending].filter(Boolean).join("") || null}
        />
      ) : null}
      {promptTop ? banner : null}

      {shownViews.some((v) => v.isCurrent && !v.loaded) ? (
        <p className="state-unknown" role="status">
          今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。
          {d.casesSlow ? <> {TEXT.slowLoad}</> : null}
        </p>
      ) : null}
      {shownViews.some((v) => !v.isCurrent && !v.loaded) ? (
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
      {section !== "town" && shownViews.some((v) => v.isCurrent) && !watchAfterMap ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}
      {section !== "town" && reviewingShown.length > 0 ? (
        <p className="state-wait">
          確認中の発表がある県: {names(reviewingShown)}
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
      {inMap && riskAboveStats ? riskText("map-notice map-risk", narrow) : null}
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
          <div className={currentBar.unchecked && !currentBar.allUnchecked ? "stat stat-wide stat-national" : "stat stat-national"}>
            <p className="stat-title">{TEXT.statNational}</p>
            <StatCount text={countText(currentBar)} />
            {whenLine(casesSource)}
          </div>
          {repeatsHead(recentText) ? null : (
            <div className={needsWide ? "stat stat-wide stat-recent" : "stat stat-recent"}>
              <p className="stat-title">
                <span className="stat-long">{TEXT.statFarmLead}</span>
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
          {/* 野鳥の陽性（2026-11-07 作者の決定）。数は全国で、鶏舎の付近・選択地域を見ていても同じ。地図の外の発生も県名で分かるようにする。
              再現は日付を過去に置いた画面なので出さない。/season の札（下の残りの札）と二重に出さないよう、数字の欄があるときはここだけ */}
          {/* 47 県とも未確認で野鳥も 0 件なら出さない（全国の札と同じ「まだ確認できていません」を繰り返さない）。
              スマホで未確認の県がある朝は、大きな数字に素の数を出さない決まり（数字の 1 行）に合わせて太字にしない */}
          {ds.mode === "replay" || (noneConfirmed && d.wildBirdsLoaded && birdCounts.total === 0) ? null : (
            <div className="stat stat-birds">
              <p className="stat-title">
                {TEXT.statBirdsShort}
                <span className="stat-long">{TEXT.statBirds.slice(TEXT.statBirdsShort.length)}</span>
              </p>
              {narrow && failedCount > 0 ? <p className="stat-value is-sentence">{birdText}</p> : <StatCount text={birdText} />}
              {d.wildBirdsLoaded && birdPrefs !== null ? <p className="stat-note stat-birds-where">{birdPrefs}</p> : null}
              {whenLine(TEXT.statBirdsWhen)}
            </div>
          )}
        </div>
      ) : null}
      {section === "town" ? (
        <TownBanner {...bannerProps} part="all" nameAction={town !== null ? picker : undefined}>
          {town === null ? picker : null}
        </TownBanner>
      ) : null}
      {inMap && townLead ? <TownBanner {...bannerProps} part="lead" hideNationalHead={section === "now"} /> : null}
      {inMap && !promptTop && !bannerSlotAfterMap ? banner : null}

      {showMap ? (
        <>
      {section === "compare" ? (
        <ScopeButtons
          hasNear={town !== null}
          nearIsFarm={ownFarm}
          picked={cmpScope}
          onNear={() => {
            userScoped.current = true;
            setCmpScope("near");
            pendingRegion.current = null;
            showNear();
          }}
          onJapan={() => {
            userScoped.current = true;
            setCmpScope("japan");
            pendingRegion.current = null;
            moveTo("japan", []);
          }}
          onRegion={goRegion}
        />
      ) : town !== null ? (
        <div className="map-scope" role="group" aria-label={TEXT.mapScopeAria}>
          <button type="button" aria-pressed={showingNear} onClick={showNear}>
            {ownFarm ? TEXT.mapNearFarm : TEXT.mapNear}
          </button>
          <button type="button" aria-pressed={!showingNear} onClick={() => moveTo("japan", [])}>
            {TEXT.japan}
          </button>
        </div>
      ) : null}

      {section === "compare" ? (
        <CompareOverlay
          options={d.bars}
          seasons={cmpSeasons}
          onSeasons={pickCmpSeasons}
          current={d.current}
          currentCases={d.currentCases}
          history={d.history}
          historyFailed={d.historyFailed}
          onRetryHistory={d.retryHistory}
          asOf={d.asOf}
          failedPrefCodes={d.failedPrefCodes}
          views={cmpViews}
          focus={focus}
          muniName={(c) => (geo ? (geo.index[c]?.name ?? null) : null)}
          renderMap={(o) => (
            <MapChunkBoundary>
              <Suspense fallback={<p role="status">地図を読み込んでいます</p>}>
                <MapView
                  view={view}
                  wildBirds={d.wildBirds}
                  failedPrefCodes={d.failedPrefCodes}
                  myMuniCode={town}
                  nearMuniCodes={townLine.nearMuniCodes}
                  farmMeshCode={farmMeshCode}
                  markFarm={ownFarm}
                  ringCenter={ringCenter}
                  onInspectMuni={o.onInspectMuni}
                  focus={o.focus}
                  onUnsupported={() => setMapless(true)}
                  ariaLabel={o.ariaLabel}
                  overlay={o.overlay}
                  latest={o.latest}
                  pickedMuni={o.picked}
                />
              </Suspense>
            </MapChunkBoundary>
          )}
        />
      ) : (
      <>
      {/* 選ぶ間は、地図を押すと自分の町になる。地図のすぐ上でそれを示す（設計書 2026-11-06-town-picker D6）。代わりの地図は中に案内がある */}
      {picking && canEdit && !mapless ? (
        <div className="picking-bar" role="status">
          <p>{TEXT.pickingBar}</p>
          <button type="button" className="btn" onClick={() => setPickingOpen(false)}>
            {TEXT.cancel}
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
              markFarm={ownFarm}
              farmMarkSize={markSize}
              farmOaza={spotState.spotOaza}
              ringCenter={ringCenter}
              onInspectMuni={section === "now" && !(picking && canEdit) && !aiming ? setInspected : undefined}
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
        {/* 鶏舎の印の大きさ（見た目だけ）。PC は地図の右上に置く。スマホは距離の輪の札に重なるので、地図の枠の外に置く（下の輪の断りの後。2026-11-07 精査 M4） */}
        {narrow ? null : markSizeGroup}
        {/* 町を選ぶ前は切り替えがないので、拡大の後に全国へ戻る口を地図の隅に置く */}
        {narrow && town === null && !mapless ? (
          <button type="button" className="map-home-btn" onClick={() => moveTo("japan", [])}>
            {TEXT.japan}
          </button>
        ) : null}
        {showBirdsFar || showUnmarked ? (
          <div className="map-bands">
            {showBirdsFar ? (
              <div className="near-birds">
                <p>
                  {TEXT.nearBirdsLead}
                  <span className="near-birds-prefs">{birdsFar}</span>
                </p>
                <button type="button" onClick={() => moveTo("japan", [])}>
                  {TEXT.nearUnmarkedJapan}
                </button>
              </div>
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
        ) : null}
      </div>
      </>
      )}

      {nearCount === 0 ? <p className="map-disclaimer">{TEXT.nearNone}</p> : null}
      {farmMeshCode !== null ? <p className="map-ring-note">{TEXT.ringNote}</p> : ringCenter !== null ? <p className="map-ring-note">{TEXT.ringNoteTown}</p> : null}
      {/* スマホの印の大きさは、地図のすぐ下の「確認されていません」と輪の断りの後ろ（最初の画面に入れる文を押し下げない。shell.spec） */}
      {narrow && section !== "compare" ? markSizeGroup : null}
      {/* スマホの札の前の短い守る文の出典の名前。URL は本文に出さず、名前をリンクにする */}
      {narrow && riskAboveStats ? <RiskSource className="map-risk-source" /> : null}
      {watchAfterMap ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}
      {inMap && showStats && hasFrequent ? <div className="stat-below">{frequentStat}</div> : null}
      {inMap && !promptTop && bannerSlotAfterMap ? banner : null}
      {/* 右の欄（設計書 2026-11-06-ui-frame 4.1）: ふだんは自分の町の 1 文。町を押すとその町の事例に替わる（map.css で町の文を隠す） */}
      {section === "now" ? (
        <TownCasesPanel
          muniCode={inspected}
          muniName={inspected && geo ? (geo.index[inspected]?.name ?? null) : null}
          currentCases={d.currentCases}
          history={d.history}
          historyFailed={d.historyFailed}
          onRetryHistory={d.retryHistory}
          current={d.current}
          asOf={d.asOf}
          wildBirds={ds.mode === "replay" || !d.wildBirdsLoaded ? null : d.wildBirds}
          hasTown={town !== null}
          onClose={() => setInspected(null)}
        />
      ) : null}
      {section === "compare" ? null : <Legend isCurrent={view.isCurrent} farm={!ownFarm ? null : spotState.source === "farm" ? "farm" : "device"} />}

      {mapless ? null : (
        <p className="map-attribution">
          {MAP_ATTRIBUTION.map((html, i) => (
            // 出典の文は geo/attribution.ts の固定の文（外からの入力を含まない）
            <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </p>
      )}

        </>
      ) : null}

      {/* 比べ（/compare）は「どこで」を見る地図の画面にし、事例の一覧・シーズンの棒・月の棒は「数で見る」に任せる（2026-11-07 作者の決定 案 A） */}
      {section === "season" || section === "all" ? (
      <CaseListSheet
        rows={rows}
        birds={view.isCurrent ? birdRows : null}
        loaded={d.listCases !== null}
        unwatchedCount={view.isCurrent ? d.failedPrefCodes.length : 0}
      />
      ) : null}

      {showStats && ((inMap && narrow && pastStat !== null) || (ds.mode !== "replay" && section === "season")) ? (
        <div className="stat-rest">
          {inMap && narrow ? pastStat : null}
          {/* 数字の欄（/ と all）には野鳥の札があるので、ここは /season だけ */}
          {ds.mode === "replay" || section !== "season" ? null : (
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

      {section === "all" ? <SeasonBar bars={bars} selected={d.selected} onSelect={selectSeason} current={d.current} /> : null}

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
          brief={section === "compare"}
        />
      )}

      {section === "compare" ? <ExploreLink region={cmpScope === "japan" ? null : cmpScope === "near" ? nearRegion : cmpScope} /> : null}

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
          note={riskAboveStats || lineHasRisk || bandRisk ? null : riskText("map-notice")}
        />
      ) : null}

      {/* 比べ（/compare）は選んだシーズンのどれかが過去なら出す（シーズンの棒を外したので view は今季のまま。2026-11-07 点検の指摘） */}
      {(section === "compare" ? shownViews.some((v) => !v.isCurrent && v.loaded) : !view.isCurrent && view.loaded && section !== "town") ? (
        <p className="map-notice">{FIXED_TEXT.pastDisclaimer}</p>
      ) : null}
      {view.undatedCases > 0 && (section === "season" || section === "all") ? (
        <p className="map-note">日付のない事例が {view.undatedCases} 件あり、月の棒には入っていません。</p>
      ) : null}

      {section === "season" || section === "all" ? (
        <MonthBars months={view.months} loaded={view.loaded} allUnchecked={view.isCurrent && noneConfirmed} past={!view.isCurrent} />
      ) : null}
      {/* 過去の行が出ていれば、その中に「選択地域の過去を見る」があるので、地図の下には重ねない（2026-11-07 精査 M3） */}
      {section === "now" ? <NextLinks hideTown={town !== null && past.status === "ready"} /> : null}
      {section === "all" ? <MapLinks /> : null}
    </div>
  );
}
