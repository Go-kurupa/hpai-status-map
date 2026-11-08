import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useMemberMark } from "../data/memberMark";

export const OPERATOR_NOTE = "民間の運営です。国や県の公式のサイトではありません。";

export type ShellMode = "replay" | "sample" | null;

/** 再現と、近くで発生した場合の見え方（/sample）の中だけに出す、上の帯の文と終わるリンク（帯は 1 本だけ） */
export const CONTEXT_BAND = {
  replay: { text: "去年の再現を見ています", end: "再現を終わる" },
  sample: { text: "去年 12 月の再現です（近くで発生した場合の見え方）", end: "再現を終わる" },
} as const;
export type MenuItem = { to: string; label: string; current: boolean };
/** farm: 養鶏事業者の方（関係者向け）。一番下に置き、緑の枠と文字で見分ける（2026-11-07 作者の決定 案 A） */
export type MenuGroup = { label: string; items: MenuItem[]; collapsible?: boolean; farm?: boolean };

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * 道筋と会員の印から、今の画面の帯の種類と、メニューの項目・選択中を決める（設計書 2026-11-06-ui-frame 3 章）。
 * 近くで発生した場合の見え方（/sample）の中は、1 本目の審査員用のリンクと同じ並び・同じ名前にし、「今季の発生」を /sample の地図へ、
 * 「対策項目」を /sample/todo へ向ける。見本だけの項目、会員の項目、会員のログイン、設定は出さない（2026-11-08 作者の決定）。
 * それ以外は、記録と設定を会員の印があるときだけ出し、ないときは会員のログインを出す（決定 15）。
 * 去年の再現はメニューに並べず、「このサイトについて」から開く（決定 16）。/sample は、メニューにもサイトの案内にも並べず、
 * 再現の中の『近くで発生した場合の見え方』と提出フォームの審査員向けの欄から開く（2026-11-08）。
 */
export function shellContextOf(pathname: string, member = false): { mode: ShellMode; groups: MenuGroup[]; currentLabel: string | null } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const mode: ShellMode = under(path, "/replay") ? "replay" : under(path, "/sample") ? "sample" : null;
  const prefix = mode === "sample" ? "/sample" : "";
  const item = (to: string, label: string, current: boolean): MenuItem => ({ to, label, current });
  // 対策項目は会員でなくても使える（地図で選んだ町や地点を使う）ので、いつも出す（2026-11-06 作者の決定）
  const farm: MenuItem[] = [item(`${prefix}/todo`, "対策項目", under(path, `${prefix}/todo`))];
  // /sample の中は対策項目だけ（地図は「今季の発生」）
  if (mode !== "sample" && member) {
    farm.push(item("/consult", "AIに対策を相談", under(path, "/consult")));
    farm.push(item("/record/deaths", "死亡・消毒の記録", under(path, "/record")));
    farm.push(item("/settings/farm", "農場と通知の設定", under(path, "/settings")));
  } else if (mode !== "sample") {
    farm.push(item("/login", "会員のログイン", under(path, "/login") || under(path, "/join")));
  }
  // 設計書 2026-11-06-ui-frame 3 章（決定 8〜16）。今季と過去は中の切り替え（SectionTabs）で見方を選ぶ
  // 養鶏事業者の方は一番下（関係者向け。2026-11-07 作者の決定 案 A）
  const groups: MenuGroup[] = [
    {
      label: "発生状況",
      items: [
        mode === "sample" ? item("/sample", "今季の発生", path === "/sample") : item("/", "今季の発生", path === "/" || under(path, "/season")),
        // 再現はメニューにも切り替えにも並べないが、中にいる間は今までどおり過去の発生を選択中にする（決定 16）
        item("/compare", "過去の発生", under(path, "/compare") || under(path, "/town") || under(path, "/area") || mode === "replay"),
        item("/trends", "発生傾向", under(path, "/trends")),
      ],
    },
    {
      label: "鳥インフルエンザとは",
      items: [item("/known", "分かっていること", under(path, "/known")), item("/public", "鶏を飼っていない方へ", under(path, "/public"))],
    },
    {
      // 1 項目だけなので見出しを出さない（項目と同じ名前を 2 回並べない）
      label: "",
      items: [item("/about", "このサイトについて", under(path, "/about") || under(path, "/results") || under(path, "/privacy"))],
    },
    {
      label: "養鶏事業者の方",
      // 掲示用の貼り紙は入口だけ外した（画面と /poster は残す。2026-11-06 作者の決定: 入口の注意の紙は各自で作れる）
      items: farm,
      farm: true,
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
          <div key={gi} className={g.farm ? "menu-group menu-group-farm" : "menu-group"}>
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
  const member = useMemberMark();
  const { mode, groups } = shellContextOf(pathname, member);
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
        {/* 設定は会員だけ（会員でない人の入口はメニューの「会員のログイン」の 1 か所。決定 15） */}
        {mode === "sample" || !member ? null : (
          <Link className="settings-link" to="/settings/farm">
            設定
          </Link>
        )}
      </header>
      {mode ? (
        <div className="app-context">
          <span>{CONTEXT_BAND[mode].text}</span>
          <Link to="/" className="tap-link">
            {CONTEXT_BAND[mode].end}
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
