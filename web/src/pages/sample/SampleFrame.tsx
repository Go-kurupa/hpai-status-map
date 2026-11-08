// 近くで発生した場合の見え方（/sample）の外枠。SampleLayout（/sample の下に 1 つ）が置く。再現の枠（ReplayFrame）の中に、
// 地図（SamplePage）と対策項目（SampleTodoPage）を置き、複製しない（2026-11-08 作者の決定: 記録を試す画面はなくした）。
// 再現の時計は、見本の農場（鶏舎の場所 = 再現の仮の地点）にメールが届く最初の出来事（12月19日 津山市 疑い）から始める。
// 記録の口は SampleRecordStore（端末の中だけ）。対策項目が農場の飼い方と消毒の「やった」を読むために使う。会員の状態も Firebase も読まない。
// 口と時計は読み込みの後に 1 度だけ作り、地図と対策項目の間を移っても同じものを使う（ページの再読み込みで元に戻る）。
import { lastOrderOn, type ReplayScenario, type SampleFarmData } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import { fetchHistory } from "../../data/history";
import { ReplayDataSource } from "../replay/ReplayDataSource";
import { ReplayFrame } from "../replay/ReplayFrame";
import { SAMPLE_TEXT } from "./sampleTexts";
import { SampleRecordStore } from "./SampleRecordStore";

interface Loaded {
  scenario: ReplayScenario;
  data: SampleFarmData;
}
type Load = { status: "loading" } | { status: "failed" } | ({ status: "ready" } & Loaded);

/** 地図の画面（SamplePage）が読む、再現の事例・時計・見る地点 */
export interface SampleEnv {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  spot: FarmPoint;
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}replay/${name}`);
  if (!res.ok) throw new Error(`${name} を読み込めませんでした（${res.status}）`);
  return (await res.json()) as T;
}

function useSampleLoad(): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let off = false;
    setLoad({ status: "loading" });
    Promise.all([fetchJson<ReplayScenario>("scenario.json"), fetchJson<SampleFarmData>("sample-farm.json")]).then(
      ([scenario, data]) => {
        if (!off) setLoad({ status: "ready", scenario, data });
      },
      () => {
        if (!off) setLoad({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [attempt]);
  return { load, retry: () => setAttempt((n) => n + 1) };
}

/**
 * 開いたときの時刻。仮の地点に「このときメールが届く」が出る最初の出来事（12月19日 津山市 疑い）。
 * メールの下書きは、再現の仮の地点で作ってある（見本の農場の鶏舎の場所は、その仮の地点と同じ）。
 * 下書きのある出来事がなければ、見本の今日の最後の出来事にする
 */
export function sampleStartOrder(scenario: ReplayScenario, data: SampleFarmData): number {
  return scenario.events.find((e) => e.noticePreview)?.order ?? lastOrderOn(scenario, data.today);
}

/**
 * 声かけ文の元になる事例を決める draftFactsOf（M-18）は、再現の事例（confirmState "replay"）を「下書きを作らない事例」として外す。
 * 対策項目の画面では雛形の声かけ文を見せたいので、この画面の中だけ、事例の印を通常の自動（auto）に替える。
 * 替えるのは画面の中の複製だけで、データのファイルと再現の画面には届かない。Claude は呼ばない（sample の口と再現の時計は getCaseDraft を呼ばない）。
 */
function withTemplateDraftCases(s: ReplayScenario): ReplayScenario {
  return {
    ...s,
    events: s.events.map((e) => ({
      ...e,
      caseAfter: { ...e.caseAfter, confirmState: "auto" as const },
    })),
  };
}

function SampleReady({ scenario: loaded, data, children }: Loaded & { children: (env: SampleEnv) => ReactNode }) {
  const [env] = useState(() => {
    const scenario = withTemplateDraftCases(loaded);
    const dataSource = new ReplayDataSource(scenario, fetchHistory);
    // 子の画面が今日を読む前に、再現の時計を開いたときの時刻に合わせる（購読者はまだいないので、通知は要らない）
    dataSource.seek(sampleStartOrder(scenario, data));
    const spot: FarmPoint = {
      meshCode: data.farm.meshCode,
      muniCode: data.farm.muniCode,
      frequentMuniCodes: [...data.farm.frequentMuniCodes],
    };
    return {
      scenario,
      dataSource,
      recordStore: new SampleRecordStore(data),
      spot,
    };
  });
  return (
    <ReplayFrame scenario={env.scenario} dataSource={env.dataSource} spot={env.spot} recordStore={env.recordStore} note={SAMPLE_TEXT.farmNote}>
      {children({ scenario: env.scenario, dataSource: env.dataSource, spot: env.spot })}
    </ReplayFrame>
  );
}

export function SampleFrame({ children }: { children: (env: SampleEnv) => ReactNode }) {
  const { load, retry } = useSampleLoad();
  if (load.status === "loading") return <p role="status">{SAMPLE_TEXT.loading}</p>;
  if (load.status === "failed") {
    return (
      <div>
        <h1>{SAMPLE_TEXT.heading}</h1>
        <p role="status">{SAMPLE_TEXT.failed}</p>
        <button type="button" className="btn" onClick={retry}>
          {SAMPLE_TEXT.retry}
        </button>
      </div>
    );
  }
  return (
    <SampleReady scenario={load.scenario} data={load.data}>
      {children}
    </SampleReady>
  );
}

/** SampleLayout の Outlet が渡す、再現の事例・時計・見る地点（地図の画面が読む） */
export function useSampleEnv(): SampleEnv {
  return useOutletContext<SampleEnv>();
}
