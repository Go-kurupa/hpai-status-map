import { Link } from "react-router";

/**
 * 招待コードの欄の下の案内。会員は招待制のまま。
 * コードのない人を行き止まりにしない（2026-11-07 作者の了承）。見本の農場（/sample）はサイトの中からリンクしない（2026-11-08。提出フォームでだけ案内する）ので、去年の再現へ案内する
 */
export function NoCodeNote() {
  return (
    <p className="auth-note">
      招待コードは運営者から受け取ります。コードがなくても、<Link to="/replay">去年の再現</Link>で、発生の広がりと知らせの様子を見られます。
    </p>
  );
}
