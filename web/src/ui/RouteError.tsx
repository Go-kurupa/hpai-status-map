import { useEffect } from "react";
import { Link, useRouteError } from "react-router";
import { OPERATOR_NOTE } from "./AppShell";
import { isStaleChunkError, reloadOnceForStaleChunk } from "./staleChunk";

/** 予期しない例外の画面。開発用の英語の画面は出さず、開き直しとトップへの道だけを示す */
export function RouteError() {
  const error = useRouteError();
  // 本番を出し直した後の古い部品のファイルの読み込みの失敗なら、1 回だけ読み込み直す（vite:preloadError を通らない経路の備え）
  useEffect(() => {
    if (isStaleChunkError(error)) reloadOnceForStaleChunk({ storage: window.sessionStorage, reload: () => window.location.reload(), now: Date.now() });
  }, [error]);
  return (
    <div className="app-shell">
      <main className="app-main" role="alert">
        <h1>表示中に問題が起きました</h1>
        <p>ページを開き直してください。直らないときは、時間をおいてもう一度開いてください。</p>
        <p>
          <Link to="/">トップに戻る</Link>
        </p>
      </main>
      <p className="app-operator-note">{OPERATOR_NOTE}</p>
    </div>
  );
}
