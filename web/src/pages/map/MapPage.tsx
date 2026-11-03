import { PREFS } from "@hpai/shared/pref";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { lazy, Suspense } from "react";
import { AsOf } from "../../ui/AsOf";
import { MapLinks } from "./MapLinks";
import { MonthBars } from "./MonthBars";
import { SeasonBar } from "./SeasonBar";
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
  const noneConfirmed = d.failedPrefCodes.length === PREFS.length;
  // 確認できていない県があるうちは、今季の件数を「確認できた範囲では N 件（M 県は確認できていません）」にする。
  // 47 県とも（見回りの結果が未着のときを含む）確認できていなければ、件数を見出しにしない
  const bars = d.bars.map((b) =>
    b.season === d.current && d.failedPrefCodes.length > 0
      ? { ...b, unchecked: d.failedPrefCodes.length, allUnchecked: noneConfirmed }
      : b,
  );

  return (
    <div className="map-page">
      <h1>{view.label}の発生状況</h1>
      {view.isCurrent ? (
        <AsOf iso={d.asOf} />
      ) : (
        <p className="as-of">
          {view.season}年6月〜{view.season + 1}年5月の記録
        </p>
      )}

      <div className="map-box">
        <Suspense fallback={<p role="status">地図を読み込んでいます</p>}>
          <MapView
            view={view}
            wildBirds={d.wildBirds}
            failedPrefCodes={d.failedPrefCodes}
            myMuniCode={null}
            nearMuniCodes={[]}
            focus={null}
          />
        </Suspense>
      </div>

      <ul className="map-legend" aria-label="地図の見方">
        <li>
          <span className={`swatch swatch-solid${view.isCurrent ? "" : " is-past"}`} aria-hidden="true" />
          確定
        </li>
        <li>
          <span className={`swatch swatch-hatch${view.isCurrent ? "" : " is-past"}`} aria-hidden="true" />
          疑い
        </li>
        <li>
          <span className="swatch swatch-unwatched" aria-hidden="true" />
          確認できていない県
        </li>
        <li>
          <span className="swatch swatch-ring" aria-hidden="true" />
          野鳥の検査中
        </li>
        <li>
          <span className="swatch swatch-square" aria-hidden="true" />
          野鳥の高病原性の確定
        </li>
      </ul>
      <p className="map-note">色がない場所は、発生の報告がないだけです。これから出ないという意味ではありません。</p>

      {view.isCurrent && !view.loaded ? (
        <p className="map-status" role="status">
          今季の発生をまだ読めていません。読めるまで、地図に色がなくても発生がないとは言えません。
        </p>
      ) : null}
      {!view.isCurrent && !view.loaded ? (
        <p className="map-status" role="status">
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
      {view.isCurrent && !d.watchLoaded ? (
        <p className="map-status" role="status">
          見回りの結果をまだ読めていません。斜線の県は確認できていません。
        </p>
      ) : null}
      {view.isCurrent && d.watchLoaded && d.failedPrefCodes.length > 0 ? (
        <p className="map-status" role="status">
          {noneConfirmed ? "どの県も確認できていません（地図の斜線）。" : `確認できていない県（地図の斜線）: ${names(d.failedPrefCodes)}。`}
        </p>
      ) : null}
      {view.reviewingPrefCodes.length > 0 ? (
        <p className="map-status">確認中の発表がある県: {names(view.reviewingPrefCodes)}。件数にはまだ入れていません。</p>
      ) : null}

      <SeasonBar bars={bars} selected={d.selected} onSelect={d.select} />

      {!view.isCurrent && view.loaded ? <p className="map-notice">{FIXED_TEXT.pastDisclaimer}</p> : null}
      {view.isCurrent && view.loaded && view.total === 0 ? <p className="map-notice">{FIXED_TEXT.riskAnywhere}</p> : null}
      {view.undatedCases > 0 ? <p className="map-note">日付のない事例が {view.undatedCases} 件あり、月の棒には入っていません。</p> : null}

      <MonthBars months={view.months} loaded={view.loaded} />
      <MapLinks />
    </div>
  );
}
