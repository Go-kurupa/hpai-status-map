import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

const TABS: ReadonlyArray<{ to: string; label: string; end: boolean }> = [
  { to: "/", label: "地図", end: true },
  { to: "/todo", label: "やること", end: false },
  { to: "/record", label: "記録", end: false },
];

/** 画面の骨格: 上に題と「設定」、下にタブ 3 つ（地図、やること、記録） */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-title">
          <Link to="/">鳥インフル発生状況マップ</Link>
        </p>
        <Link className="settings-link" to="/settings/farm">
          設定
        </Link>
      </header>
      <main className="app-main">{children}</main>
      <nav className="app-nav" aria-label="メイン">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
