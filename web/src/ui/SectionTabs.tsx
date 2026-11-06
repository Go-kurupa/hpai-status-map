import { Link, useLocation } from "react-router";

type Tab = { to: string; label: string; match: (path: string) => boolean };

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** メニューの「今季の発生」「過去の発生」の中の見方（設計書 2026-11-06-ui-frame 3 章、決定 8・9）。行き先（URL）を切り替える */
export const SECTION_TABS = {
  now: {
    label: "今季の発生の見方",
    tabs: [
      { to: "/", label: "地図", match: (p) => p === "/" },
      { to: "/season", label: "一覧と数", match: (p) => under(p, "/season") },
    ],
  },
  past: {
    label: "過去の発生の見方",
    tabs: [
      { to: "/compare", label: "全国とシーズン", match: (p) => under(p, "/compare") },
      // 用途・羽数・地方で絞る（設計書 2026-11-06-data-explore E1）
      { to: "/explore", label: "条件で見る", match: (p) => under(p, "/explore") },
      // 去年の再現は審査員向けの見本なので、ここに並べず「このサイトについて」の審査員の節から開く（決定 16）
      { to: "/town", label: "選択地域のまわり", match: (p) => under(p, "/town") || under(p, "/area") },
    ],
  },
} satisfies Record<string, { label: string; tabs: Tab[] }>;

/** 見方の切り替え。リンクなので、戻る操作と URL での直接の表示がそのまま使える。選んでいる見方に aria-current */
export function SectionTabs({ group }: { group: keyof typeof SECTION_TABS }) {
  const { pathname } = useLocation();
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const { label, tabs } = SECTION_TABS[group];
  return (
    <nav className="section-tabs" aria-label={label}>
      <ul>
        {tabs.map((t) => (
          <li key={t.to}>
            <Link to={t.to} aria-current={t.match(path) ? "page" : undefined}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
