// 見本の農場の外枠（X-08）。SampleLayout（/sample の下に 1 つ）が置く。再現の枠（ReplayFrame）の中に M の画面を置き、複製しない。
// 再現の時計を見本の今日に合わせ、記録の口は SampleRecordStore（端末の中だけ）。会員の状態も Firebase も読まない。
// 口と時計は読み込みの後に 1 度だけ作り、入口・やること・記録の間を移っても同じものを使う（ページの再読み込みで元に戻る）。
import { lastOrderOn, type ReplayScenario, type SampleFarmData } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import { fetchHistory } from "../../data/history";
import { ReplayDataSource } from "../replay/ReplayDataSource";
import { Fold } from "../../ui/Fold";
import { MORE_LABEL, ReplayFrame } from "../replay/ReplayFrame";
import { SAMPLE_TEXT } from "./sampleTexts";
import { SampleRecordStore } from "./SampleRecordStore";
import "./sample.css";

interface Loaded {
  scenario: ReplayScenario;
  data: SampleFarmData;
}
type Load = { status: "loading" } | { status: "failed" } | ({ status: "ready" } & Loaded);

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

/** "2025-12-30" → "2025年12月30日" */
function jaDayWithYear(d: string): string {
  return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
}

/** 見本の見出しと「保存されない」の短い断り。再現の帯より前に置き、残りの説明は「くわしく」に畳む（再現の帯の注記も一緒に） */
function SampleLead({ data, details }: { data: SampleFarmData; details: ReactNode }) {
  return (
    <section className="sample-band sample-lead" aria-label={SAMPLE_TEXT.badge}>
      <p className="sample-badge">{SAMPLE_TEXT.badge}</p>
      <p className="sample-note">{SAMPLE_TEXT.notSaved}</p>
      <Fold summary={MORE_LABEL} className="band-fold">
        <p>{SAMPLE_TEXT.notSent}</p>
        <p>
          {SAMPLE_TEXT.fictional}。{SAMPLE_TEXT.member}
        </p>
        <p>{SAMPLE_TEXT.asOf(jaDayWithYear(data.today))}</p>
        {details}
      </Fold>
    </section>
  );
}

function SampleNav() {
  return (
    <nav aria-label={SAMPLE_TEXT.navLabel} className="sample-nav">
      <Link to="/sample">{SAMPLE_TEXT.navEntry}</Link>
      <Link to="/sample/todo">{SAMPLE_TEXT.navTodo}</Link>
      <Link to="/sample/record/deaths">{SAMPLE_TEXT.navRecord}</Link>
    </nav>
  );
}

/**
 * 声かけ文の元になる事例を決める draftFactsOf（M-18）は、再現の事例（confirmState "replay"）を「下書きを作らない事例」として外す。
 * 見本のやることの画面では雛形の声かけ文を見せたいので、見本の画面の中だけ、事例の印を通常の自動（auto）に替える。
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

function SampleReady({ scenario: loaded, data, nav, children }: Loaded & { nav: boolean; children: (data: SampleFarmData) => ReactNode }) {
  const [env] = useState(() => {
    const scenario = withTemplateDraftCases(loaded);
    const dataSource = new ReplayDataSource(scenario, fetchHistory);
    // 子の画面が今日を読む前に、再現の時計を見本の今日に合わせる（購読者はまだいないので、通知は要らない）
    dataSource.seek(lastOrderOn(scenario, data.today));
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
    <ReplayFrame scenario={env.scenario} dataSource={env.dataSource} spot={env.spot} recordStore={env.recordStore} lead={(details) => <SampleLead data={data} details={details} />}>
      {nav ? <SampleNav /> : null}
      {children(data)}
    </ReplayFrame>
  );
}

export function SampleFrame({ nav = true, children }: { nav?: boolean; children: (data: SampleFarmData) => ReactNode }) {
  const { load, retry } = useSampleLoad();
  if (load.status === "loading") return <p role="status">{SAMPLE_TEXT.loading}</p>;
  if (load.status === "failed") {
    return (
      <div>
        <h1>{SAMPLE_TEXT.title}</h1>
        <p role="status">{SAMPLE_TEXT.failed}</p>
        <button type="button" className="btn" onClick={retry}>
          {SAMPLE_TEXT.retry}
        </button>
      </div>
    );
  }
  return (
    <SampleReady scenario={load.scenario} data={load.data} nav={nav}>
      {children}
    </SampleReady>
  );
}

/** SampleLayout の Outlet が渡す見本のデータ（入口の画面が読む） */
export function useSampleData(): SampleFarmData {
  return useOutletContext<SampleFarmData>();
}
