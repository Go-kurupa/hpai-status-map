import type { IsoDate } from "@hpai/shared/types";
import { Link } from "react-router";
import "./privacy.css";
import { PRIVACY_NOTICE, PRIVACY_REVIEWED_ON } from "./privacyNotice";

/** 運営者名はビルド時の環境変数だけから読む（ソースに書かない）。空や空白だけは未設定として扱う */
export function operatorName(): string | null {
  const raw: unknown = import.meta.env.VITE_OPERATOR_NAME;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name === "" ? null : name;
}

function ReviewStatus({ reviewedOn }: { reviewedOn: IsoDate | null }) {
  if (reviewedOn === null) {
    return (
      <p className="privacy-review" role="status">
        文面は確認中です。確認日はまだありません。
      </p>
    );
  }
  return <p className="privacy-review">確認日 {reviewedOn}</p>;
}

/**
 * 文面と確認日を並べる。reviewedOn は試験で値を差し替えるために引数にしている。
 * embedded は「このサイトについて」の中に置くとき（設計書 2026-11-06-ui-frame 決定 12）。題を 1 段下げ、
 * 目次と運営者の節（このサイトについての先頭に出す）と「地図にもどる」を出さない
 */
export function PrivacyContent({ reviewedOn, embedded = false }: { reviewedOn: IsoDate | null; embedded?: boolean }) {
  const operator = operatorName();
  const H = embedded ? "h3" : "h2";
  const sections = PRIVACY_NOTICE.map((section, i) => ({ section, i })).filter(({ section }) => !embedded || section.heading !== "運営者");
  return (
    <div className="privacy">
      {embedded ? null : <h1>プライバシー</h1>}
      <p>この作品が何を集め、どこに保存し、どう消せるかの説明です。</p>
      <ReviewStatus reviewedOn={reviewedOn} />
      {embedded ? null : (
        <nav aria-label="もくじ" className="privacy-toc">
          <ul>
            {PRIVACY_NOTICE.map((section, i) => (
              <li key={section.heading}>
                <a href={`#privacy-${i}`}>{section.heading}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {sections.map(({ section, i }) => (
        <section key={section.heading} id={`privacy-${i}`}>
          <H>{section.heading}</H>
          {section.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.heading === "運営者" ? (
            <p>
              {operator === null ? "運営者名は、まだ入っていません。" : `運営者: ${operator}`}
            </p>
          ) : null}
          {section.heading === "消し方" ? (
            <ul>
              <li>
                <Link to="/settings/notify" className="tap-link">配信停止と知らせの設定</Link>
              </li>
              <li>
                <Link to="/record" className="tap-link">全データの削除（記録の画面）</Link>
              </li>
            </ul>
          ) : null}
        </section>
      ))}
      {embedded ? null : (
        <p>
          <Link to="/" className="tap-link">
            地図にもどる
          </Link>
        </p>
      )}
    </div>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent reviewedOn={PRIVACY_REVIEWED_ON} />;
}
