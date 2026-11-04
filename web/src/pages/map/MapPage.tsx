import { jstDateOf } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { MuniCode } from "@hpai/shared/types";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_ATTRIBUTION } from "../../geo/attribution";
import { useDataSource } from "../../data/context";
import { useSpotState } from "../../data/spotContext";
import type { MapViewProps } from "./MapView";
import { CaseListSheet } from "./CaseListSheet";
import { Legend } from "./Legend";
import { listRows, wildBirdRows } from "./listRows";
import { MapChunkBoundary } from "./MapChunkBoundary";
import { MapLinks } from "./MapLinks";
import { MonthBars } from "./MonthBars";
import type { PickTarget } from "./pickSpot";
import { SeasonBar } from "./SeasonBar";
import { SeasonCompare } from "./SeasonCompare";
import { SpotPicker } from "./SpotPicker";
import { TEXT } from "./texts";
import { TownBanner } from "./TownBanner";
import { TownPicker } from "./TownPicker";
import { useGeoStore, usePast, useTownLine } from "./useTownView";
import { WatchAsOf, WatchLine } from "./WatchLine";
import { useSeasonData } from "./useSeasonData";
import "./map.css";

// 地図（maplibre）は重いので、画面を開いてから別の chunk で読む
const MapView = lazy(() => import("./MapView"));

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const names = (codes: readonly string[]) => codes.map((c) => PREF_NAME.get(c) ?? c).join("、");

/** 入口の画面。上から 地図、シーズンの棒、月別、固定のリンク。塗りがないことを「何もない」と読ませない */
export default function MapPage() {
  const d = useSeasonData();
  const { view } = d;
  const ds = useDataSource();
  const spotState = useSpotState();
  const { geo, failed: geoFailed } = useGeoStore();

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
  const moveTo = useCallback((kind: "japan" | "muni", codes: MuniCode[]) => {
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

  return (
    <div className="map-page">
      <h1 ref={h1Ref}>{view.label}の発生状況</h1>
      {view.isCurrent ? (
        <WatchAsOf loaded={d.watchLoaded} line={d.watch} />
      ) : (
        <>
          <p className="as-of">{TEXT.pastAsOf}</p>
          <p className="as-of">
            {view.season}年6月〜{view.season + 1}年5月の記録
          </p>
        </>
      )}

      <TownBanner
        muniCode={town}
        muniName={townName}
        loaded={d.currentCases !== null}
        line={townLine.line}
        lineFailed={townLine.failed || (town !== null && geoFailed)}
        past={past}
        showPastDisclaimer={view.isCurrent || !view.loaded}
      >
        <TownPicker
          geo={geo}
          geoFailed={geoFailed}
          town={town}
          readOnly={spotState.readOnly}
          readOnlyNote={spotState.source === "fixed" ? TEXT.spotFixed : undefined}
          picking={picking}
          onPickingChange={setPickingOpen}
          onChoose={choose}
          onShowJapan={() => moveTo("japan", [])}
          onShowTown={() => town && moveTo("muni", [town])}
        />
        {notice ? <p role="status">{notice}</p> : null}
      </TownBanner>

      <div className="map-box" ref={boxRef}>
        <MapChunkBoundary>
          <Suspense fallback={<p role="status">地図を読み込んでいます</p>}>
            <MapView
              view={view}
              wildBirds={d.wildBirds}
              failedPrefCodes={d.failedPrefCodes}
              myMuniCode={town}
              nearMuniCodes={townLine.nearMuniCodes}
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
      </div>

      <p className="map-disclaimer">色がない場所は、発生の報告がないだけです。これから出ないという意味ではありません。</p>
      <Legend isCurrent={view.isCurrent} />

      {view.isCurrent && !view.loaded ? (
        <p className="state-unknown" role="status">
          今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。
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
      {view.isCurrent ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}
      {view.reviewingPrefCodes.length > 0 ? (
        <p className="state-wait">
          確認中の発表がある県: {names(view.reviewingPrefCodes)}
          。件数にはまだ入れていません。
        </p>
      ) : null}
      {mapless ? null : (
        <p className="map-attribution">
          {MAP_ATTRIBUTION.map((html, i) => (
            // 出典の文は geo/attribution.ts の固定の文（外からの入力を含まない）
            <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </p>
      )}

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

      <CaseListSheet
        rows={rows}
        birds={view.isCurrent ? birdRows : null}
        loaded={d.listCases !== null}
        unwatchedCount={view.isCurrent ? d.failedPrefCodes.length : 0}
      />

      <SeasonBar bars={bars} selected={d.selected} onSelect={selectSeason} />

      {/* 再現（去年の再現）は日付を過去に置いた画面なので、今日の比べは出さない */}
      {ds.mode === "replay" ? null : (
        <SeasonCompare
          today={jstDateOf(now)}
          current={d.current}
          currentCases={d.currentCases}
          history={d.history}
          historyFailed={d.historyFailed}
          asOf={d.asOf}
          unchecked={d.failedPrefCodes.length}
          allUnchecked={noneConfirmed}
        />
      )}

      {!view.isCurrent && view.loaded ? <p className="map-notice">{FIXED_TEXT.pastDisclaimer}</p> : null}
      {view.isCurrent && view.loaded && view.total === 0 && !townLine.line?.details.includes(FIXED_TEXT.riskAnywhere) ? (
        <p className="map-notice">{FIXED_TEXT.riskAnywhere}</p>
      ) : null}
      {view.undatedCases > 0 ? <p className="map-note">日付のない事例が {view.undatedCases} 件あり、月の棒には入っていません。</p> : null}

      <MonthBars months={view.months} loaded={view.loaded} allUnchecked={view.isCurrent && noneConfirmed} />
      <MapLinks />
    </div>
  );
}
