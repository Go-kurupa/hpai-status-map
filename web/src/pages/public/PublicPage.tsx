import { OFFICIAL_GUIDANCE, OFFICIAL_GUIDANCE_REVIEWED_ON } from "@hpai/shared/guidance/official";
import type { IsoDate } from "@hpai/shared/types";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { GuidanceSection } from "./GuidanceSection";
import { PAGE_NOTES, STATEMENT_NOTES } from "./pageNotes";
import "./public.css";

/** 鶏を飼っていない方へ（§11）。登録なしで読める固定のページ。AI は答えない。入力欄は置かない */
export function PublicView({ reviewedOn }: { reviewedOn: IsoDate | null }) {
  // /public#burial などで来たとき、該当の節へ移る（ルーターはハッシュの位置までは動かさない）
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.length > 1) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash]);
  return (
    <div className="public-page">
      <h1>鶏を飼っていない方へ</h1>
      <nav aria-label="もくじ" className="guidance-toc">
        <ul>
          {OFFICIAL_GUIDANCE.map((g) => (
            <li key={g.topic}>
              <a href={`#${g.topic}`}>{g.heading}</a>
            </li>
          ))}
        </ul>
      </nav>
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
        <p className="guidance-review">文面を確認した日: {reviewedOn}</p>
      )}

      {OFFICIAL_GUIDANCE.map((g) => (
        <GuidanceSection key={g.topic} guidance={g} notes={PAGE_NOTES[g.topic]} statementNotes={STATEMENT_NOTES.filter((n) => n.topic === g.topic)}>
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
