// 農場の設定と通知の設定の切り替え（2026-11-07 業務画面の作り直し）。
// 見た目は「今季の発生」などの見方の切り替え（ui/SectionTabs.tsx の nav.section-tabs）と同じ。リンクなので戻る操作と URL での表示がそのまま使える。
import { Link, useLocation } from "react-router";

const TABS = [
  { to: "/settings/farm", label: "農場" },
  { to: "/settings/notify", label: "通知" },
] as const;

export function SettingsTabs() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "");
  return (
    <nav className="section-tabs" aria-label="設定の切り替え">
      <ul>
        {TABS.map((t) => (
          <li key={t.to}>
            <Link to={t.to} aria-current={path === t.to ? "page" : undefined}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
