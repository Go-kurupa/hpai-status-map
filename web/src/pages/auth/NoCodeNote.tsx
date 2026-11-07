import { Link } from "react-router";

/**
 * 招待コードの欄の下の案内。コードを持たない人の行き止まりにしない（2026-11-07 作者の了承、案 1）。
 * 会員は招待制のまま。登録せずに試せる見本の農場へ案内する
 */
export function NoCodeNote() {
  return (
    <p className="auth-note">
      招待コードは運営者から受け取ります。コードがなくても、見本の農場で記録を試せます。{" "}
      <Link to="/sample" className="tap-link">
        見本の農場で試す
      </Link>
    </p>
  );
}
