// /replay: 去年 12 月の 4 事例を、時刻どおりに流す。そのとき作品があったら何が見えたかを示す（設計書 §17）。
// 切り替えで、2025 年シーズンの全国の発生を日付の順に流す（全国の流れ）。過去の記録を読むだけで、シナリオの形は同じ。
// 審査員の操作で Claude も Firestore も呼ばない。読むのは 再現のデータ（静的ファイル）と 過去の記録だけ。
import { distanceToMuniKm } from "@hpai/shared/geo";
import { isWithinDistanceBand } from "@hpai/shared/level";
import { eventStage, NATIONAL_FLOW_ID, nationalFlowScenario, type ReplayEvent, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint, HistoryCase } from "@hpai/shared/types";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { fetchHistory } from "../../data/history";
import { loadSpot } from "../../data/spot";
import { Fold } from "../../ui/Fold";
import MapPage from "../map/MapPage";
import { useGeoStore } from "../map/useTownView";
import { eventLabel, farmDistanceText, formatMonthDay, isDefaultSpot } from "./replayEngine";
import { ReplayDataSource } from "./ReplayDataSource";
import { ReplayFrame } from "./ReplayFrame";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; scenario: ReplayScenario };

async function fetchScenario(): Promise<ReplayScenario> {
  const res = await fetch(`${import.meta.env.BASE_URL}replay/scenario.json`);
  if (!res.ok) throw new Error(`再現のデータを読めませんでした（${res.status}）`);
  return (await res.json()) as ReplayScenario;
}

export default function ReplayPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setLoad({ status: "loading" });
    fetchScenario().then(
      (scenario) => {
        if (!off) setLoad({ status: "ready", scenario });
      },
      () => {
        if (!off) setLoad({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [attempt]);

  if (load.status === "loading") return <p role="status">再現を読み込んでいます</p>;
  if (load.status === "failed") {
    return (
      <div>
        <h1>去年の再現</h1>
        <p role="status">再現のデータを読めませんでした。</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読む
        </button>
      </div>
    );
  }
  return <ReplayReady scenario={load.scenario} />;
}

type View = "zone" | "own";
type Flow = "cases" | "national";
type NationalLoad = { status: "idle" | "loading" | "failed" } | { status: "ready"; scenario: ReplayScenario; history: HistoryCase[] };

function ReplayReady({ scenario: casesScenario }: { scenario: ReplayScenario }) {
  const [wanted, setWanted] = useState<Flow>("cases");
  const [national, setNational] = useState<NationalLoad>({ status: "idle" });
  const needLoad = wanted === "national" && national.status !== "ready";

  useEffect(() => {
    if (!needLoad) return;
    let off = false;
    setNational({ status: "loading" });
    fetchHistory()
      .then((history) => ({ status: "ready" as const, scenario: nationalFlowScenario(history, casesScenario), history }))
      .then(
        (ready) => {
          if (!off) setNational(ready);
        },
        () => {
          if (!off) {
            setNational({ status: "failed" });
            setWanted("cases");
          }
        },
      );
    return () => {
      off = true;
    };
  }, [needLoad, casesScenario]);

  const casesSource = useMemo(() => new ReplayDataSource(casesScenario, fetchHistory), [casesScenario]);
  const nationalReady = national.status === "ready" ? national : null;
  const nationalSource = useMemo(() => (nationalReady ? new ReplayDataSource(nationalReady.scenario, () => Promise.resolve(nationalReady.history)) : null), [nationalReady]);
  // 読み終わるまでは 4 事例のまま（空の画面にしない）
  const flow: Flow = wanted === "national" && nationalSource ? "national" : "cases";
  const scenario = flow === "national" && nationalReady ? nationalReady.scenario : casesScenario;
  const dataSource = flow === "national" && nationalSource ? nationalSource : casesSource;
  const chooseFlow = (f: Flow) => {
    if (f === "cases" && national.status !== "ready") setNational({ status: "idle" });
    setWanted(f);
  };

  // 端末内の地点は読むだけ（hpai.spot.v1 には書かない）。なければ『自分の町で見る』は押せない
  const [deviceSpot] = useState<FarmPoint | null>(() => loadSpot());
  const [view, setView] = useState<View>("zone");
  const spot = view === "own" && deviceSpot ? deviceSpot : scenario.defaultSpot;

  return (
    <ReplayFrame scenario={scenario} dataSource={dataSource} spot={spot}>
      {/* 操作の後ろの部分は、replay.css が地図の下へ動かす（地図の画面を変えずに、地図を最初の画面に入れる） */}
      <div className="replay-stage">
        <ReplayControls
          scenario={scenario}
          dataSource={dataSource}
          view={view}
          canOwn={deviceSpot !== null}
          onView={setView}
          spot={spot}
          flow={flow}
          flowStatus={national.status}
          onFlow={chooseFlow}
        />
        {/* 流れを替えたら、地図の状態（選んだシーズン、見る場所、数え終えた件数）を持ち越さない */}
        <MapPage key={flow} replayStats={flow === "national"} />
      </div>
    </ReplayFrame>
  );
}

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

function ReplayControls({
  scenario,
  dataSource,
  view,
  canOwn,
  onView,
  spot,
  flow,
  flowStatus,
  onFlow,
}: {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  view: View;
  canOwn: boolean;
  onView: (v: View) => void;
  spot: FarmPoint;
  flow: Flow;
  flowStatus: NationalLoad["status"];
  onFlow: (f: Flow) => void;
}) {
  const order = useSyncExternalStore(dataSource.subscribeOrder, dataSource.currentOrder);
  const total = scenario.events.length;
  const current = order > 0 ? scenario.events[order - 1]! : null;
  const seek = useCallback((n: number) => dataSource.seek(n), [dataSource]);
  const preview = current?.noticePreview ?? null;
  const isNational = scenario.id === NATIONAL_FLOW_ID;
  const bandKm = useBandDistance(current, spot, isNational);

  return (
    <>
      <div className="replay-top">
        <h1 className="replay-heading">去年の再現（2025 年シーズンの発生状況）</h1>
        <div className="replay-bar">
          <div role="group" aria-label="再現の範囲" className="replay-switch">
            <button type="button" className="btn" aria-pressed={flow === "cases"} onClick={() => onFlow("cases")}>
              12 月の 4 事例
            </button>
            <button type="button" className="btn" aria-pressed={flow === "national"} onClick={() => onFlow("national")}>
              全国の流れ
            </button>
          </div>
          <div className="replay-steps">
            <button type="button" className="btn" disabled={order === 0} onClick={() => seek(order - 1)}>
              前へ
            </button>
            <button type="button" className="btn btn-primary" disabled={order === total} onClick={() => seek(order + 1)}>
              次へ
            </button>
          </div>
        </div>
        {flowStatus === "loading" ? <p role="status">全国の流れを読み込んでいます</p> : null}
        {flowStatus === "failed" ? <p role="status">全国の流れを読めませんでした。もう一度押してください。</p> : null}
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
        {!isNational && view === "own" ? <p className="replay-hint">自分の町では、メールの下書きは出しません。</p> : null}
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

        <div role="group" aria-label="見る場所" className="replay-switch">
          <button type="button" className="btn" aria-pressed={view === "zone"} onClick={() => onView("zone")}>
            {isNational ? "作者の村から見る" : "もし区域の近くの農場なら"}
          </button>
          <button type="button" className="btn" aria-pressed={view === "own"} disabled={!canOwn} onClick={() => onView("own")}>
            自分の町で見る
          </button>
        </div>
        {!canOwn ? <p className="replay-hint">自分の町で見るには、<Link to="/">地図</Link>で自分の場所を決めてください（この端末の中にだけ保存されます）。</p> : null}
        <p className="replay-hint">
          <Link to="/replay/backstage">舞台裏（AI が読んだ結果と、プログラムの検査）を見る</Link>
          {" / "}
          <Link to="/sample">見本の農場で試す</Link>
        </p>
      </div>
    </>
  );
}
