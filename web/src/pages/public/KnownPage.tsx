import { Link } from "react-router";
import { KNOWN_FINDINGS, type KnownFinding } from "./knownFindings";
import "./public.css";

/**
 * 分かっていること（§11）。研究の知見を、決まり（公式の文）と分けて示す固定のページ。AI は答えない。入力欄は置かない。
 * 公式の文の見た目（GuidanceSection の引用ブロック）は使わない。原本で確かめた日（verifiedOn）のない文は出さない。
 */
export function KnownView({ findings }: { findings: readonly KnownFinding[] }) {
  const shown = findings.filter((f) => f.verifiedOn !== null);
  return (
    <div className="public-page known-page">
      <h1>分かっていること</h1>
      <p className="guidance-review">研究の知見です。決まりではありません。</p>
      <p>
        このページは、鳥インフルエンザについて、研究や国の報告書で分かっていることを、研究した地域と時期、確からしさ、言えないことといっしょに示したものです。
      </p>
      <p>
        質問に答える機能はありません。文章は固定で、出典と、原本を確かめた日を、それぞれ付けています。農場に求められている決まりや、公式の説明は、
        <Link to="/public">鶏を飼っていない方へ</Link>
        や、お住まいの県の窓口を見てください。このページの内容は、これからの発生を予測するものではありません。
      </p>
      <p className="guidance-map-link">
        <Link to="/">地図に戻る</Link>
      </p>

      {shown.length === 0 ? (
        <p role="status">原本で確かめが終わった文から、順に載せます。いまは準備中です。</p>
      ) : (
        <ol className="known-list">
          {shown.map((f) => (
            <li key={f.id} data-role="finding" data-id={f.id} className="guidance-notes known-finding">
              <p className="known-text">{f.text}</p>
              <p>
                研究の地域: {f.region}
                <br />
                研究の時期: {f.period}
              </p>
              <p>
                確からしさ: {f.certainty}
                {f.certaintyNote ? `（${f.certaintyNote}）` : null}
              </p>
              <p>言えないこと、限界: {f.limit}</p>
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
                （確認日 {f.verifiedOn}）
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function KnownPage() {
  return <KnownView findings={KNOWN_FINDINGS} />;
}
