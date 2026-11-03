import { Link } from "react-router";

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/public", label: "鶏を飼っていない方へ" },
  { to: "/known", label: "分かっていること" },
  { to: "/replay", label: "去年の再現" },
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
