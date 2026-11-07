import { Link } from "react-router";
import { REGIONS, type RegionId } from "../../geo/regions";

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/public", label: "鶏を飼っていない方へ" },
  { to: "/known", label: "分かっていること" },
  { to: "/trends", label: "発生傾向" },
  { to: "/replay", label: "去年の再現" },
  { to: "/sample", label: "記録を試す" },
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
  { to: "/town", label: "選んだ地域の過去を見る" },
  { to: "/season", label: "今季の一覧と数を見る" },
  { to: "/compare", label: "過去の発生を地図で比べる" },
];

/**
 * 最初の画面の地図の下から、次の画面へ（設計書 2026-11-06-ui-frame 4.1）。ほかのページはメニューから。
 * hideTown: 自分の町の欄の過去の行に「選択地域の過去を見る」が出ているとき、同じリンクを重ねない（2026-11-07 精査 M3）。
 * 町が未選択や過去が読めないときは、ここが選択地域の過去への入口なので残す
 */
export function NextLinks({ hideTown = false }: { hideTown?: boolean }) {
  return (
    <nav className="next-links" aria-label="次の画面">
      <ul>
        {NEXT.filter((l) => !(hideTown && l.to === "/town")).map((l) => (
          <li key={l.to}>
            <Link to={l.to}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 地図で比べる（/compare）から数で見る（/explore）へ。いま寄せている地方を渡す（2026-11-07 作者の決定 案 A）。
 * 全国のときは地方を付けない。シーズンの棒・月の棒・事例の一覧は数で見るの画面にある
 */
export function ExploreLink({ region }: { region: RegionId | null }) {
  const r = region === null ? null : (REGIONS.find((x) => x.id === region) ?? null);
  return (
    <p className="explore-link">
      シーズンごと・月ごとの件数と事例の一覧は、{" "}
      <Link to={r ? `/explore?region=${r.id}` : "/explore"} className="tap-link">
        数で{r ? r.name : "全国"}を見る
      </Link>
    </p>
  );
}
