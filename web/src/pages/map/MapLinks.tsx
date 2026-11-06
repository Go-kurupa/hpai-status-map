import { Link } from "react-router";

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/public", label: "鶏を飼っていない方へ" },
  { to: "/known", label: "分かっていること" },
  { to: "/trends", label: "全国の傾向" },
  { to: "/replay", label: "去年の再現" },
  { to: "/sample", label: "記録の画面を試す" },
  { to: "/results", label: "試験の結果" },
  { to: "/privacy", label: "プライバシー" },
];

/** 地図の下の固定のリンク。タブは 3 つのまま増やさない（設計書 §15） */
export function MapLinks() {
  return (
    <nav className="map-links" aria-label="ほかのページ">
      <ul>
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const NEXT: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/town", label: "自分の町の過去を見る" },
  { to: "/season", label: "今季の一覧と数を見る" },
  { to: "/compare", label: "過去シーズンと比べる" },
];

/** 最初の画面の地図の下から、次の画面へ（設計書 2026-11-06-ui-frame 4.1）。ほかのページはメニューから */
export function NextLinks() {
  return (
    <nav className="next-links" aria-label="次の画面">
      <ul>
        {NEXT.map((l) => (
          <li key={l.to}>
            <Link to={l.to}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
