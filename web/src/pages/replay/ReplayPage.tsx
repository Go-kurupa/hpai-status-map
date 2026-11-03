// /replay: 去年 12 月の 4 事例を、時刻どおりに流す。そのとき作品があったら何が見えたかを示す（設計書 §17）。
// 審査員の操作で Claude も Firestore も呼ばない。読むのは 再現のデータ（静的ファイル）と 過去の記録だけ。
import { eventStage, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchHistory } from "../../data/history";
import { loadSpot } from "../../data/spot";
import MapPage from "../map/MapPage";
import { eventLabel, formatMonthDay } from "./replayEngine";
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

function ReplayReady({ scenario }: { scenario: ReplayScenario }) {
  const dataSource = useMemo(() => new ReplayDataSource(scenario, fetchHistory), [scenario]);
  // 端末内の地点は読むだけ（hpai.spot.v1 には書かない）。なければ『自分の町で見る』は押せない
  const [deviceSpot] = useState<FarmPoint | null>(() => loadSpot());
  const [view, setView] = useState<View>("zone");
  const spot = view === "own" && deviceSpot ? deviceSpot : scenario.defaultSpot;

  return (
    <ReplayFrame scenario={scenario} dataSource={dataSource} spot={spot}>
      <ReplayControls scenario={scenario} dataSource={dataSource} view={view} canOwn={deviceSpot !== null} onView={setView} />
      <MapPage />
    </ReplayFrame>
  );
}

function ReplayControls({
  scenario,
  dataSource,
  view,
  canOwn,
  onView,
}: {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  view: View;
  canOwn: boolean;
  onView: (v: View) => void;
}) {
  const order = useSyncExternalStore(dataSource.subscribeOrder, dataSource.currentOrder);
  const total = scenario.events.length;
  const current = order > 0 ? scenario.events[order - 1]! : null;
  const seek = useCallback((n: number) => dataSource.seek(n), [dataSource]);
  const preview = current?.noticePreview ?? null;

  return (
    <div className="replay-controls">
      <h1 className="replay-heading">去年の再現（2025 年シーズンの発生状況）</h1>
      <div role="group" aria-label="見る場所" className="replay-switch">
        <button type="button" className="btn" aria-pressed={view === "zone"} onClick={() => onView("zone")}>
          もし区域の近くの農場なら
        </button>
        <button type="button" className="btn" aria-pressed={view === "own"} disabled={!canOwn} onClick={() => onView("own")}>
          自分の町で見る
        </button>
      </div>
      {!canOwn ? <p className="replay-hint">自分の町で見るには、地図で自分の場所を決めてください（この端末の中にだけ保存されます）。</p> : null}

      <div className="replay-steps">
        <button type="button" className="btn" disabled={order === 0} onClick={() => seek(order - 1)}>
          前へ
        </button>
        <p className="replay-position" aria-live="polite">
          {`${order} / ${total}`}
        </p>
        <button type="button" className="btn btn-primary" disabled={order === total} onClick={() => seek(order + 1)}>
          次へ
        </button>
      </div>

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

      {current ? (
        <p className="replay-source">
          {formatMonthDay(current.date)}の出来事の出典:{" "}
          <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer">
            {new URL(current.sourceUrl).hostname}
          </a>
          {eventStage(current) === "suspected" ? "（県の対策本部会議の資料）" : ""}
        </p>
      ) : null}

      {view === "zone" && preview ? (
        <section className="replay-mail" aria-label="このときメールが届く">
          <h2>このときメールが届く</h2>
          <p>{preview.text}</p>
          <p className="replay-hint">再現では実際には送りません。</p>
        </section>
      ) : null}
      {view === "zone" && current && !preview ? <p className="replay-hint">この出来事では、この地点にメールは届きません。</p> : null}
      {view === "own" ? <p className="replay-hint">自分の町では、メールの下書きは出しません。</p> : null}
    </div>
  );
}
