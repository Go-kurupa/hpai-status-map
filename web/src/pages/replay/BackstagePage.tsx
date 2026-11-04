// /replay/backstage: 去年 12 月の再現の文書を、事前に Claude で読んだ結果と、プログラムの検査を見せる（設計書 §17、X-07）。
// AI が下書きし、プログラムが確かめる。読むのは 再現のデータ（静的ファイル）だけで、Claude も Firestore も呼ばない。
// 測っていない間は『未計測』と出す。作り話の数字や読み取り結果は置かない。原文と引用は持たない（短い語と値だけ）。
import { estimateUsd } from "@hpai/shared/budget";
import type { VerifyCheck } from "@hpai/shared/read/types";
import { replayNowAt, STAGE_LABEL, watchAt, type BackstageEntry, type BackstageFile, type MeasuredUsage, type ReplayScenario } from "@hpai/shared/replay";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { watchLine } from "../map/watchLineText";
import { eventLabel } from "./replayEngine";
import "./replay.css";
import "./backstage.css";

interface Data {
  scenario: ReplayScenario;
  backstage: BackstageFile;
  usage: MeasuredUsage;
}
type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; data: Data };

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}replay/${name}`);
  if (!res.ok) throw new Error(`${name} を読めませんでした（${res.status}）`);
  return (await res.json()) as T;
}

const UNMEASURED = "未計測";

export default function BackstagePage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setLoad({ status: "loading" });
    Promise.all([fetchJson<ReplayScenario>("scenario.json"), fetchJson<BackstageFile>("backstage.json"), fetchJson<MeasuredUsage>("measured-usage.json")]).then(
      ([scenario, backstage, usage]) => {
        if (!off) setLoad({ status: "ready", data: { scenario, backstage, usage } });
      },
      () => {
        if (!off) setLoad({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [attempt]);

  if (load.status === "loading") return <p role="status">舞台裏を読み込んでいます</p>;
  if (load.status === "failed") {
    return (
      <div>
        <h1>去年の再現の舞台裏</h1>
        <p role="status">舞台裏のデータを読めませんでした。</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読む
        </button>
      </div>
    );
  }
  return <BackstageView {...load.data} />;
}

// ── 表示のための語 ──
const KIND_LABEL: Readonly<Record<string, string>> = {
  suspected: "疑い",
  confirmed: "確定",
  progress: "防疫措置の進捗",
  control_done: "防疫措置の完了",
  zone_lifted: "区域の解除",
  negated: "否定",
  wild_bird: "野鳥",
  other_pref: "他県の対策",
  drill: "訓練",
  notice: "周知",
  irrelevant: "無関係",
};
const FIELD_LABEL: Readonly<Record<string, string>> = {
  kind: "文書の種類",
  prefecture: "都道府県",
  municipality: "市町村",
  nationalNo: "国内の例目",
  prefNo: "県内の例目",
  birdUse: "用途",
  housing: "飼い方",
  headCount: "羽数",
  negationBasis: "否定の根拠",
  primaryStage: "段階",
  primaryDate: "日付",
  radiiKm: "区域の半径",
  wildBirds: "野鳥の行",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL);
const CHECK_LABEL: Readonly<Record<VerifyCheck, string>> = {
  quote_exists: "引用が文書にある",
  value_in_quote: "値が引用から取り出せる",
  muni_exists: "市町村が実在する",
  stage_word: "段階を示す語がある",
  radius_sentence: "半径が区域の文にある",
  chronology: "日付の前後が合う",
  year_completion: "年を補った日付が実在する",
};

function valueText(field: string, value: string): string {
  if (field === "kind") return KIND_LABEL[value] ?? value;
  if (field === "primaryStage") return STAGE_LABEL[value] ?? value;
  if (field === "headCount") return `${Number(value).toLocaleString("en-US")} 羽`;
  return value;
}

function formatMeasuredAt(iso: string | null): string {
  if (iso === null) return UNMEASURED;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `bs-${title}`;
  return (
    <section aria-labelledby={id} className="backstage-section">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Unmeasured({ note }: { note?: string }) {
  return (
    <p className="backstage-unmeasured">
      {UNMEASURED}: {note ?? "まだ実物の文書を読んでいません。"}
    </p>
  );
}

function BackstageView({ scenario, backstage, usage }: Data) {
  const measured = backstage.status === "measured";
  const labelOf = (e: BackstageEntry): string => {
    const ev = scenario.events.find((x) => x.backstageId === e.id);
    return ev ? eventLabel(ev) : e.id;
  };
  const last = scenario.events.length;
  const watch = watchLine(watchAt(scenario, last), replayNowAt(scenario, last));
  const withDemo = backstage.entries.filter((e) => e.tamperedDemo !== null);

  return (
    <div className="backstage">
      <section className="replay-band" aria-label="去年の再現の舞台裏">
        <p className="replay-banner">{FIXED_TEXT.replayBanner}</p>
        <h1 className="backstage-title">去年の再現の舞台裏</h1>
        <p className="replay-time">時点: {formatMeasuredAt(backstage.measuredAt)}</p>
        <p>AI が下書きし、プログラムが確かめる。ここは、再現に出てくる文書を事前に読んだ結果です。迷うものは載せず、運営者に知らせます。</p>
        <p className="replay-hint">
          <Link to="/replay">再現にもどる</Link>
        </p>
      </section>

      <Section title="二つの読み手">
        <p className="replay-hint">同じ文書を、主の読み手と別の読み手が、たがいの結果を見ずに読みます。必要な項目が食い違えば、載せずに確認中に回します。</p>
        {!measured ? <Unmeasured note={backstage.note} /> : backstage.entries.map((e) => <ReadersTable key={e.id} entry={e} label={labelOf(e)} />)}
      </Section>

      <Section title="検査">
        <p className="replay-hint">読み取った値が、引用の中にあるかをプログラムが確かめます。必須の項目が通らなければ載せません。任意の項目は、落として空にして続けます。</p>
        {!measured ? (
          <Unmeasured />
        ) : (
          backstage.entries.map((e) => (
            <div key={e.id} className="backstage-entry">
              <h3>{labelOf(e)}</h3>
              <p>
                {e.verifyPass ? "必須の項目は通りました。" : "必須の項目が通らなかったので、載せません。"}
                {e.droppedOptional.length > 0 ? `任意の項目で落としたもの: ${e.droppedOptional.map((f) => FIELD_LABEL[f] ?? f).join("、")}。` : ""}
              </p>
              {e.verifyStopped ? (
                <p className="backstage-stopped" data-testid="verify-stopped">
                  <strong>照合で止めました（確認中に回しました）</strong>: {e.verifyStopped.fields.map((f) => FIELD_LABEL[f] ?? f).join("、")}。{e.verifyStopped.reason}。
                  読み取りそのものは期待どおりでしたが、プログラムは確かめられない値を載せません。
                </p>
              ) : null}
              <ul>
                {e.checks.map((c) => (
                  <li key={c.check}>
                    {CHECK_LABEL[c.check]}（{c.check}）: {c.pass ? "通りました" : `落ちました — ${c.detail}`}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>

      <Section title="入れ替えた値">
        <p className="replay-hint">本当に検査が働くかを見せるため、読み取った値をわざと入れ替えます。落ちたものだけを載せます。</p>
        {!measured ? (
          <Unmeasured />
        ) : withDemo.length === 0 ? (
          <p>入れ替えて落ちた例は、まだありません。</p>
        ) : (
          <ul>
            {withDemo.map((e) => {
              const d = e.tamperedDemo!;
              return (
                <li key={e.id}>
                  {labelOf(e)}: {FIELD_LABEL[d.field] ?? d.field}の「{d.before}」を「{d.after}」に入れ替えると、
                  {d.rejectedBy === "compare" ? "二つの読み手が食い違い（compare）、確認中に回します。" : `検査（${d.rejectedBy}）が落としました。`}
                  {d.rejectedBy === "radius_sentence" ? "半径は任意の項目なので、落として空にし、ほかの項目は通ります。" : ""}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="見回りの状況">
        <p>{watch.text}</p>
        <p className="replay-hint">これは説明のための例です。実際の見回りの結果ではありません。</p>
      </Section>

      <Section title="入口を直すエージェント">
        <p>県のサイトの見回り先が壊れたとき、新しい入口を提案するエージェントです。提案だけをして、見回り先は変えません。運営者が承認して初めて変わります。</p>
        <p>
          動かす方法（定期実行のしくみ）の試行の結論は<strong>未決</strong>です。決まったら、ここに書きます。
        </p>
      </Section>

      <Section title="費用">
        {usage.status !== "measured" ? <Unmeasured note="読み取りの費用は、実行するまで分かりません。" /> : <Cost usage={usage} />}
      </Section>

      <Section title="試験の結果">
        <p>
          <Link to="/results">試験の結果を見る</Link>
        </p>
      </Section>
    </div>
  );
}

function ReadersTable({ entry, label }: { entry: BackstageEntry; label: string }) {
  const primary = new Map(entry.primary.map((r) => [r.field, r]));
  const second = new Map(entry.second.map((r) => [r.field, r.value]));
  const fields = FIELD_ORDER.filter((f) => primary.has(f) || second.has(f));
  return (
    <div className="backstage-entry">
      <h3>{label}</h3>
      <p>
        <a href={entry.documentUrl} target="_blank" rel="noopener noreferrer">
          原文を開く（{new URL(entry.documentUrl).hostname}）
        </a>
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">項目</th>
            <th scope="col">主の読み手</th>
            <th scope="col">別の読み手</th>
            <th scope="col">文書にあった語</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f}>
              <th scope="row">{FIELD_LABEL[f] ?? f}</th>
              <td>{primary.has(f) ? valueText(f, primary.get(f)!.value) : "—"}</td>
              <td>{second.has(f) ? valueText(f, second.get(f)!) : "—"}</td>
              <td>{primary.get(f)?.matchedWord ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {entry.compare === null
          ? "別の読み手の結果がないので、突き合わせていません。"
          : entry.compare.match
            ? "二つの読み手は一致しました。"
            : `二つの読み手が食い違いました（${entry.compare.mismatches.map((f) => FIELD_LABEL[f] ?? f).join("、")}）。`}
      </p>
    </div>
  );
}

function Cost({ usage }: { usage: MeasuredUsage }) {
  const s = DEFAULT_RUNTIME_SETTINGS;
  const rows = Object.entries(usage.byModel);
  const usd = rows.reduce(
    (sum, [model, u]) =>
      sum + estimateUsd(model, { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cache_read_input_tokens: u.cacheReadTokens, cache_creation_input_tokens: u.cacheWriteTokens }),
    0,
  );
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <div>
      <p>読んだ文書: {usage.documents} 本（それぞれを二つの読み手に渡しました）。</p>
      <ul>
        {rows.map(([model, u]) => (
          <li key={model}>
            {model}: 入力 {n(u.inputTokens)}、出力 {n(u.outputTokens)}、キャッシュ読み {n(u.cacheReadTokens)}、キャッシュ書き込み {n(u.cacheWriteTokens)}（API の応答の使用量の合計）
          </li>
        ))}
      </ul>
      <p>
        推定費用: 約 {Math.round(usd * s.jpyPerUsd).toLocaleString("en-US")} 円（推定。1 ドル {s.jpyPerUsd} 円で計算した見積もりで、請求画面の実測ではありません）。
      </p>
    </div>
  );
}
