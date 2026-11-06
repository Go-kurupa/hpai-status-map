import { Link } from "react-router";

/**
 * 鶏を飼っていない方へ（/public）の「いまの発生」への案内（設計書 2026-11-06-public-known-redesign §6）。
 * このページは Firebase を読まない決まり（e2e/shell.spec.ts「公開の画面に Firebase を載せない」）なので、
 * 件数はここに出さず、地図の画面へ案内する。町は推測しない（「お近くで発生」とは書かない）。
 */
export function PublicNow() {
  return (
    <section className="public-now" aria-labelledby="public-now-heading" data-role="public-now">
      <h2 id="public-now-heading">いまの発生を見る</h2>
      <p className="public-now-count">全国の農場の発生の件数と、町ごとのようすは、地図の画面で見られます。</p>
      <p className="public-now-links">
        <Link to="/">今季の発生（地図で自分の町のようすを見る）</Link>
        <Link to="/compare">過去の発生</Link>
      </p>
    </section>
  );
}
