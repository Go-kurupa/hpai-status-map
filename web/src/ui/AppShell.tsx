import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

export const OPERATOR_NOTE = "民間の運営です。国や県の公式のサイトではありません。";

export type ShellMode = "replay" | "sample" | null;
export type MenuItem = { to: string; label: string; current: boolean; member?: boolean };
export type MenuGroup = { label: string; items: MenuItem[]; collapsible?: boolean };

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * 道筋から、今の画面の帯の種類と、メニューの項目・選択中を決める（設計書 2026-11-06-ui-frame 3 章）。
 * 見本の中は「自分の農場」を見本の画面へ向け、設定を出さない（今までの見本の決まり）。
 */
export function shellContextOf(pathname: string): { mode: ShellMode; groups: MenuGroup[]; currentLabel: string | null } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const mode: ShellMode = under(path, "/replay") ? "replay" : under(path, "/sample") ? "sample" : null;
  const prefix = mode === "sample" ? "/sample" : "";
  const item = (to: string, label: string, current: boolean, member = false): MenuItem => (member ? { to, label, current, member } : { to, label, current });
  const farm: MenuItem[] = [
    item(`${prefix}/todo`, "やること", under(path, `${prefix}/todo`), true),
    item(`${prefix}/record/deaths`, "記録", under(path, `${prefix}/record`), true),
  ];
  if (mode !== "sample") farm.push(item("/settings/farm", "農場と知らせの設定", under(path, "/settings"), true));
  // 設計書 2026-11-06-ui-frame 3 章（決定 8〜13）。11 項目。今季と過去は中の切り替え（SectionTabs）で見方を選ぶ
  const groups: MenuGroup[] = [
    {
      label: "発生状況",
      items: [
        item("/", "今季の発生", path === "/" || under(path, "/season")),
        item("/compare", "過去の発生", under(path, "/compare") || under(path, "/town") || under(path, "/area") || mode === "replay"),
        item("/trends", "全国の傾向", under(path, "/trends")),
      ],
    },
    {
      label: "自分の農場",
      items: [
        ...farm,
        item("/poster", "掲示用の貼り紙", under(path, "/poster")),
        item("/sample", "見本で試す", mode === "sample" && !farm.some((f) => f.current)),
      ],
    },
    {
      label: "読みもの",
      items: [item("/known", "分かっていること", under(path, "/known")), item("/public", "鶏を飼っていない方へ", under(path, "/public"))],
    },
    {
      // 1 項目だけなので見出しを出さない（項目と同じ名前を 2 回並べない）
      label: "",
      items: [item("/about", "このサイトについて", under(path, "/about") || under(path, "/results") || under(path, "/privacy"))],
    },
  ];
  const currentLabel = groups.flatMap((g) => g.items).find((i) => i.current)?.label ?? null;
  return { mode, groups, currentLabel };
}

function Menu({ groups, onPick }: { groups: MenuGroup[]; onPick: () => void }) {
  return (
    <>
      {groups.map((g, gi) => {
        const links = (
          <ul className="menu-list">
            {g.items.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="menu-link" aria-current={i.current ? "page" : undefined} onClick={onPick}>
                  <span>{i.label}</span>
                  {i.member ? <span className="menu-tag">会員</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        );
        return g.collapsible ? (
          <details key={gi} className="menu-group menu-more" open={g.items.some((i) => i.current) || undefined}>
            <summary className="menu-group-label">{g.label}</summary>
            {links}
          </details>
        ) : (
          <div key={gi} className="menu-group">
            {g.label ? <p className="menu-group-label">{g.label}</p> : null}
            {links}
          </div>
        );
      })}
    </>
  );
}

/** 画面の替わり目で、読み上げとキーボードの位置を新しい画面の題へ移す（題が後から描かれるので少し待つ） */
function useFocusTitleOnRouteChange(pathname: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      const h1 = document.querySelector<HTMLElement>(".app-main h1");
      if (h1 || ++tries > 20) {
        window.clearInterval(id);
        if (!h1) return;
        if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
        h1.focus({ preventScroll: true });
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [pathname]);
}

/**
 * 画面の骨格（設計書 2026-11-06-ui-frame）: PC は左に固定のメニュー、スマホは上の三本線から全画面のメニュー。
 * 上に題、再現・見本の中だけ今の画面の帯、本文の下に民間の運営の 1 行。下のタブは置かない。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { mode, groups } = shellContextOf(pathname);
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useFocusTitleOnRouteChange(pathname);
  useEffect(() => setOpen(false), [pathname]);
  // 開いたらメニューの中へ、Escape で閉じて三本線へ戻す
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(".menu-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      menuBtn.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) menuBtn.current?.focus();
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <button ref={menuBtn} type="button" className="menu-btn" aria-label="メニューを開く" aria-expanded={open} aria-controls="app-menu" onClick={() => setOpen(true)}>
          <span aria-hidden="true">☰</span>
        </button>
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
      <div className="app-body">
        <nav ref={panel} id="app-menu" className={open ? "app-menu is-open" : "app-menu"} aria-label="メニュー">
          <div className="menu-head">
            <button type="button" className="menu-close" aria-label="メニューを閉じる" onClick={() => close(true)}>
              <span aria-hidden="true">×</span>
            </button>
            <span>メニュー</span>
          </div>
          <Menu groups={groups} onPick={() => close(false)} />
        </nav>
        <div className="app-content">
          <main className="app-main">{children}</main>
          <p className="app-operator-note">{OPERATOR_NOTE}</p>
        </div>
      </div>
    </div>
  );
}
