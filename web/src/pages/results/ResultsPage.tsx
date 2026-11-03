// /results: 読み取りの試験の結果と、費用を見せる（設計書 §16、X-09）。
// 読むのは静的ファイル（/evals/summary.json、/replay/measured-usage.json）だけで、Claude も Firestore も呼ばない。
// 「実測」（測った数）と「計算」（測った数や仮定から出した数）を分けて出す。測っていないものは「未実測」「未計測」と書き、0 とも空欄とも書かない。
import {
  ASSUMED_DOCS_PER_CASE,
  BUSY_MONTH_CASES,
  costBases,
  estimateSeasonCost,
  formatJpy,
  formatUsd,
  MONTHLY_BUDGET_JPY,
  monthlyCaseCapacity,
  parseEvalSummary,
  parseMeasuredUsage,
  PEAK_SEASON_CASES,
  PREV_SEASON_CASES,
} from "@hpai/shared/cost";
import type { MeasuredUsage } from "@hpai/shared/replay";
import { DEFAULT_RUNTIME_SETTINGS, type EvalSummary } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatMetric, METRIC_LABEL, METRIC_ORDER } from "./formatMetric";
import "../replay/backstage.css";

/** 読み込みの結果。none = ファイルが無い（まだ測っていない）、failed = 通信などで読めなかった */
type Src<T> = { s: "none" } | { s: "ready"; v: T } | { s: "failed" };
type Load = { status: "loading" } | { status: "done"; summary: Src<EvalSummary>; usage: Src<MeasuredUsage> };

const UNMEASURED = "未計測";
const UNMEASURED_METRIC = "未実測";

async function load<T>(name: string, parse: (x: unknown) => T | null): Promise<Src<T>> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${name}`);
    if (res.status === 404) return { s: "none" };
    if (!res.ok) return { s: "failed" };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { s: "none" }; // ファイルが無いときに index.html が返る配信でも、結果があるとは扱わない
    }
    const v = parse(json);
    return v === null ? { s: "none" } : { s: "ready", v };
  } catch {
    return { s: "failed" };
  }
}

/** "2026-11-05T17:30:00+09:00" → "2026-11-05 17:30"。書いてある時刻をそのまま出す */
function formatAt(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}
const n = (v: number): string => v.toLocaleString("en-US");

export default function ResultsPage() {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setState({ status: "loading" });
    Promise.all([load("evals/summary.json", parseEvalSummary), load("replay/measured-usage.json", parseMeasuredUsage)]).then(([summary, usage]) => {
      if (!off) setState({ status: "done", summary, usage });
    });
    return () => {
      off = true;
    };
  }, [attempt]);

  if (state.status === "loading") return <p role="status">試験の結果を読み込んでいます</p>;
  const { summary, usage } = state;
  const anyFailed = summary.s === "failed" || usage.s === "failed";
  const usageValue: MeasuredUsage = usage.s === "ready" ? usage.v : { status: "unmeasured", documents: 0, byModel: {}, measuredAt: null };
  const summaryValue = summary.s === "ready" ? summary.v : null;

  return (
    <div className="backstage">
      <h1 className="backstage-title">試験の結果と費用</h1>
      <p>
        AI が読んだ結果を、正解と照らして数えた試験の結果と、Claude にかかった費用です。<strong>実測</strong>は測った数、<strong>計算</strong>は測った数や仮定から出した数で、分けて書きます。測っていないものは「未実測」「未計測」と書きます。
      </p>
      {anyFailed && (
        <p>
          <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
            もう一度読む
          </button>
        </p>
      )}

      <Section id="eval" title="読み取りの試験（実測）">
        <EvalSection src={summary} />
      </Section>

      <Section id="usage" title="再現 1 回分の使用量（実測）">
        <UsageSection src={usage} usage={usageValue} />
      </Section>

      <Section id="calc" title="1 シーズンの費用（計算）">
        <CalcSection usage={usageValue} summary={summaryValue} />
      </Section>

      <p className="replay-hint">
        <Link to="/">地図にもどる</Link>　<Link to="/replay/backstage">去年の再現の舞台裏を見る</Link>
      </p>
    </div>
  );
}

function Section({ id: key, title, children }: { id: string; title: string; children: ReactNode }) {
  const id = `results-${key}`;
  return (
    <section aria-labelledby={id} className="backstage-section">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Unmeasured({ children }: { children: ReactNode }) {
  return <p className="backstage-unmeasured">{children}</p>;
}

function EvalSection({ src }: { src: Src<EvalSummary> }) {
  if (src.s === "failed") return <p role="status">試験の結果を読めませんでした。</p>;
  if (src.s === "none") {
    return (
      <Unmeasured>
        試験はまだ実行していません。各項目は{UNMEASURED_METRIC}です。実行したら、正解のある文書で数えた結果をここに出します。
      </Unmeasured>
    );
  }
  const s = src.v;
  return (
    <div>
      <p>時点: {formatAt(s.measuredAt)}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">項目</th>
            <th scope="col">結果</th>
            <th scope="col">補足</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_ORDER.map((name) => {
            // unmeasured にあるものと、結果に無いものは未実測。0 とは書かない
            const m = s.unmeasured.includes(name) ? undefined : s.metrics.find((x) => x.name === name);
            return (
              <tr key={name}>
                <th scope="row">{METRIC_LABEL[name]}</th>
                <td>{m ? formatMetric(m) : UNMEASURED_METRIC}</td>
                <td>{m?.note ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsageSection({ src, usage }: { src: Src<MeasuredUsage>; usage: MeasuredUsage }) {
  if (src.s === "failed") return <p role="status">使用量の記録を読めませんでした。</p>;
  if (usage.status !== "measured") {
    return <Unmeasured>{UNMEASURED}: まだ実物の文書を読んでいないので、使用量も費用も分かりません。</Unmeasured>;
  }
  return (
    <div>
      <p>時点: {usage.measuredAt ? formatAt(usage.measuredAt) : UNMEASURED}</p>
      <p>読んだ文書: {usage.documents} 本（それぞれを二つの読み手に渡しました）。API の応答の使用量の合計です。</p>
      <ul>
        {Object.entries(usage.byModel).map(([model, t]) => (
          <li key={model}>
            {model}: 入力 {n(t.inputTokens)}、出力 {n(t.outputTokens)}、キャッシュ読み {n(t.cacheReadTokens)}、キャッシュ書き込み {n(t.cacheWriteTokens)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SCENARIOS = [
  { label: `前季 ${PREV_SEASON_CASES} 事例`, cases: PREV_SEASON_CASES },
  { label: `事例が集中した月（${BUSY_MONTH_CASES} 事例と仮定）`, cases: BUSY_MONTH_CASES },
  { label: `過去最多 ${PEAK_SEASON_CASES} 事例`, cases: PEAK_SEASON_CASES },
] as const;

function CalcSection({ usage, summary }: { usage: MeasuredUsage; summary: EvalSummary | null }) {
  const jpyPerUsd = DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
  const bases = costBases(usage, summary);
  return (
    <div>
      <p className="replay-hint">
        1 事例で読む文書は {ASSUMED_DOCS_PER_CASE} 文書と<strong>仮定</strong>しました（測っていません）。1 ドル {jpyPerUsd} 円で換算します。
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">根拠</th>
            <th scope="col">1 文書</th>
            {SCENARIOS.map((c) => (
              <th scope="col" key={c.label}>
                {c.label}
              </th>
            ))}
            <th scope="col">月 {n(MONTHLY_BUDGET_JPY)} 円で読める事例</th>
          </tr>
        </thead>
        <tbody>
          {bases.map((b) => {
            const cap = monthlyCaseCapacity(b, jpyPerUsd);
            return (
              <tr key={b.id}>
                <th scope="row">{b.label}</th>
                <td>${formatUsd(b.usdPerDocument)}</td>
                {SCENARIOS.map((c) => (
                  <td key={c.label}>{formatJpy(estimateSeasonCost({ usdPerDocument: b.usdPerDocument, cases: c.cases, docsPerCase: ASSUMED_DOCS_PER_CASE, jpyPerUsd }).jpy)}</td>
                ))}
                <td>{cap === null ? "—" : `1 か月に ${cap} 事例まで`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        「見積もり（推定）」の行は、1 文書を入力 5,000・出力 1,500 トークンの Opus 5.5（0.05 ドル）と仮定して出した数で、<strong>実測ではありません</strong>。実測の行は、応答の使用量に単価を掛けた計算で、請求画面の額とは別です。
      </p>
      <p className="replay-hint">運用の上限は月 {n(MONTHLY_BUDGET_JPY)} 円です。詳しい計算は docs/cost.md にあります。</p>
    </div>
  );
}
