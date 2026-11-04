import { Link } from "react-router";

/** 予期しない例外の画面。開発用の英語の画面は出さず、開き直しとトップへの道だけを示す */
export function RouteError() {
  return (
    <div className="app-shell">
      <main className="app-main" role="alert">
        <h1>表示中に問題が起きました</h1>
        <p>表示中に問題が起きました。ページを開き直してください。</p>
        <p>
          <Link to="/">トップにもどる</Link>
        </p>
      </main>
    </div>
  );
}
