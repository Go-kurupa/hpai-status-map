// /results: 読み取りの試験の結果と、費用を見せる（設計書 §16、X-09）。
// 読むのは静的ファイル（/evals/summary.json、/replay/measured-usage.json）だけで、Claude も Firestore も呼ばない。
// 「実測」（測った数）と「計算」（測った数や仮定から出した数）を分けて出す。測っていないものは「未実測」「未計測」と書き、0 とも空欄とも書かない。
import {
  ASSUMED_DOCS_PER_CASE,
  ASSUMED_DOCUMENT_TOKENS,
  ASSUMED_MODEL,
  BUSY_MONTH_CASES,
  costBases,
  type CostBasisId,
  estimateSeasonCost,
  formatJpy,
  formatUsd,
  MONTHLY_BUDGET_JPY,
  monthlyCaseCapacity,
  parseEvalSummary,
  parseMeasuredUsage,
  PEAK_SEASON_CASES,
  PREV_SEASON_CASES,
  PRICE_NOTE,
} from "@hpai/shared/cost";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { MeasuredUsage } from "@hpai/shared/replay";
import { DEFAULT_RUNTIME_SETTINGS, type EvalSummary } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatMetric, METRIC_LABEL, METRIC_ORDER } from "./formatMetric";
import "../replay/backstage.css";

/** 読み込みの結果。none = ファイルが無い（まだ測っていない）、failed = 通信などで読めなかった */
type Src<T> = { s: "none" } | { s: "ready"; v: T } | { s: "failed" };
type Load = { status: "loading" } | { status: "done"; summary: Src<EvalSummary>; usage: Src<MeasuredUsage> };

const UNMEASURED = "まだ測っていません";
const UNMEASURED_METRIC = "まだ測っていません";

async function load<T>(name: string, parse: (x: unknown) => T | null): Promise<Src<T>> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${name}`);
    if (res.status === 404) return { s: "none" };
    if (!res.ok) return { s: "failed" };
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // ファイルが無いときに index.html を返す配信は、まだ測っていない扱い。それ以外の壊れた中身は、読めなかったと分ける
      return (res.headers.get("content-type") ?? "").includes("text/html") ? { s: "none" } : { s: "failed" };
    }
    const v = parse(json);
    return v === null ? { s: "failed" } : { s: "ready", v }; // ファイルはあるが形が違う: 読み込めなかった
  } catch {
    return { s: "failed" };
  }
}

/** "2026-11-05T17:30:00+09:00" → "2026年11月5日 17:30"。書いてある時刻をそのまま出す。形が違う、ありえない日付なら元の文字のまま（画面を止めない） */
function formatAt(iso: string): string {
  const m = /^((\d{4})-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!m) return iso;
  try {
    return `${m[2]}年${formatJaDate(m[1]!)} ${m[3]}`;
  } catch {
    return iso;
  }
}
const n = (v: number): string => v.toLocaleString("en-US");

/** embedded は「このサイトについて」の中に置くとき（設計書 2026-11-06-ui-frame 決定 12）。題を出さず、節の題を 1 段下げる */
export default function ResultsPage({ embedded = false }: { embedded?: boolean } = {}) {
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
      {embedded ? null : <h1 className="backstage-title">試験の結果と費用</h1>}
      <p>
        AI が読んだ結果を、正解と照らして数えた試験の結果と、Claude にかかった費用です。<strong>実測</strong>は測った数、<strong>計算</strong>は測った数や仮定から出した数で、分けて書きます。測っていないものは「まだ測っていません」と書きます。
      </p>
      {anyFailed && (
        <p>
          <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
            もう一度読む
          </button>
        </p>
      )}

      <Section id="eval" title="読み取りの試験（実測）" embedded={embedded}>
        <EvalSection src={summary} />
      </Section>

      <Section id="usage" title="再現 1 回分の使用量（実測）" embedded={embedded}>
        <UsageSection src={usage} usage={usageValue} />
      </Section>

      <Section id="calc" title="1 シーズンの費用（計算）" embedded={embedded}>
        <CalcSection usage={usageValue} summary={summaryValue} embedded={embedded} />
      </Section>

      <p className="replay-hint">
        {embedded ? null : <><Link to="/" className="tap-link">地図に戻る</Link>　</>}<Link to="/replay/backstage" className="tap-link">去年の再現の舞台裏を見る</Link>　<Link to="/trends" className="tap-link">発生傾向</Link>
      </p>
    </div>
  );
}

function Section({ id: key, title, children, embedded = false }: { id: string; title: string; children: ReactNode; embedded?: boolean }) {
  const id = `results-${key}`;
  const H = embedded ? "h3" : "h2";
  return (
    <section aria-labelledby={id} className="backstage-section">
      <H id={id}>{title}</H>
      {children}
    </section>
  );
}

function Unmeasured({ children }: { children: ReactNode }) {
  return <p className="backstage-unmeasured">{children}</p>;
}

function EvalSection({ src }: { src: Src<EvalSummary> }) {
  if (src.s === "failed") return <p role="status">時点: 読み込めませんでした。試験の結果を読み込めませんでした。</p>;
  if (src.s === "none") {
    return (
      <Unmeasured>
        時点: 試験はまだ実行していません。各項目は、{UNMEASURED_METRIC}。実行したら、正解のある文書で数えた結果をここに出します。
      </Unmeasured>
    );
  }
  const s = src.v;
  return (
    <div>
      <p>時点: {formatAt(s.measuredAt)}</p>
      <div className="table-scroll">
      <table className="data-table data-table-stack" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">項目</th>
            <th role="columnheader" scope="col">結果</th>
            <th role="columnheader" scope="col">補足</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {METRIC_ORDER.map((name) => {
            // unmeasured にあるものと、結果に無いものは未実測。0 とは書かない
            const m = s.unmeasured.includes(name) ? undefined : s.metrics.find((x) => x.name === name);
            return (
              <tr role="row" key={name}>
                <th role="rowheader" scope="row">{METRIC_LABEL[name]}</th>
                <td role="cell" className="num">{m ? formatMetric(m) : UNMEASURED_METRIC}</td>
                <td role="cell">{m?.note ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function UsageSection({ src, usage }: { src: Src<MeasuredUsage>; usage: MeasuredUsage }) {
  if (src.s === "failed") return <p role="status">時点: 読み込めませんでした。使用量の記録を読み込めませんでした。</p>;
  if (usage.status !== "measured") {
    return (
      <Unmeasured>
        時点: {UNMEASURED}。まだ実物の文書を読んでいないので、使用量も費用も分かりません。
      </Unmeasured>
    );
  }
  return (
    <div>
      <p>時点: {usage.measuredAt ? formatAt(usage.measuredAt) : UNMEASURED}</p>
      <p>読んだ文書: {usage.documents} 本（それぞれを 2 つの AI に渡しました）。API の応答の使用量の合計です。</p>
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

/**
 * 表の行の見出し（画面だけの短い名前）。断り（仮定、実測でないこと）は節の冒頭と各表の上の文に 1 回ずつ書き、行には繰り返さない。
 * costBases の label は CLI（scripts/lib/cost.ts）の 1 行の説明にも使うので、そちらは変えない
 */
const ROW_LABEL: Readonly<Record<CostBasisId, string>> = {
  replay: "再現の実測から",
  eval: "読み取りの試験から",
  assumed: "主の AI だけ",
  assumed_with_second: "確かめ役の AI も含む",
};

function CalcSection({ usage, summary, embedded = false }: { usage: MeasuredUsage; summary: EvalSummary | null; embedded?: boolean }) {
  const jpyPerUsd = DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
  const bases = costBases(usage, summary);
  const measured = bases.filter((b) => b.measured);
  const assumed = bases.filter((b) => !b.measured);
  const t = ASSUMED_DOCUMENT_TOKENS;
  // 「このサイトについて」の中では節の題が h3 なので、中の見出しも 1 段下げる
  const H = embedded ? "h4" : "h3";
  return (
    <div>
      <p className="replay-hint">
        円の額は、1 事例 {ASSUMED_DOCS_PER_CASE} 文書と仮定した見積もりです。
        {measured.length > 0 && "実測の使用量から出したのは、1 文書あたりの額だけです。"}
        換算は 1 ドル {jpyPerUsd} 円です。{PRICE_NOTE}
      </p>

      {measured.length > 0 && (
        <div>
          <H id="results-calc-measured">実測の使用量から計算した費用</H>
          <p>
            1 文書あたりの額は、測った使用量に単価を掛けた計算で、請求画面の額とは別です。
            {measured.some((b) => b.id === "eval") && "「読み取りの試験から」は確かめ役の AI を含む 1 文書の額で、実行方式（通常の API か Batch か）は記録がありません。"}
          </p>
          <CostTable bases={measured} jpyPerUsd={jpyPerUsd} labelledBy="results-calc-measured" />
        </div>
      )}

      <div className="backstage-unmeasured">
        <H id="results-calc-assumed">仮定から出した見積もり</H>
        <p>
          この表は、1 文書あたりの額も仮定の数です。1 文書を入力 {n(t.inputTokens)}・出力 {n(t.outputTokens)} トークンとして、{ASSUMED_MODEL} で読んだときの額（${formatUsd(assumed[0]?.usdPerDocument ?? 0)}）です。
          {assumed.length > 1 && "「主の AI だけ」は、確かめ役の AI（Haiku）の費用を含みません。「確かめ役の AI も含む」は、Haiku にも同じ量を読ませたと仮定して合わせた数です。実際の増え方はまだ測っていません。"}
        </p>
        <CostTable bases={assumed} jpyPerUsd={jpyPerUsd} labelledBy="results-calc-assumed" />
      </div>

      <p className="replay-hint">運用の上限は月 {n(MONTHLY_BUDGET_JPY)} 円です。詳しい計算は docs/cost.md にあります。</p>
    </div>
  );
}

/** 表の題は、すぐ上の見出しと同じなので caption に重ねて書かず、見出しを表の名前にする */
function CostTable({ bases, jpyPerUsd, labelledBy }: { bases: ReturnType<typeof costBases>; jpyPerUsd: number; labelledBy: string }) {
  return (
    <div className="table-scroll">
      <table className="data-table data-table-stack" role="table" aria-labelledby={labelledBy}>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">根拠</th>
            <th role="columnheader" scope="col">1 文書</th>
            {SCENARIOS.map((c) => (
              <th role="columnheader" scope="col" key={c.label}>
                {c.label}
              </th>
            ))}
            <th role="columnheader" scope="col">月 {n(MONTHLY_BUDGET_JPY)} 円で読める事例</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {bases.map((b) => {
            const cap = monthlyCaseCapacity(b, jpyPerUsd);
            return (
              <tr role="row" key={b.id}>
                <th role="rowheader" scope="row">{ROW_LABEL[b.id]}</th>
                <td role="cell" className="num" data-label="1 文書">${formatUsd(b.usdPerDocument)}</td>
                {SCENARIOS.map((c) => (
                  <td role="cell" key={c.label} className="num" data-label={c.label}>{formatJpy(estimateSeasonCost({ usdPerDocument: b.usdPerDocument, cases: c.cases, docsPerCase: ASSUMED_DOCS_PER_CASE, jpyPerUsd }).jpy)}</td>
                ))}
                <td role="cell" data-label={`月 ${n(MONTHLY_BUDGET_JPY)} 円で読める事例`}>{cap === null ? "—" : `1 か月に ${cap} 事例まで`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
