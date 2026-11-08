// 再現の時計の操作（前へ・次へ、今の出来事、このときメールが届く、出典、日付の一覧）。
// 去年の再現の画面（/replay）と、近くで発生した場合の見え方（/sample）が使う。ReplayPage から分けたのは、
// /sample が再現の画面を丸ごと読み込まないようにするため（2026-11-08）。
import { distanceToMuniKm } from "@hpai/shared/geo";
import { isWithinDistanceBand } from "@hpai/shared/level";
import { eventStage, NATIONAL_FLOW_ID, type ReplayEvent, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Fold } from "../../ui/Fold";
import { useGeoStore } from "../map/useTownView";
import { eventLabel, farmDistanceText, formatMonthDay, isDefaultSpot } from "./replayEngine";
import type { ReplayDataSource } from "./ReplayDataSource";

export type View = "zone" | "own";
export type Flow = "cases" | "national";
export type FlowStatus = "idle" | "loading" | "failed" | "ready";

/** 去年の再現の画面だけが持つ切り替え（流れ、見る場所）と、舞台裏・近くで発生した場合の見え方へのリンク */
export interface ReplaySwitches {
  view: View;
  canOwn: boolean;
  onView: (v: View) => void;
  flow: Flow;
  flowStatus: FlowStatus;
  onFlow: (f: Flow) => void;
}

/** 去年の再現の画面から、近くで発生した場合の見え方（/sample）へのリンクの名前 */
export const NEAR_LINK_LABEL = "近くで発生した場合の見え方";

/** 全国の流れの出来事の町が、地点から約 60km 以内なら距離を返す。外の町、計算の前、形を読めないときは null */
function useBandDistance(current: ReplayEvent | null, spot: FarmPoint, enabled: boolean): number | null {
  const { geo } = useGeoStore();
  const [res, setRes] = useState<{ key: string; km: number } | null>(null);
  const muni = enabled ? (current?.caseAfter.muniCode ?? null) : null;
  const meshCode = spot.meshCode;
  const key = `${meshCode}/${muni}`;
  useEffect(() => {
    if (!geo || muni === null) return;
    let off = false;
    geo.ensurePrefs([geo.index[muni]?.prefCode ?? muni.slice(0, 2)]).then(
      () => {
        if (!off) setRes({ key, km: distanceToMuniKm(meshCode, muni, geo) });
      },
      () => {
        // 形を読めないことは、地図の札（約 60km 以内）が「読めませんでした」で知らせる
      },
    );
    return () => {
      off = true;
    };
  }, [geo, muni, meshCode, key]);
  return muni !== null && res?.key === key && isWithinDistanceBand(res.km) ? res.km : null;
}

/**
 * 再現の時計の操作。switches を渡さないとき（/sample）は、12 月の 4 事例を仮の地点（見本の農場の鶏舎の場所）で見るだけで、
 * 流れと見る場所の切り替え、舞台裏へのリンクを出さない。
 */
export function ReplayControls({
  scenario,
  dataSource,
  spot,
  heading,
  switches,
}: {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  spot: FarmPoint;
  /** 読み上げだけの見出し（h1）。見た目は帯が見せている */
  heading: string;
  switches?: ReplaySwitches;
}) {
  const order = useSyncExternalStore(dataSource.subscribeOrder, dataSource.currentOrder);
  const total = scenario.events.length;
  const current = order > 0 ? scenario.events[order - 1]! : null;
  const seek = useCallback((n: number) => dataSource.seek(n), [dataSource]);
  const preview = current?.noticePreview ?? null;
  const isNational = scenario.id === NATIONAL_FLOW_ID;
  const bandKm = useBandDistance(current, spot, isNational);
  const view: View = switches?.view ?? "zone";

  return (
    <>
      <div className="replay-top">
        <h1 className="replay-heading">{heading}</h1>
        <div className="replay-bar">
          {switches ? (
            <div role="group" aria-label="再現の範囲" className="replay-switch">
              <button type="button" className="btn" aria-pressed={switches.flow === "cases"} onClick={() => switches.onFlow("cases")}>
                12 月の 4 事例
              </button>
              <button type="button" className="btn" aria-pressed={switches.flow === "national"} onClick={() => switches.onFlow("national")}>
                全国の流れ
              </button>
            </div>
          ) : null}
          <div className="replay-steps">
            <button type="button" className="btn" disabled={order === 0} onClick={() => seek(order - 1)}>
              前へ
            </button>
            <button type="button" className="btn btn-primary" disabled={order === total} onClick={() => seek(order + 1)}>
              次へ
            </button>
          </div>
        </div>
        {switches?.flowStatus === "loading" ? <p role="status">全国の流れを読み込んでいます</p> : null}
        {switches?.flowStatus === "failed" ? <p role="status">全国の流れを読み込めませんでした。もう一度押してください。</p> : null}
        <div className="replay-now-row">
          <p className="replay-position">{`${order} / ${total}`}</p>
          <p className="replay-now" aria-live="polite">
            {current ? eventLabel(current) : "はじまり（最初の発表の前）"}
            {bandKm !== null ? `。${farmDistanceText(bandKm, isDefaultSpot(scenario, spot))}` : null}
          </p>
        </div>
      </div>

      <div className="replay-below">
        {isNational ? <p className="replay-hint">全国の流れでは、メールの下書きは出しません。</p> : null}
        {!isNational && view === "zone" && preview ? (
          <section className="replay-mail" aria-label="このときメールが届く">
            <h2>このときメールが届く</h2>
            <p>{preview.text}</p>
            <p className="replay-hint">再現では実際には送りません。</p>
          </section>
        ) : null}
        {!isNational && view === "zone" && current && !preview ? <p className="replay-hint">この出来事では、この地点にメールは届きません。</p> : null}
        {!isNational && view === "own" ? <p className="replay-hint">選んだ地域では、メールの下書きは出しません。</p> : null}
        {current ? (
          <p className="replay-source">
            {formatMonthDay(current.date)}の出来事の出典:{" "}
            <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer">
              {new URL(current.sourceUrl).hostname}
            </a>
            {eventStage(current) === "suspected" ? "（県の対策本部会議の資料）" : ""}
          </p>
        ) : null}

        <Fold summary="日付の一覧から選ぶ">
          <ol className="replay-list" aria-label="日付の一覧">
            <li>
              <button type="button" className="replay-item" aria-pressed={order === 0} onClick={() => seek(0)}>
                はじまり（最初の発表の前）
              </button>
            </li>
            {scenario.events.map((e) => (
              <li key={e.order}>
                <button type="button" className="replay-item" aria-pressed={order === e.order} onClick={() => seek(e.order)}>
                  {eventLabel(e)}
                </button>
              </li>
            ))}
          </ol>
        </Fold>

        {switches ? (
          <>
            <div role="group" aria-label="見る場所" className="replay-switch">
              <button type="button" className="btn" aria-pressed={view === "zone"} onClick={() => switches.onView("zone")}>
                {isNational ? "作者の村から見る" : "もし区域の近くの農場なら"}
              </button>
              <button type="button" className="btn" aria-pressed={view === "own"} disabled={!switches.canOwn} onClick={() => switches.onView("own")}>
                選んだ地域で見る
              </button>
            </div>
            {!switches.canOwn ? (
              <p className="replay-hint">
                選んだ地域で見るには、<Link to="/">地図</Link>で自分の場所を決めてください（この端末の中にだけ保存されます）。
              </p>
            ) : null}
            <p className="replay-hint">
              <Link to="/replay/backstage">舞台裏（AI が読んだ結果と、プログラムの検査）を見る</Link>
              {" / "}
              <Link to="/sample">{NEAR_LINK_LABEL}</Link>
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}
