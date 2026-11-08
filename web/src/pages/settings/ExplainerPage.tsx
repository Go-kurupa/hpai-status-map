// 近隣への説明文（M-19、設計書 §11）。会員が平時に、農場の対策を入れて、住民説明会や回覧向けの文を下書きする。
// 下書きは Claude が作り、人が直して使う。公式の部分は Claude を通さず、公式の文のまま。
// 自分の農場で発生したときの知らせの雛形は、Claude を呼ばない固定の文。
// 配るのは農場で、作品からは送らない。会員だけの画面なので RequireMember で包む（見本の農場は素通しで、Claude には送らない）。
import {
  neighborOfficialPart,
  neighborTemplate,
  ownOutbreakNoticeTemplate,
  type NeighborAudience,
  type NeighborDraftResult,
  type NeighborOfficialStatement,
} from "@hpai/shared/drafts";
import { OFFICIAL_GUIDANCE_REVIEWED_ON } from "@hpai/shared/guidance/official";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { SourceLine } from "../../ui/SourceLine";
import { RequireMember } from "../auth/RequireMember";
import "./settings.css"; // 説明文の画面も設定の部品を使う。直接開くと、ほかの画面の CSS は読まれていない
import "./explainer.css";

/** 入力の文の長さの上限。サーバーも同じ数で止める */
const MAX_INPUT = 2000;

const AUDIENCES: ReadonlyArray<{ value: NeighborAudience; label: string }> = [
  { value: "meeting", label: "住民説明会で話す" },
  { value: "circular", label: "回覧で配る" },
];

export const EXPLAINER_TEXT = {
  heading: "近隣への説明文",
  intro: "近所の方や取引先に配る、鳥インフルエンザの説明文を下書きします。農場の対策を入れると、Claude（AI）が農場の部分を下書きします。人への感染や卵、鶏肉などの説明は、国の文をそのまま付けます。",
  draftNote: "Claude の文は下書きです。配る前に、必ず読んで、直してください。",
  sendNotice: "入力した文を Claude に送ります。農場の名前、位置、記録は送りません。",
  sampleNotice: "これは見本の画面です。入力した文は Claude に送らず、雛形に入れるだけです。",
  distribute: "配るのは農場で、このサイトからは送りません。",
} as const;

/** 下書きの結果が雛形になった理由を、やさしい言葉にする。入力の文そのものは出さない（言い方の語だけ） */
export function explainFailures(failures: readonly string[]): string[] {
  const out = new Set<string>();
  const phrases: string[] = [];
  for (const f of failures) {
    const [head, ...rest] = f.split(":");
    if (head === "budget_stop") out.add("今月の Claude の利用が上限に達しているため、Claude には頼みませんでした。");
    else if (head === "budget_unavailable") out.add("利用の上限を確かめられなかったため、Claude には頼みませんでした。");
    else if (head === "daily_limit") out.add("今日はこれ以上作れません。明日、また作れます。入力した文を入れた雛形を出しています。");
    else if (head === "limit_unavailable") out.add("今日の回数を確かめられなかったため、Claude には頼みませんでした。");
    else if (head === "claude") out.add("Claude から使える返事が来なかったため、雛形にしました。");
    else if (head === "input") {
      const phrase = rest.slice(1).join(":");
      phrases.push(phrase === "" ? "" : `「${phrase}」`);
      out.add("入力した文に、説明文では使わない言い方があります。下の雛形にもそのまま入っています。入力の文を直して、もう一度作ってください。");
    } else {
      out.add("Claude の下書きに、入力にない数字や、書かない言い方があったため、雛形にしました。");
    }
  }
  const list = [...out];
  const shown = phrases.filter((p) => p !== "");
  if (shown.length > 0) list.push(`気になる言い方: ${[...new Set(shown)].join("、")}`);
  return list;
}

interface Group {
  heading: string;
  items: NeighborOfficialStatement[];
}

function groupByHeading(part: readonly NeighborOfficialStatement[]): Group[] {
  const groups: Group[] = [];
  for (const s of part) {
    const g = groups.find((x) => x.heading === s.heading);
    if (g) g.items.push(s);
    else groups.push({ heading: s.heading, items: [s] });
  }
  return groups;
}

/** 配る文の全体。農場の部分（直した文）に、選んだ公式の部分を、出典つきでそのまま続ける */
function assemble(farmText: string, groups: readonly Group[], excluded: ReadonlySet<string>): string {
  const blocks = [farmText.trim()];
  for (const g of groups) {
    if (excluded.has(g.heading)) continue;
    blocks.push([`【${g.heading}】`, ...g.items.map((s) => `${s.text}（出典: ${s.sourceTitle}）`)].join("\n"));
  }
  return blocks.filter((b) => b !== "").join("\n\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <>
      <Button
        onClick={async () => setState((await copyText(text)) ? "done" : "failed")}
      >
        {label}
      </Button>
      {state === "done" ? <span role="status"> コピーしました</span> : null}
      {state === "failed" ? <span role="alert"> コピーできませんでした。文を選んで、手でコピーしてください。</span> : null}
    </>
  );
}

function Result({ result }: { result: NeighborDraftResult }) {
  const id = useId();
  const [farmText, setFarmText] = useState(result.farmPart);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const groups = groupByHeading(result.officialPart);
  const included = groups.filter((g) => !excluded.has(g.heading));
  const sources = new Map<string, NeighborOfficialStatement>();
  for (const g of included) for (const s of g.items) if (!sources.has(s.sourceUrl)) sources.set(s.sourceUrl, s);
  const reasons = result.source === "template" ? explainFailures(result.failures) : [];
  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <section className="explainer-result" aria-label="説明文の下書き">
      <h2>下書き</h2>
      {result.source === "claude" ? (
        <p role="status">農場の部分は、Claude が下書きしました。{EXPLAINER_TEXT.draftNote}</p>
      ) : (
        <div role="status">
          <p>農場の部分は、Claude の下書きではなく、入力した文を入れた雛形です。</p>
          {reasons.length > 0 ? (
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <h3>農場の部分（直せます）</h3>
      <textarea
        id={`${id}-farm`}
        className="explainer-text"
        aria-label="農場の部分（直して使えます）"
        rows={8}
        value={farmText}
        onChange={(e) => setFarmText(e.target.value)}
      />

      <h3>国の文（そのまま付けます）</h3>
      <p className="settings-note">
        国の機関の文を、言い換えずに並べています。付けない話題は、チェックを外してください。
        {OFFICIAL_GUIDANCE_REVIEWED_ON === null ? "文面は、作者と共同経営者の確認前です。" : `文面を確認した日: ${OFFICIAL_GUIDANCE_REVIEWED_ON}`}
      </p>
      {groups.map((g) => (
        <section key={g.heading} className="explainer-official">
          <label className="settings-check">
            <input type="checkbox" checked={!excluded.has(g.heading)} onChange={() => setExcluded(toggle(excluded, g.heading))} />
            <span>{g.heading}を付ける</span>
          </label>
          {excluded.has(g.heading)
            ? null
            : g.items.map((s) => (
                <blockquote key={s.text} className="explainer-quote">
                  <p>{s.text}</p>
                  <SourceLine title={s.sourceTitle} url={s.sourceUrl} checkedOn={s.checkedOn} />
                </blockquote>
              ))}
        </section>
      ))}

      <h3>配る前に、出典を確かめてください</h3>
      <p className="settings-note">
        国や県の文書は、あとで変わることがあります。出典を開いて、文が同じか確かめたら、チェックしてください。
      </p>
      <p role="status">
        確かめた {[...sources.keys()].filter((u) => confirmed.has(u)).length} / {sources.size} 件
      </p>
      <ul className="explainer-checklist">
        {[...sources.values()].map((s) => (
          <li key={s.sourceUrl}>
            <label className="settings-check">
              <input
                type="checkbox"
                aria-label={`${s.sourceTitle}を確かめた`}
                checked={confirmed.has(s.sourceUrl)}
                onChange={() => setConfirmed(toggle(confirmed, s.sourceUrl))}
              />
              <span>原本を開いて確かめた</span>
            </label>
            <SourceLine title={s.sourceTitle} url={s.sourceUrl} checkedOn={s.checkedOn} />
          </li>
        ))}
      </ul>

      <p>
        <CopyButton text={assemble(farmText, groups, excluded)} label="説明文をコピーする" />
      </p>
      <p className="settings-note">{EXPLAINER_TEXT.distribute}</p>
    </section>
  );
}

function PeacetimeSection() {
  const store = useRecordStore();
  const sample = store.mode === "sample";
  const id = useId();
  const [measures, setMeasures] = useState("");
  const [audience, setAudience] = useState<NeighborAudience>("meeting");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ n: number; value: NeighborDraftResult } | null>(null);
  const empty = measures.trim() === "";

  async function create() {
    if (busy || empty || measures.length > MAX_INPUT) return;
    setBusy(true);
    setFailed(false);
    try {
      let value: NeighborDraftResult;
      if (sample) {
        // 見本の画面は Firebase にも Claude にもつながない。雛形に入力の文を入れて見せる
        value = { farmPart: neighborTemplate(measures, audience), officialPart: neighborOfficialPart(), source: "template", failures: [] };
      } else {
        const { draftNeighborExplainerCall } = await import("../auth/callables");
        value = await draftNeighborExplainerCall(measures, audience);
      }
      setResult((prev) => ({ n: (prev?.n ?? 0) + 1, value }));
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>平時の説明文を作る</h2>
      <p>{EXPLAINER_TEXT.intro}</p>
      <div className="settings-form">
        <label htmlFor={`${id}-measures`}>農場でしている対策</label>
        <p className="settings-note" id={`${id}-hint`}>
          防鳥ネット、入退場の記録、消毒の場所など、していることを書いてください。数字は、書いたものだけが使われます。
        </p>
        <textarea
          id={`${id}-measures`}
          className="explainer-text"
          rows={6}
          maxLength={MAX_INPUT}
          aria-describedby={`${id}-hint ${id}-count`}
          value={measures}
          onChange={(e) => setMeasures(e.target.value)}
        />
        <p className="settings-note" id={`${id}-count`}>
          {Array.from(measures).length} / {MAX_INPUT} 字
        </p>

        <fieldset className="settings-choice">
          <legend>どう配りますか</legend>
          {AUDIENCES.map((a) => (
            <label key={a.value} className="settings-check">
              <input type="radio" name={`${id}-audience`} checked={audience === a.value} onChange={() => setAudience(a.value)} />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>

        <p className="settings-note">下書きを作れる回数には、1 日の上限があります。</p>
        <p className="explainer-send-notice">{sample ? EXPLAINER_TEXT.sampleNotice : EXPLAINER_TEXT.sendNotice}</p>
        {result ? <p className="settings-note">作り直すと、下の下書きに加えた直しは消えます。</p> : null}
        <p>
          <Button variant="primary" disabled={busy || empty} onClick={create}>
            {busy ? "下書きを作っています" : "下書きを作る"}
          </Button>
        </p>
        {busy ? <p role="status">下書きを作っています。1 分ほどかかることがあります。</p> : null}
        {failed ? (
          <p role="alert" className="settings-error">
            下書きを作れませんでした。通信を確かめて、もう一度試してください。入力した文は残っています。
          </p>
        ) : null}
      </div>
      {result ? <Result key={result.n} result={result.value} /> : null}
    </section>
  );
}

function OutbreakSection() {
  const id = useId();
  const [text, setText] = useState(ownOutbreakNoticeTemplate);
  return (
    <section aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>自分の農場で発生したときの知らせ</h2>
      <p>
        近隣の方に知らせるときの雛形です。固定の文で、Claude には送りません。日付の空欄（　　月　　日）、【疑い／発生の確認】、問い合わせ先の空欄を、あなたが埋めてください。
      </p>
      <textarea
        className="explainer-text"
        aria-label="発生したときの知らせ（直して使えます）"
        rows={14}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p>
        <CopyButton text={text} label="知らせをコピーする" />
      </p>
      <p className="settings-note">{EXPLAINER_TEXT.distribute}家畜保健衛生所や県の指示を先に確かめてから、配ってください。</p>
    </section>
  );
}

function ExplainerBody() {
  return (
    <div className="settings-page explainer-page">
      <h1>{EXPLAINER_TEXT.heading}</h1>
      <PeacetimeSection />
      <OutbreakSection />
      <p className="settings-note">
        <Link to="/privacy">プライバシーの説明</Link>に、Claude に渡すものを書いています。
      </p>
    </div>
  );
}

export default function ExplainerPage() {
  return (
    <RequireMember>
      <ExplainerBody />
    </RequireMember>
  );
}
