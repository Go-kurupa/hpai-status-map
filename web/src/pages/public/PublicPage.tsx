import { OFFICIAL_GUIDANCE, OFFICIAL_GUIDANCE_REVIEWED_ON } from "@hpai/shared/guidance/official";
import type { IsoDate } from "@hpai/shared/types";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { GuidanceSection } from "./GuidanceSection";
import { agencyOf, PAGE_NOTES, SECTION_LEADS, SECTION_RELATED, STATEMENT_NOTES, TOPIC_QUESTION } from "./pageNotes";
import { PublicNow } from "./PublicNow";
import "./public.css";

/** 家畜保健衛生所の全国の一覧（official.ts の small_flock の links と同じ） */
const KAHO_LIST_URL = "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_kaho/";

/** 節の国の文の数と、機関（出てきた順）。もくじで「どこの文が何個あるか」を答えの代わりに示す */
function sourceSummary(statements: ReadonlyArray<{ sourceTitle: string }>): string {
  const agencies = [...new Set(statements.map((s) => agencyOf(s.sourceTitle)))];
  return `国の文 ${statements.length} つ: ${agencies.join("・")}`;
}

/**
 * 鶏を飼っていない方へ（§11）。登録なしで読める固定のページ。AI は答えない。入力欄は置かない。
 * 上から: 疑問の形のもくじ（答えは書かず、国の文の数と機関だけ）→ いまの発生への案内（件数は出さない。Firebase を読まない）→ 相談先 → 各節。
 * 各節は、すること 1 行（作品側のまとめ、4 節だけ）→ 国の文（原文、畳まない）→ 県のリンク → お願い → 関係する画面。
 */
export function PublicView({ reviewedOn }: { reviewedOn: IsoDate | null }) {
  // /public#burial などで来たとき、該当の節へ移る（ルーターはハッシュの位置までは動かさない）
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.length > 1) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash]);
  return (
    <div className="public-page">
      <h1>鶏を飼っていない方へ</h1>
      <nav aria-label="もくじ" className="guidance-toc public-toc">
        <p className="public-toc-head">よく聞かれること（押すと、その国の文へ移ります）</p>
        <ul>
          {OFFICIAL_GUIDANCE.map((g) => (
            <li key={g.topic}>
              <a href={`#${g.topic}`}>
                <span className="public-toc-q">{TOPIC_QUESTION[g.topic]}</span>
                <span className="public-toc-src">{sourceSummary(g.statements)}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <PublicNow />
      <aside data-role="contacts" className="guidance-notes public-contacts" aria-labelledby="public-contacts-heading">
        <h2 id="public-contacts-heading">相談先（国の文にある窓口。作品側のまとめ）</h2>
        <ul>
          <li>死んだ野鳥のこと: お近くの都道府県や市町村の役場</li>
          <li>飼っている鳥が、原因の分からないまま続けて死んだとき: 獣医師や、お近くの都道府県、市町村の役場</li>
          <li>
            鶏などを飼っていて、決められた症状を見つけたときの通報先: 家畜保健衛生所（
            <a href={KAHO_LIST_URL} target="_blank" rel="noopener noreferrer">
              全国の一覧
            </a>
            ）
          </li>
        </ul>
      </aside>
      <p>
        このページは、近くの養鶏場や、鳥インフルエンザのことで、ご近所の方からよく聞かれることを、国の文書にそって示したものです。
      </p>
      <p>
        質問に答える機能はありません。文章は固定で、出典と、原本を確かめた日を、それぞれ付けています。国や県の文書は、あとで変わることがあります。くわしくは、お住まいの県の窓口に聞いてください。
      </p>
      {reviewedOn === null ? (
        <p className="guidance-review" role="status">
          文面は確認中です。作者と共同経営者の確認が終わるまで、文面が変わることがあります。
        </p>
      ) : (
        <p className="guidance-review">文面を確認した日: {reviewedOn}（各文の確認日は、国の文の原本と照らした日です）</p>
      )}

      {OFFICIAL_GUIDANCE.map((g) => (
        <GuidanceSection
          key={g.topic}
          guidance={g}
          notes={PAGE_NOTES[g.topic]}
          statementNotes={STATEMENT_NOTES.filter((n) => n.topic === g.topic)}
          lead={SECTION_LEADS[g.topic]}
          related={SECTION_RELATED[g.topic]}
        >
          {g.topic === "small_flock" ? (
            <p className="guidance-map-link">
              <Link to="/">地図を見る（地域の状況）</Link>
            </p>
          ) : null}
        </GuidanceSection>
      ))}
    </div>
  );
}

export default function PublicPage() {
  return <PublicView reviewedOn={OFFICIAL_GUIDANCE_REVIEWED_ON} />;
}
