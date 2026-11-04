import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { KNOWN_FINDINGS, type KnownFinding } from "./knownFindings";
import "./public.css";

/** "2026-11-04" → "2026 年 11 月 4 日"（PosterPage、CaseListSheet と同じ書き方） */
function formatVerifiedOn(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(y)} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 農場に求められている決まり（飼養衛生管理基準）の原本 */
const LAW_URL = "https://laws.e-gov.go.jp/law/326M50010000035";

/**
 * 分かっていること（§11）。研究の知見を、決まり（公式の文）と分けて示す固定のページ。AI は答えない。入力欄は置かない。
 * 公式の文の見た目（引用ブロックの節）は使わない。原本で確かめた日（verifiedOn）のない文は出さない。
 */
export function KnownView({ findings }: { findings: readonly KnownFinding[] }) {
  const shown = findings.filter((f) => f.verifiedOn !== null);
  // /known#neighbor-cases などで来たとき、該当の行へ移る（ルーターはハッシュの位置までは動かさない）
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.length > 1) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash]);
  return (
    <div className="public-page known-page">
      <h1>分かっていること</h1>
      <p className="guidance-review">研究の知見です。決まりではありません。</p>
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
        <>
          <nav aria-label="もくじ" className="guidance-toc known-toc">
            <ul>
              {shown.map((f) => (
                <li key={f.id}>
                  <a href={`#${f.id}`}>{f.heading}</a>
                </li>
              ))}
            </ul>
          </nav>
          <ol className="known-list">
            {shown.map((f) => (
              <li key={f.id} id={f.id} data-role="finding" data-id={f.id} className="guidance-notes known-finding">
                <h2 className="known-heading">{f.heading}</h2>
                {f.text.split("\n").map((para) => (
                  <p key={para} className="known-text">
                    {para}
                  </p>
                ))}
                <p className="known-meta">
                  研究の地域: {f.region}
                  <br />
                  研究の時期: {f.period}
                </p>
                <p className="known-meta">
                  確からしさ: {f.certainty}
                  {f.certaintyNote ? `（${f.certaintyNote}）` : null}
                </p>
                <div className="known-limit">
                  <h3>言えないこと、限界</h3>
                  <ul>
                    {f.limit.split("\n").map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
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
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export default function KnownPage() {
  return <KnownView findings={KNOWN_FINDINGS} />;
}
