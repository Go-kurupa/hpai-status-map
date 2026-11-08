// /replay: 去年 12 月の 4 事例を、時刻どおりに流す。そのとき作品があったら何が見えたかを示す（設計書 §17）。
// 切り替えで、2025 年シーズンの全国の発生を日付の順に流す（全国の流れ）。過去の記録を読むだけで、シナリオの形は同じ。
// 審査員の操作で Claude も Firestore も呼ばない。読むのは 再現のデータ（静的ファイル）と 過去の記録だけ。
import { nationalFlowScenario, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint, HistoryCase } from "@hpai/shared/types";
import { useEffect, useMemo, useState } from "react";
import { fetchHistory } from "../../data/history";
import { loadSpot } from "../../data/spot";
import MapPage from "../map/MapPage";
import { ReplayControls, type Flow, type View } from "./ReplayControls";
import { ReplayDataSource } from "./ReplayDataSource";
import { ReplayFrame } from "./ReplayFrame";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; scenario: ReplayScenario };

async function fetchScenario(): Promise<ReplayScenario> {
  const res = await fetch(`${import.meta.env.BASE_URL}replay/scenario.json`);
  if (!res.ok) throw new Error(`再現のデータを読み込めませんでした（${res.status}）`);
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
        <p role="status">再現のデータを読み込めませんでした。</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読む
        </button>
      </div>
    );
  }
  return <ReplayReady scenario={load.scenario} />;
}

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

  // 端末内の地点は読むだけ（hpai.spot.v1 には書かない）。なければ『選択地域で見る』は押せない
  const [deviceSpot] = useState<FarmPoint | null>(() => loadSpot());
  const [view, setView] = useState<View>("zone");
  const spot = view === "own" && deviceSpot ? deviceSpot : scenario.defaultSpot;

  return (
    // 「過去の発生」の見方の 1 つ（設計書 2026-11-06-ui-frame 決定 8）。中の切り替えは置かない: 最初の画面に地図の全部を
    // 入れる決まりで高さに余裕がなく、上に「去年の再現を見ています／再現を終わる」の帯がある。メニューは「過去の発生」が選択中
    <ReplayFrame scenario={scenario} dataSource={dataSource} spot={spot}>
      {/* 操作の後ろの部分は、replay.css が地図の下へ動かす（地図の画面を変えずに、地図を最初の画面に入れる） */}
      <div className="replay-stage">
        <ReplayControls
          scenario={scenario}
          dataSource={dataSource}
          spot={spot}
          heading="去年の再現（2025 年シーズンの発生状況）"
          switches={{ view, canOwn: deviceSpot !== null, onView: setView, flow, flowStatus: national.status, onFlow: chooseFlow }}
        />
        {/* 流れを替えたら、地図の状態（選んだシーズン、見る場所、数え終えた件数）を持ち越さない */}
        <MapPage key={flow} replayStats={flow === "national"} />
      </div>
    </ReplayFrame>
  );
}
