import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

export type ShellMode = "replay" | "sample" | null;
export type ShellTab = { to: string; label: string; current: boolean };

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** 道筋から、今の画面の帯の種類と、下のタブの行き先・選択中を決める */
export function shellContextOf(pathname: string): { mode: ShellMode; tabs: ShellTab[] } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const mode: ShellMode = under(path, "/replay") ? "replay" : under(path, "/sample") ? "sample" : null;
  const prefix = mode === "sample" ? "/sample" : "";
  const todoBase = `${prefix}/todo`;
  const recordBase = `${prefix}/record`;
  return {
    mode,
    tabs: [
      { to: "/", label: "地図", current: path === "/" },
      { to: todoBase, label: "やること", current: under(path, todoBase) },
      { to: `${recordBase}/deaths`, label: "記録", current: under(path, recordBase) },
    ],
  };
}

/** 画面の骨格: 上に題と「設定」、再現・見本の中だけ今の画面の帯、下にタブ 3 つ（地図、やること、記録） */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { mode, tabs } = shellContextOf(pathname);
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-title">
          <Link to="/">鳥インフル発生状況マップ</Link>
        </p>
        {mode === "sample" ? null : (
          <Link className="settings-link" to="/settings/farm">
            設定
          </Link>
        )}
      </header>
      {mode ? (
        <div className="app-context">
          <span>{mode === "replay" ? "去年の再現を見ています" : "見本の農場を見ています"}</span>
          <Link to="/" className="tap-link">
            {mode === "replay" ? "再現を終わる" : "見本を終わる"}
          </Link>
        </div>
      ) : null}
      <main className="app-main">{children}</main>
      <nav className="app-nav" aria-label="メイン">
        {tabs.map((t) => (
          <Link key={t.label} to={t.to} aria-current={t.current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
