import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { KnownFigureView } from "./KnownFigure";
import { Illust, ILLUST_NAMES, type IllustName } from "./Illust";
import { AUDIENCE_LABEL, KNOWN_FINDINGS, PAST_BASIS, type Audience, type KnownFinding } from "./knownFindings";
import "./public.css";

/** "2026-11-04" → "2026 年 11 月 4 日"（PosterPage、CaseListSheet と同じ書き方） */
function formatVerifiedOn(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(y)} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 農場に求められている決まり（飼養衛生管理基準）の原本 */
const LAW_URL = "https://laws.e-gov.go.jp/law/326M50010000035";

/** 確からしさを形でも示す（色だけに頼らない）。読み上げは文字の「高い」などで足りるので、形は隠す */
const CERTAINTY_STEPS: Record<KnownFinding["certainty"], number> = { 高い: 3, 中くらい: 2, 低い: 1 };

function CertaintyMark({ certainty }: { certainty: KnownFinding["certainty"] }) {
  const n = CERTAINTY_STEPS[certainty];
  return (
    <span className="known-certainty-mark" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "on" : "off"} />
      ))}
    </span>
  );
}

const AUDIENCES: readonly Audience[] = ["farm", "small", "neighbor"];

/**
 * 分かっていること（§11）。研究の知見を、決まり（公式の文）と分けて示す固定のページ。AI は答えない。入力欄は置かない。
 * 公式の文の見た目（引用ブロックの節）は使わない。原本で確かめた日（verifiedOn）のない文は出さない。
 * 上から: 確からしさの一覧（目次を兼ねる）→ 読む人ごとの入口 → 各知見（本文、図、限界の要の 1 行は常に出し、残りの限界は畳む）。
 * 畳んだ限界は、/known#id で来たときと印刷のときは開く（貼り紙や町の案内から来た人が根拠を見ずに終わらないように）。
 */
export function KnownView({ findings }: { findings: readonly KnownFinding[] }) {
  const shown = findings.filter((f) => f.verifiedOn !== null);
  // /known#neighbor-cases などで来たとき、該当の行の限界を開いて、その行へ移る（ルーターはハッシュの位置までは動かさない）
  // 同じ #id へもう一度来たとき（key が変わる）も、もう一度開く
  const { hash, key } = useLocation();
  useEffect(() => {
    if (hash.length <= 1) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    const more = el?.querySelector("details.known-more");
    if (more instanceof HTMLDetailsElement) more.open = true;
    el?.scrollIntoView?.();
  }, [hash, key]);
  // 印刷では、畳んだ限界もすべて出す
  useEffect(() => {
    const openAll = () => {
      for (const d of document.querySelectorAll("details.known-more")) (d as HTMLDetailsElement).open = true;
    };
    window.addEventListener("beforeprint", openAll);
    return () => window.removeEventListener("beforeprint", openAll);
  }, []);
  return (
    <div className="public-page known-page">
      <h1>分かっていること</h1>
      {shown.length > 0 ? (
        <nav aria-label="もくじ" className="guidance-toc known-toc">
          <table className="known-overview">
            <caption>研究や国の報告書で分かっていること（{shown.length} 件）と、その確からしさ</caption>
            <thead>
              <tr>
                <th scope="col">分かっていること</th>
                <th scope="col">確からしさ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id}>
                  <th scope="row">
                    <a href={`#${f.id}`}>{f.heading}</a>
                  </th>
                  <td>
                    <span className="known-certainty">
                      <CertaintyMark certainty={f.certainty} />
                      {f.certainty}
                    </span>
                    <span className="known-scope">評価の対象: {f.scope}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </nav>
      ) : null}
      <p className="guidance-review">研究の知見です。決まりではありません。</p>
      {shown.length > 0 && PAST_BASIS.verifiedOn !== null ? (
        // 「他人事ではない」の根拠（設計書 2026-11-03 §11）。研究の知見ではなく国の報告書の原文なので、知見のカードと別の枠に置く。
        // 報告書自身が「推察される」と書く文なので、断定に見せない。引用ブロック（決まりの見た目）は使わない（2026-11-07 作者の決定）
        <figure data-role="past-basis" className="known-basis">
          <figcaption>国の報告書の一文（原文。研究の知見とは別です）</figcaption>
          <p className="known-basis-text">「{PAST_BASIS.text}」</p>
          <p className="source-line">
            出典:{" "}
            <a href={PAST_BASIS.sourceUrl} target="_blank" rel="noopener noreferrer">
              {PAST_BASIS.sourceTitle}
            </a>
            （確認日 {formatVerifiedOn(PAST_BASIS.verifiedOn)}）
          </p>
        </figure>
      ) : null}
      {shown.length > 0 ? (
        <section className="known-audiences" aria-labelledby="known-audiences-heading">
          <h2 id="known-audiences-heading">読む方ごとに、まず見るところ</h2>
          <ul>
            {AUDIENCES.map((a) => {
              const mine = shown.filter((f) => f.audiences.includes(a));
              if (mine.length === 0) return null;
              return (
                <li key={a} data-audience={a}>
                  <span className="known-audience-label">{AUDIENCE_LABEL[a]}</span>
                  <span className="known-audience-links">
                    {mine.map((f) => (
                      <a key={f.id} href={`#${f.id}`}>
                        {f.heading}
                      </a>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p>
        このページは、鳥インフルエンザについて、研究や国の報告書で分かっていることを、研究した地域と時期、確からしさ、言えないこととあわせて示したものです。
      </p>
      <p>
        質問に答える機能はありません。文章は固定で、出典と、原本を確かめた日を、それぞれ付けています。このページの内容は、これからの発生を予測するものではありません。
      </p>
      <p>
        農場に求められている決まりは、
        <a data-role="law-link" href={LAW_URL} target="_blank" rel="noopener noreferrer">
          e-Gov の家畜伝染病予防法施行規則（飼養衛生管理基準）
        </a>
        と、お住まいの県の窓口で確かめてください。鶏を飼っていない方への国の説明は、
        <Link to="/public">鶏を飼っていない方へ</Link>
        にあります。
      </p>
      <p className="guidance-map-link">
        <Link to="/">地図に戻る</Link>
      </p>

      {shown.length === 0 ? (
        <p role="status">原本で確かめが終わった文から、順に載せます。いまは準備中です。</p>
      ) : (
        <ol className="known-list">
          {shown.map((f) => (
            <FindingItem key={f.id} f={f} />
          ))}
        </ol>
      )}
    </div>
  );
}

function FindingItem({ f }: { f: KnownFinding }) {
  const limits = f.limit.split("\n");
  // 位置が限界の外なら先頭を要にする（同じ行を 2 回出さない）
  const at = f.leadLimit >= 0 && f.leadLimit < limits.length ? f.leadLimit : 0;
  const lead = limits[at] ?? "";
  const rest = limits.filter((_, i) => i !== at);
  return (
    <li id={f.id} data-role="finding" data-id={f.id} className="guidance-notes known-finding">
      <h2 className="known-heading illust-heading">
        {(ILLUST_NAMES as readonly string[]).includes(f.id) ? <Illust name={f.id as IllustName} /> : null}
        <span>{f.heading}</span>
      </h2>
      <p className="known-summary">{f.summary}</p>
      <p className="known-badge">
        <span className="known-certainty">
          <CertaintyMark certainty={f.certainty} />
          確からしさ: {f.certainty}
        </span>
        <span className="known-scope">評価の対象: {f.scope}</span>
      </p>
      {f.figure ? <KnownFigureView figure={f.figure} /> : null}
      {f.text.split("\n").map((para) => (
        <p key={para} className="known-text">
          {para}
        </p>
      ))}
      <dl className="known-meta">
        <dt>研究の地域</dt>
        <dd>{f.region}</dd>
        <dt>研究の時期</dt>
        <dd>{f.period}</dd>
      </dl>
      {f.certaintyNote ? <p className="known-meta">確からしさの補足: {f.certaintyNote}</p> : null}
      <div className="known-limit">
        <h3>言えないこと、限界</h3>
        <ul>
          <li>{lead}</li>
        </ul>
        {rest.length > 0 ? (
          <details className="known-more">
            <summary>ほかの限界（{rest.length} 項目）</summary>
            <ul>
              {rest.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <p className="source-line">
        出典:{" "}
        {f.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 ? " / " : null}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
          </span>
        ))}
        （確認日 {formatVerifiedOn(f.verifiedOn as string)}）
      </p>
      {f.related.length > 0 ? (
        <p className="known-related">
          <span className="known-related-label">関係する画面:</span>
          {f.related.map((r) => (
            <Link key={r.to} to={r.to}>
              {r.label}
            </Link>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export default function KnownPage() {
  return <KnownView findings={KNOWN_FINDINGS} />;
}
