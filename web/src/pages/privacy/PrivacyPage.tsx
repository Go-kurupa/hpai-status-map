import type { IsoDate } from "@hpai/shared/types";
import { Link } from "react-router";
import { PRIVACY_NOTICE, PRIVACY_REVIEWED_ON } from "./privacyNotice";

/** 運営者名はビルド時の環境変数だけから読む（ソースに書かない）。空や空白だけは未設定として扱う */
function operatorName(): string | null {
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

/** 文面と確認日を並べる。reviewedOn は試験で値を差し替えるために引数にしている */
export function PrivacyContent({ reviewedOn }: { reviewedOn: IsoDate | null }) {
  const operator = operatorName();
  return (
    <div className="privacy">
      <h1>プライバシー</h1>
      <p>この作品が何を集め、どこに保存し、どう消せるかの説明です。</p>
      <ReviewStatus reviewedOn={reviewedOn} />
      {PRIVACY_NOTICE.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
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
                <Link to="/settings/notify">配信停止と知らせの設定</Link>
              </li>
              <li>
                <Link to="/record">全データの削除（記録の画面）</Link>
              </li>
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent reviewedOn={PRIVACY_REVIEWED_ON} />;
}
