import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import fs from "node:fs";
import path from "node:path";
import type { ChecklistClass } from "@hpai/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { AsOf, AsOfPrecisionContext, formatAsOf } from "./AsOf";
import { Button } from "./Button";
import { writeMemberMark } from "../data/memberMark";
import { AppShell, OPERATOR_NOTE, shellContextOf } from "./AppShell";
import { RouteError } from "./RouteError";
import { ClassBlock } from "./ClassBlock";
import { Fold } from "./Fold";
import { SourceLine } from "./SourceLine";
import { Tag } from "./Tag";

afterEach(cleanup);

const css = fs.readFileSync(path.join(import.meta.dirname, "theme.css"), "utf8");

describe("formatAsOf", () => {
  it("JST の ISO を『M 月 D 日 H:mm 時点』にする", () => {
    expect(formatAsOf("2025-12-21T09:00:00+09:00")).toBe("12 月 21 日 9:00 時点");
    expect(formatAsOf("2026-01-05T18:07:00+09:00")).toBe("1 月 5 日 18:07 時点");
  });
  it("実行する機械の時刻帯に頼らず JST で出す", () => {
    expect(formatAsOf("2025-12-21T00:00:00Z")).toBe("12 月 21 日 9:00 時点");
    expect(formatAsOf("2025-12-31T16:30:00Z")).toBe("1 月 1 日 1:30 時点");
  });
  it("読み込めない文字列は『時点』と言わない", () => {
    expect(formatAsOf("not a date")).toBe("確認できていません");
  });
});

describe("AsOf", () => {
  it("時刻があれば『時点』を出す", () => {
    render(<AsOf iso="2025-12-21T09:00:00+09:00" />);
    expect(screen.getByText("12 月 21 日 9:00 時点")).toBeTruthy();
  });
  it("null は『確認できていません』", () => {
    render(<AsOf iso={null} />);
    expect(screen.getByText("確認できていません")).toBeTruthy();
  });
});

describe("AsOf の主語（2026-11-07 B: 単独の「確認できていません」を出さない）", () => {
  it("主語を渡すと『発表の確認: 11 月 8 日 6:10 時点』", () => {
    const { container } = render(<AsOf iso="2026-11-08T06:10:00+09:00" subject="発表の確認" />);
    expect(container.textContent).toBe("発表の確認: 11 月 8 日 6:10 時点");
  });
  it("時点がない・読めないときは『発表の確認: 未確認』。単独の『確認できていません』にしない", () => {
    for (const iso of [null, "not a date"]) {
      const { container } = render(<AsOf iso={iso} subject="発表の確認" />);
      expect(container.textContent).toBe("発表の確認: 未確認");
      cleanup();
    }
  });
  it("届くまでは『発表の確認: 読み込んでいます』", () => {
    const { container } = render(<AsOf iso={null} subject="発表の確認" loading />);
    expect(container.textContent).toBe("発表の確認: 読み込んでいます");
  });
  it("精度が none なら主語ごと描かない。date は日付だけ", () => {
    const { container } = render(
      <AsOfPrecisionContext.Provider value="none">
        <AsOf iso="2025-12-19T23:59:59+09:00" subject="発表の確認" />
      </AsOfPrecisionContext.Provider>,
    );
    expect(container.textContent).toBe("");
    cleanup();
    const r = render(
      <AsOfPrecisionContext.Provider value="date">
        <AsOf iso="2025-12-19T23:59:59+09:00" subject="発表の確認" />
      </AsOfPrecisionContext.Provider>,
    );
    expect(r.container.textContent).toBe("発表の確認: 12 月 19 日 時点");
  });
  it("主語を渡さないときは今のまま（地図と運営者の画面）", () => {
    const { container } = render(<AsOf iso={null} />);
    expect(container.textContent).toBe("確認できていません");
  });
});

describe("AsOf の精度（時刻が分からないとき、時刻の文字を描かない）", () => {
  it("date は日付だけ。時刻の文字がない", () => {
    render(
      <AsOfPrecisionContext.Provider value="date">
        <AsOf iso="2025-12-19T23:59:59+09:00" />
      </AsOfPrecisionContext.Provider>,
    );
    expect(screen.getByText("12 月 19 日 時点")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d:\d{2}/);
  });
  it("none は何も描かない（null の『確認できていません』は date でも出る）", () => {
    const { container } = render(
      <AsOfPrecisionContext.Provider value="none">
        <AsOf iso="2025-12-19T23:59:59+09:00" />
      </AsOfPrecisionContext.Provider>,
    );
    expect(container.textContent).toBe("");
    cleanup();
    render(
      <AsOfPrecisionContext.Provider value="date">
        <AsOf iso={null} />
      </AsOfPrecisionContext.Provider>,
    );
    expect(screen.getByText("確認できていません")).toBeTruthy();
  });
});

describe("Tag", () => {
  it("tone を class にし、中身をそのまま出す", () => {
    render(<Tag tone="lv1">第 1 段階</Tag>);
    const el = screen.getByText("第 1 段階");
    expect(el.className).toContain("tag-lv1");
  });
});

describe("SourceLine", () => {
  it("出典の題をリンクにし、確認日があれば出す", () => {
    render(<SourceLine title="農林水産省" url="https://www.maff.go.jp/example" checkedOn="2025-12-20" />);
    const a = screen.getByRole("link", { name: "農林水産省" });
    expect(a.getAttribute("href")).toBe("https://www.maff.go.jp/example");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/2025-12-20/)).toBeTruthy();
  });
  it("http(s) 以外の URL はリンクにしない", () => {
    render(<SourceLine title="危ない" url="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/危ない/)).toBeTruthy();
  });
});

describe("ClassBlock（§7）", () => {
  const classes: ChecklistClass[] = ["always", "if_in_zone", "good_to_check"];
  it.each(classes)("%s は見出しと中身を出す", (cls) => {
    render(
      <ClassBlock cls={cls} heading="見出し">
        <p>中身</p>
      </ClassBlock>,
    );
    expect(screen.getByRole("heading", { name: /見出し/ })).toBeTruthy();
    expect(screen.getByText("中身")).toBeTruthy();
  });
  it("『義務ではありません』は good_to_check だけに付く", () => {
    for (const cls of classes) {
      const { container, unmount } = render(
        <ClassBlock cls={cls} heading="見出し">
          <p>中身</p>
        </ClassBlock>,
      );
      const has = (container.textContent ?? "").includes("義務ではありません");
      expect(has, cls).toBe(cls === "good_to_check");
      expect(container.querySelector(`.class-${cls}`), cls).not.toBeNull();
      unmount();
    }
  });
  it("css で線の種類が分かれる（実線・太線・破線）", () => {
    expect(css).toMatch(/\.class-always\s*{[^}]*solid[^}]*var\(--fg\)/);
    expect(css).toMatch(/\.class-if_in_zone\s*{[^}]*solid[^}]*var\(--lv1\)/);
    expect(css).toMatch(/\.class-good_to_check\s*{[^}]*dashed[^}]*var\(--muted\)/);
  });
});

describe("Button", () => {
  it("button として出て、css の最小の高さは --tap（48px）", () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole("button", { name: "保存" }).className).toContain("btn");
    expect(css).toMatch(/--tap:\s*48px/);
    expect(css).toMatch(/\.btn\s*{[^}]*min-height:\s*var\(--tap\)/);
  });
  it("type は既定で button（form を誤って送らない）", () => {
    render(<Button>押す</Button>);
    expect(screen.getByRole("button", { name: "押す" }).getAttribute("type")).toBe("button");
  });
});

describe("theme.css", () => {
  it("土台の規則に、陰影・グラデーション・ぼかしを書かない（地図のカードの影は変数を地図の規則で使う）", () => {
    expect(css).not.toMatch(/box-shadow:(?!\s*none)|text-shadow|drop-shadow|gradient|backdrop-filter/i);
  });
  it("本文は 18px 以上", () => {
    const m = css.match(/--font-base:\s*(\d+(?:\.\d+)?)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(18);
    expect(css).toMatch(/body\s*{[^}]*font-size:\s*var\(--font-base\)/);
  });
  it("指定の値が入っている", () => {
    for (const [name, hex] of [
      ["lv1", "#B3261E"],
      ["lv2", "#8A5A00"],
      ["lv3", "#0017C1"],
      ["lv4", "#4A4F57"],
      ["muted", "#666666"],
      ["accent", "#0017C1"],
      ["fg", "#1A1A1A"],
      ["soft", "#F2F2F2"],
      ["divider", "#CCCCCC"],
    ] as const) {
      expect(css, name).toMatch(new RegExp(`--${name}:\\s*${hex}\\b`, "i"));
    }
  });
  it("段階の青と押す所の青は同じ値（似た青を 2 つにしない）", () => {
    const hex = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!.toLowerCase();
    expect(hex("lv3")).toBe(hex("accent"));
  });
  it("段階の色と補助の文字色は白とのコントラスト 4.5 以上", () => {
    for (const name of ["lv1", "lv2", "lv3", "lv4", "muted"]) {
      const m = css.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
      expect(m, name).not.toBeNull();
      expect(contrastWithWhite(m![1]!), name).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("主のボタンは濃い青に白い文字で、比は 4.5 以上。メニューの選択中は紺の文字と左の青い線で、地との比は 4.5 以上", () => {
    expect(css).toMatch(/--on-accent:\s*#ffffff\b/i);
    const m = css.match(/--accent:\s*#([0-9a-fA-F]{6})/);
    expect(m).not.toBeNull();
    expect(contrastWithWhite(m![1]!)).toBeGreaterThanOrEqual(4.5);
    const menu = css.match(/\.menu-link\[aria-current="page"\]\s*{([^}]*)}/)?.[1];
    expect(menu).toMatch(/color:\s*var\(--navy\)/);
    expect(menu).toMatch(/background:\s*var\(--soft\)/);
    expect(css).toMatch(/\.menu-link\[aria-current="page"\]::before\s*{[^}]*background:\s*var\(--accent\)/);
    const navy = css.match(/--navy:\s*#([0-9a-fA-F]{6})/)![1]!;
    const soft = css.match(/--soft:\s*#([0-9a-fA-F]{6})/)![1]!;
    expect(contrast(navy, soft)).toBeGreaterThanOrEqual(4.5);
    for (const sel of [/\.btn-primary/]) {
      const body = css.match(new RegExp(`${sel.source}\\s*{([^}]*)}`))?.[1];
      expect(body, sel.source).toMatch(/background:\s*var\(--accent\)/);
      expect(body, sel.source).toMatch(/(?:^|[\s;])color:\s*var\(--on-accent\)/);
    }
  });
});

describe("メニューの見分け方（2026-11-07 作者の決定 案 A）", () => {
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.[\]"=+]/g, (c) => `\\${c}`)}\\s*{([^}]*)}`))?.[1] ?? "";
  const hex = (name: string) => css.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))?.[1] ?? "";
  it("見出しは紺の太字で、項目（--font-base）より大きく、まとまりの間に線を引く。項目は見出しより右に下げる", () => {
    const label = rule(".menu-group-label");
    expect(label).toMatch(/color:\s*var\(--navy\)/);
    expect(label).toMatch(/font-weight:\s*700/);
    // 項目は本文の大きさ（--font-base）。見出しはそれより大きく書く（rem は基準 16px なので、項目より小さくなる。2026-11-07 本番で見落とした）
    expect(label).toMatch(/font-size:\s*calc\(var\(--font-base\) \+ [1-9]\d*px\)/);
    expect(rule(".menu-group + .menu-group")).toMatch(/border-top:\s*1px solid var\(--hair\)/);
    expect(rule(".menu-group .menu-link")).toMatch(/padding-left:\s*24px/);
  });
  it("養鶏事業者の方は薄い緑の枠で、見出しと項目は緑。選択中の線も緑。文字と地の比は 4.5 以上", () => {
    expect(rule(".menu-group-farm")).toMatch(/background:\s*var\(--farm-soft\)/);
    expect(rule(".menu-group-farm")).toMatch(/border:\s*1px solid var\(--farm-line\)/);
    expect(rule(".menu-group-farm .menu-group-label")).toMatch(/color:\s*var\(--farm\)/);
    expect(rule(".menu-group-farm .menu-link")).toMatch(/color:\s*var\(--farm-ink\)/);
    expect(rule('.menu-group-farm .menu-link[aria-current="page"]::before')).toMatch(/background:\s*var\(--farm\)/);
    for (const [fg, bg] of [["farm", "farm-soft"], ["farm-ink", "farm-soft"], ["farm-ink", "farm-hover"], ["farm-ink", "surface"]] as const) {
      expect(hex(fg), fg).not.toBe("");
      expect(hex(bg), bg).not.toBe("");
      expect(contrast(hex(fg), hex(bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function contrastWithWhite(hex: string): number {
  return contrast(hex, "ffffff");
}

// ── 共通の部品と見た目の土台（設計書 4 章） ──

function renderShell(pathname: string) {
  const router = createMemoryRouter(
    [{ path: "*", element: <AppShell><p>本文</p></AppShell> }],
    { initialEntries: [pathname] },
  );
  return render(<RouterProvider router={router} />);
}
function tabs() {
  const nav = screen.getByRole("navigation", { name: "メニュー" });
  return within(nav).getAllByRole("link");
}
function currentLabels(): string[] {
  return tabs()
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent ?? "");
}
function hrefs(): (string | null)[] {
  return tabs().map((a) => a.getAttribute("href"));
}

describe("shellContextOf", () => {
  it("replay と sample を前方一致（区切りつき）で判定する", () => {
    expect(shellContextOf("/replay").mode).toBe("replay");
    expect(shellContextOf("/replay/").mode).toBe("replay");
    expect(shellContextOf("/replay/backstage").mode).toBe("replay");
    expect(shellContextOf("/replayx").mode).toBeNull();
    expect(shellContextOf("/sample").mode).toBe("sample");
    expect(shellContextOf("/sample/todo").mode).toBe("sample");
    expect(shellContextOf("/samplex").mode).toBeNull();
    expect(shellContextOf("/todo").mode).toBeNull();
  });
  it("/recordx は記録に当たらない（会員）", () => {
    const items = (p: string) => shellContextOf(p, true).groups.flatMap((g) => g.items);
    expect(items("/recordx").some((t) => t.current)).toBe(false);
    expect(items("/record").find((t) => t.label === "死亡・消毒の記録")!.current).toBe(true);
  });
  it("会員の印がなければ記録と設定を出さず、会員のログインを出す。/login と /join で選択中", () => {
    const farm = (p: string, member: boolean) => shellContextOf(p, member).groups.find((g) => g.label === "養鶏事業者の方")!.items;
    expect(farm("/", false).map((i) => [i.label, i.to])).toEqual([["対策項目", "/todo"], ["会員のログイン", "/login"]]);
    expect(farm("/", true).map((i) => [i.label, i.to])).toEqual([["対策項目", "/todo"], ["AIに対策を相談", "/consult"], ["死亡・消毒の記録", "/record/deaths"], ["農場と通知の設定", "/settings/farm"]]);
    // 対策の相談は会員の印があるときだけ。会員でない人と、見本の中には出さない
    expect(farm("/", false).some((i) => i.to === "/consult")).toBe(false);
    expect(farm("/consult", true).find((i) => i.label === "AIに対策を相談")!.current).toBe(true);
    expect(farm("/login", false).find((i) => i.label === "会員のログイン")!.current).toBe(true);
    expect(farm("/join/abc", false).find((i) => i.label === "会員のログイン")!.current).toBe(true);
    // 見本の中は会員の印に関係なく、見本の行き先と記録を試す
    for (const member of [false, true]) {
      expect(farm("/sample/todo", member).map((i) => i.to)).toEqual(["/sample/todo", "/sample/record/deaths", "/sample"]);
    }
  });
});

// 決定 15・16。会員でない人は 8 項目、会員は 10 項目（対策の相談を足した）。審査員向けの見本（記録を試す、去年の再現）は並べない。
// 養鶏事業者の方は一番下（2026-11-07 作者の決定 案 A）
const GUEST_HREFS = ["/", "/compare", "/trends", "/known", "/public", "/about", "/todo", "/login"];
const MEMBER_HREFS = ["/", "/compare", "/trends", "/known", "/public", "/about", "/todo", "/consult", "/record/deaths", "/settings/farm"];
const SAMPLE_HREFS = ["/", "/compare", "/trends", "/known", "/public", "/about", "/sample/todo", "/sample/record/deaths", "/sample"];

function asMember() {
  localStorage.setItem("hpai.member.v1", "1");
}

describe("AppShell の帯とメニュー（設計書 2026-11-06-ui-frame 3 章）", () => {
  afterEach(() => localStorage.clear());
  it("/ は帯なし。会員でない人のメニューは 8 の行き先で、今季の発生が選択中。札も右上の設定もない。下のタブはない", () => {
    const { container } = renderShell("/");
    expect(container.querySelector(".app-context")).toBeNull();
    expect(hrefs()).toEqual(GUEST_HREFS);
    expect(currentLabels()).toEqual(["今季の発生"]);
    expect(tabs().some((a) => a.textContent?.includes("会員") && a.textContent !== "会員のログイン")).toBe(false);
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "メイン" })).toBeNull();
  });
  it("養鶏事業者の方のまとまりは一番下で、関係者向けの目印（menu-group-farm）が付く。ほかのまとまりには付かない（2026-11-07 作者の決定 案 A）", () => {
    renderShell("/");
    const groups = [...document.querySelectorAll("#app-menu .menu-group")];
    const last = groups.at(-1)!;
    expect(last.querySelector(".menu-group-label")!.textContent).toBe("養鶏事業者の方");
    expect(last.classList.contains("menu-group-farm")).toBe(true);
    expect(document.querySelectorAll("#app-menu .menu-group-farm")).toHaveLength(1);
  });
  it("会員の印があれば 10 の行き先と右上の設定。札はない", () => {
    asMember();
    renderShell("/");
    expect(hrefs()).toEqual(MEMBER_HREFS);
    expect(tabs().some((a) => a.textContent?.includes("会員"))).toBe(false);
    expect(screen.getByRole("link", { name: "設定" }).getAttribute("href")).toBe("/settings/farm");
  });
  it("別のタブで印が変わったとき（storage の知らせ）も描き直す", () => {
    renderShell("/");
    localStorage.setItem("hpai.member.v1", "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "hpai.member.v1", newValue: "1" }));
    });
    expect(hrefs()).toEqual(MEMBER_HREFS);
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(hrefs()).toEqual(GUEST_HREFS);
  });
  it("同じタブで印が付くと、読み直さなくてもメニューと右上が変わる", () => {
    renderShell("/");
    expect(hrefs()).toEqual(GUEST_HREFS);
    act(() => writeMemberMark(true));
    expect(hrefs()).toEqual(MEMBER_HREFS);
    expect(screen.getByRole("link", { name: "設定" })).toBeTruthy();
    act(() => writeMemberMark(false));
    expect(hrefs()).toEqual(GUEST_HREFS);
  });
  it("/record と /record/self-check で記録が選択中（会員）", () => {
    asMember();
    renderShell("/record");
    expect(currentLabels()).toEqual(["死亡・消毒の記録"]);
    cleanup();
    renderShell("/record/self-check");
    expect(currentLabels()).toEqual(["死亡・消毒の記録"]);
  });
  it("/todo で対策項目が選択中（会員でなくても出る）", () => {
    renderShell("/todo");
    expect(currentLabels()).toEqual(["対策項目"]);
  });
  it("/season は今季の発生、/compare /town /area/xxx は過去の発生、/results /privacy はこのサイトについてが選択中", () => {
    for (const [p, label] of [["/season", "今季の発生"], ["/compare", "過去の発生"], ["/town", "過去の発生"], ["/area/33203", "過去の発生"], ["/results", "このサイトについて"], ["/privacy", "このサイトについて"], ["/about", "このサイトについて"]] as const) {
      renderShell(p);
      expect(currentLabels()).toEqual([label]);
      cleanup();
    }
  });
  it("三本線でメニューを開くと中へフォーカスが移り、Escape で閉じて三本線へ戻る。aria-expanded が変わる", () => {
    renderShell("/");
    const btn = screen.getByRole("button", { name: "メニューを開く" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "メニューを閉じる" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn);
  });
  it("どの画面にも民間の運営の 1 行が出て、印刷には出ない", () => {
    for (const path of ["/", "/replay", "/sample/todo", "/poster"]) {
      renderShell(path);
      expect(screen.getByText("民間の運営です。国や県の公式のサイトではありません。")).toBeTruthy();
      cleanup();
    }
    const css = fs.readFileSync(path.join(import.meta.dirname, "theme.css"), "utf8");
    expect(css).toMatch(/@media print\s*\{[^}]*\.app-operator-note[^}]*display:\s*none/);
  });
  it("予期しない例外の画面にも民間の運営の 1 行が出る", () => {
    const router = createMemoryRouter([{ path: "*", element: <RouteError /> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText(OPERATOR_NOTE)).toBeTruthy();
  });
  it("/sample/todo は見本の行き先、帯に見本を終わる、設定なし（会員でも）", () => {
    asMember();
    const { container } = renderShell("/sample/todo");
    expect(hrefs()).toEqual(SAMPLE_HREFS);
    expect(currentLabels()).toEqual(["対策項目"]);
    const band = container.querySelector(".app-context")!;
    expect(band.textContent).toContain("見本の農場を見ています");
    const end = within(band as HTMLElement).getByRole("link", { name: "見本を終わる" });
    expect(end.getAttribute("href")).toBe("/");
    expect(end.className).toContain("tap-link");
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
  });
  it("/sample/record/deaths と /sample の選択中", () => {
    renderShell("/sample/record/deaths");
    expect(currentLabels()).toEqual(["死亡・消毒の記録"]);
    cleanup();
    const { container } = renderShell("/sample");
    expect(currentLabels()).toEqual(["記録を試す"]);
    expect(container.querySelector(".app-context")).not.toBeNull();
  });
  it("/replay と /replay/backstage は帯に再現を終わる、行き先は通常（記録を試すは並べない）、過去の発生が選択中", () => {
    asMember();
    for (const p of ["/replay", "/replay/backstage"]) {
      const { container, unmount } = renderShell(p);
      const band = container.querySelector(".app-context")!;
      expect(band.textContent).toContain("去年の再現を見ています");
      expect(band.textContent).not.toContain("去年の再現です");
      const end = within(band as HTMLElement).getByRole("link", { name: "再現を終わる" });
      expect(end.getAttribute("href")).toBe("/");
      expect(end.className).toContain("tap-link");
      expect(hrefs()).toEqual(MEMBER_HREFS);
      expect(currentLabels()).toEqual(["過去の発生"]);
      expect(screen.getByRole("link", { name: "設定" })).toBeTruthy();
      unmount();
    }
  });
  it("/login /poster /public は帯なし", () => {
    for (const p of ["/login", "/poster", "/public"]) {
      const { container, unmount } = renderShell(p);
      expect(container.querySelector(".app-context"), p).toBeNull();
      unmount();
    }
  });
});

describe("Fold", () => {
  it("閉じていても本文が DOM にある", () => {
    const { container } = render(
      <Fold summary="日付の一覧">
        <p>中の本文</p>
      </Fold>,
    );
    const d = container.querySelector("details.fold")!;
    expect(d.hasAttribute("open")).toBe(false);
    expect(d.querySelector("summary")!.textContent).toBe("日付の一覧");
    expect(screen.getByText("中の本文", { selector: "p" })).toBeTruthy();
  });
});

describe("theme.css の土台", () => {
  const rule = (sel: string): string => {
    const re = new RegExp(`(?:^|})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*{([^}]*)}`, "m");
    const m = css.match(re);
    expect(m, sel).not.toBeNull();
    return m![1]!;
  };
  it("色・文字・余白の値", () => {
    expect(css).toMatch(/--line:\s*#767676/i);
    expect(css).toMatch(/\.data-table tbody th\s*{[^}]*1px solid var\(--hair\)/);
    expect(rule(".btn:disabled")).toMatch(/border-color:\s*var\(--line\)/);
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/--s1:\s*8px[\s\S]*--s4:\s*48px/);
    expect(rule("body")).toMatch(/letter-spacing:\s*\.02em/);
    expect(rule("h1")).toMatch(/font-size:\s*1\.5rem/);
    expect(rule("h2")).toMatch(/font-size:\s*1\.25rem/);
    for (const s of [".as-of", ".source-line", ".tag"]) expect(rule(s), s).toMatch(/font-size:\s*1rem/);
  });
  it("帯: sticky、scroll-padding、印刷で隠す", () => {
    expect(rule(".app-context")).toMatch(/position:\s*sticky/);
    // 下のタブはなくした（設計書 2026-11-06-ui-frame）。下に余白を空けて隠れを防ぐ必要もない
    expect(css).not.toMatch(/\.app-nav\s*{/);
    expect(css).toMatch(/html:has\(\.app-context\)\s*{[^}]*scroll-padding-top:\s*56px/);
    expect(css).toMatch(/@media print\s*{[^@]*\.app-context/);
  });
  it("状態の 3 種類に左の帯がない", () => {
    for (const s of [".state-ok", ".state-wait", ".state-unknown"]) {
      expect(rule(s), s).not.toMatch(/border-left/);
    }
    expect(rule(".state-unknown")).toMatch(/2px dashed var\(--fg\)/);
  });
  it("数値は nowrap、表のセルそのものは nowrap しない、出典リンクは inline-flex にしない", () => {
    expect(rule(".num")).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/\.data-table td\.num\s*{[^}]*text-align:\s*right/);
    expect(css).toMatch(/\.data-table th\.num[\s\S]*?{[^}]*text-align:\s*right/);
    const fold = rule(".fold > summary");
    expect(fold).not.toMatch(/display:\s*flex/);
    expect(fold).toMatch(/min-height:\s*var\(--tap\)/);
    expect(css).not.toMatch(/\.data-table\s+td\s*{[^}]*nowrap/);
    expect(rule(".data-table td")).not.toMatch(/nowrap/);
    expect(rule(".source-line a")).not.toMatch(/inline-flex/);
  });
});

// ── 機械の検査 ──

function listFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      listFiles(p, ext, out);
    } else if (ext.test(e.name)) out.push(p);
  }
  return out;
}
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const webSrc = path.join(repoRoot, "web/src");

/** 平らな規則の一覧（@media の中も含む）。file はリポジトリ直下からの相対 */
function cssRules(): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = [];
  for (const f of listFiles(webSrc, /\.css$/)) {
    const text = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+){([^{}]*)}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({
        file: path.relative(repoRoot, f).split(path.sep).join("/"),
        selector: m[1]!.trim().replace(/\s+/g, " "),
        body: m[2]!,
      });
    }
  }
  return out;
}

describe("機械の検査: css", () => {
  const MAP = "web/src/pages/map/map.css";
  const CMP = "web/src/pages/map/compare.css";
  const DECOR_ALLOWED = new Set([
    `${MAP} .swatch-hatch`,
    `${MAP} .swatch-unwatched`,
    `${MAP} .swatch-hatch.is-past`,
    // 過去シーズンとの重ね合わせの凡例の見本（「／」「＼」「×」。設計書 2026-11-06-data-explore E8）
    `${CMP} .cmp-swatch.is-one`,
    `${CMP} .cmp-swatch.is-two`,
    `${CMP} .cmp-swatch.is-both`,
  ]);
  // 県のバッジと、凡例のその見本（2026-11-07 凡例を 3 段にしたとき、野鳥の輪の見本は鳥の形の SVG になり .swatch-ring はなくなった）
  const RADIUS_ALLOWED = new Set([`${MAP} .pref-badge`, `${MAP} .swatch-badge`]);
  // 影は地図のカードだけ（設計書 2-2）。今の画面に地図のポップアップはない
  const SHADOW_ALLOWED = new Set([`${MAP} .map-canvas, .svg-map`, "web/src/pages/settings/settings.css .picker-canvas"]);
  // 角丸の上限を上げてよいものを名指しする。カードは 12px、押す部品と入力は 8px、ほかは 4px
  // 地図のカードの下の端に重ねる「地図に印のない発表」の帯は、カードの下の角と同じ角丸（影は付けない）
  // 地図で押した町の事例の欄もカード（設計書 2026-11-06-ui-frame 決定 4）
  // 地図の外の野鳥の帯（2026-11-07 作者の決定 C）も、地図のカードの下の端に重ねる帯
  const RADIUS_CARD = new Set([...SHADOW_ALLOWED, `${MAP} .near-unmarked`, `${MAP} .near-birds:last-child`, `${MAP} .town-cases`]);
  const RADIUS_CONTROL = new Set([
    ".btn",
    ".map-home-btn",
    ".season-bar-btn",
    ".map-scope",
    ".map-scope button",
    // 条件で見るの問いと条件のボタン（設計書 2026-11-06-data-explore E2、E3）
    ".explore-questions button",
    ".explore-row button",
    // 条件で見るの月の行（押すとその月に絞る。設計書 E4b）
    '.explore-months button[aria-pressed="true"]',
    // 重ね合わせの見せ方と、地図の広さのボタン（設計書 E8、E15）
    ".cmp-scope button",
    // 比べるシーズンのボタン（設計書 2026-11-06-data-explore E12）
    ".cmp-seasons button",
    ".case-list-toggle",
    ".record-tabs a",
    ".sample-nav a",
    ".replay-item",
    ".invite-url",
    ".explainer-text",
    ".menu-btn",
    ".menu-close",
    ".menu-link",
  ]);
  const isControl = (selector: string) =>
    selector.split(", ").every((s) => RADIUS_CONTROL.has(s) || /(?:^| )(?:select|textarea|input(?:\[[^\]]*\])?)$/.test(s));
  const px = (v: string): number | null => {
    const named: Record<string, number> = { "var(--radius-card)": 12, "var(--radius-control)": 8 };
    if (v in named) return named[v]!;
    if (/^0$/.test(v)) return 0;
    const m = /^(\d+(?:\.\d+)?)px$/.exec(v);
    return m ? parseFloat(m[1]!) : null;
  };

  it("今季の棒は濃い青、過去の棒は灰色", () => {
    const body = (selector: string) => cssRules().find((r) => r.file === MAP && r.selector === selector)?.body ?? "";
    expect(body(".season-bar-fill, .month-bar-fill")).toMatch(/background:\s*var\(--accent\)/);
    expect(body(".season-bar-fill.is-past, .month-bars.is-past .month-bar-fill")).toMatch(/background:\s*var\(--bar-past\)/);
    expect(body(".compare-fill")).toMatch(/background:\s*var\(--bar-past\)/);
    expect(body(".compare-table tr.is-now .compare-fill")).toMatch(/background:\s*var\(--accent\)/);
    expect(css).toMatch(/--bar-past:\s*#999999\b/i);
  });
  it("前の配色の値が画面のコードに残っていない", () => {
    const files = listFiles(webSrc, /\.(?:css|tsx?)$/).filter((f) => !/\.test\./.test(path.basename(f)));
    const hits = files.filter((f) => /#(?:00639b|5c6168|1b1d21|f1f2f4|e6eef5)\b/i.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
  it("グラデーション・ぼかしは許可したもの以外に無い", () => {
    const bad = cssRules().filter(
      (r) =>
        /linear-gradient|radial-gradient|backdrop-filter|text-shadow/i.test(r.body) &&
        !DECOR_ALLOWED.has(`${r.file} ${r.selector}`),
    );
    expect(bad.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
  it("許可したものは、凡例の斜線の見本としてだけ使われている", () => {
    const used = cssRules()
      .filter((r) => /gradient|text-shadow|backdrop-filter/i.test(r.body))
      .map((r) => `${r.file} ${r.selector}`)
      .sort();
    expect(used).toEqual([...DECOR_ALLOWED].sort());
  });
  it("影は名指しの地図のカードだけで、値は変数から取る", () => {
    const used = cssRules().filter((r) => /box-shadow\s*:/i.test(r.body) && !/box-shadow:\s*none/i.test(r.body));
    expect(used.map((r) => `${r.file} ${r.selector}`).sort()).toEqual([...SHADOW_ALLOWED].sort());
    for (const r of used) expect(r.body, r.selector).toMatch(/box-shadow:\s*var\(--shadow-card\)/);
  });
  it("印刷には影を出さない", () => {
    const printed = /@media print\s*\{[\s\S]*?\n\}/g;
    const all = [...css.matchAll(printed)].map((m) => m[0]).join("\n");
    expect(all).toMatch(/\.map-canvas[^{]*\{[^}]*box-shadow:\s*none/);
  });
  it("角丸はカード 12px、押す部品と入力 8px、ほかは 4px まで。例外は県のバッジとその凡例の見本の 2 つ", () => {
    expect(css).toMatch(/--radius-card:\s*12px/);
    expect(css).toMatch(/--radius-control:\s*8px/);
    const bad: string[] = [];
    for (const r of cssRules()) {
      const name = `${r.file} ${r.selector}`;
      for (const m of r.body.matchAll(/border-radius:\s*([^;]+)/g)) {
        const limit = RADIUS_CARD.has(name) ? 12 : isControl(r.selector) ? 8 : 4;
        const ok = m[1]!.trim().split(/[\s/]+/).every((v) => {
          const n = px(v);
          return n !== null && n <= limit;
        });
        if (!ok && !RADIUS_ALLOWED.has(name)) bad.push(`${name} ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("機械の検査: ソフトの質感（設計書 2-2）", () => {
  const MAP = "web/src/pages/map/map.css";
  const hex = (name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
    expect(m, name).not.toBeNull();
    return m![1]!;
  };
  const body = (selector: string, file?: string) =>
    cssRules()
      .filter((r) => (!file || r.file === file) && r.selector.split(", ").includes(selector))
      .map((r) => r.body)
      .join("\n");

  it("指定の値が入っている", () => {
    for (const [name, value] of [
      ["navy", "000060"],
      ["bg", "F8F8FB"],
      ["ctl", "F1F1F4"],
      ["hair", "E3E3E8"],
      ["outer", "8C8C94"],
      ["sub", "626264"],
      ["surface", "FFFFFF"],
    ] as const) {
      expect(hex(name).toUpperCase(), name).toBe(value);
    }
    expect(css).toMatch(/--shadow-card:\s*0 1px 2px rgba\(0, 0, 60, \.06\), 0 6px 16px rgba\(0, 0, 60, \.05\)/);
  });
  it("地図のカードの外周は背景に対して 3:1 以上で、影だけで境界を示さない", () => {
    expect(contrast(hex("outer"), hex("bg"))).toBeGreaterThanOrEqual(3);
    for (const [selector, file] of [
      [".map-canvas", MAP],
      [".svg-map", MAP],
      [".picker-canvas", "web/src/pages/settings/settings.css"],
    ] as const) {
      expect(body(selector, file), selector).toMatch(/(?:^|[\s;])border:\s*1px solid var\(--outer\)/);
      expect(body(selector, file), selector).toMatch(/border-radius:\s*var\(--radius-card\)/);
    }
  });
  it("押す部品の枠は背景に対して 3:1 以上", () => {
    expect(contrast(hex("line"), hex("bg"))).toBeGreaterThanOrEqual(3);
    expect(body(".btn")).toMatch(/(?:^|[\s;])border:\s*1px solid var\(--line\)/);
  });
  it("文字の比は、背景と切り替えの地に対して 4.5 以上", () => {
    for (const text of ["navy", "sub", "fg", "accent"]) {
      for (const ground of ["bg", "ctl", "surface"]) {
        expect(contrast(hex(text), hex(ground)), `${text} / ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(hex("sub"), hex("soft"))).toBeGreaterThanOrEqual(4.5);
  });
  it("選択中の部品は濃い青に白い文字で、比は 4.5 以上", () => {
    expect(contrast(hex("on-accent"), hex("accent"))).toBeGreaterThanOrEqual(4.5);
    for (const selector of [".season-bar-btn.is-selected", '.record-tabs a[aria-current="page"]', '.map-scope button[aria-pressed="true"]']) {
      expect(body(selector), selector).toMatch(/background:\s*var\(--accent\)/);
      expect(body(selector), selector).toMatch(/(?:^|[\s;])color:\s*var\(--on-accent\)/);
    }
  });
  it("選択中のシーズンの棒の中で、薄い文字が青に残らない", () => {
    for (const selector of [".season-bar-btn.is-selected .season-bar-label small", ".season-bar-btn.is-selected .season-bar-count small"]) {
      expect(body(selector, MAP), selector).toMatch(/(?:^|[\s;])color:\s*var\(--on-accent\)/);
    }
  });
  it("題、見出し、数字は紺で、題の帯は白", () => {
    for (const selector of ["h1", "h2", "h3"]) expect(body(selector), selector).toMatch(/(?:^|[\s;])color:\s*var\(--navy\)/);
    expect(body(".app-title a")).toMatch(/(?:^|[\s;])color:\s*var\(--navy\)/);
    expect(body(".stat-value")).toMatch(/(?:^|[\s;])color:\s*var\(--navy\)/);
    expect(body(".app-header")).toMatch(/background:\s*var\(--surface\)/);
  });
  it("札の一部未確認の断りは、PC で小さい文字にし、隠さない。数字は大きいまま", () => {
    const pc = fs.readFileSync(path.join(repoRoot, MAP), "utf8").split("@media (min-width: 64rem)")[1]!;
    const qual = /\.stat-value \.stat-qual\s*\{([^}]*)\}/.exec(pc)?.[1] ?? "";
    expect(qual).toMatch(/font-size:\s*1rem/);
    expect(qual).toMatch(/color:\s*var\(--sub\)/);
    expect(qual).not.toMatch(/display:\s*none/);
    expect(pc).toMatch(/\.stat-value :is\(b, \.stat-num\)\s*\{[^}]*font-size:\s*2rem/);
  });
  it("設定の部品を使う画面は、直接開いても設定の CSS を読む", () => {
    const explainer = fs.readFileSync(path.join(repoRoot, "web/src/pages/settings/ExplainerPage.tsx"), "utf8");
    expect(explainer).toMatch(/settings-check/);
    expect(explainer).toMatch(/import "\.\/settings\.css";/);
  });
  it("設定の印は、2 行の文の横でもつぶれない", () => {
    const settings = fs.readFileSync(path.join(repoRoot, "web/src/pages/settings/settings.css"), "utf8");
    expect(/\.settings-check input\s*\{([^}]*)\}/.exec(settings)?.[1]).toMatch(/flex:\s*none/);
  });
  it("運営者の欄の選択肢は、長い選択肢でも幅を超えない", () => {
    const op = fs.readFileSync(path.join(repoRoot, "web/src/pages/operator/operator.css"), "utf8");
    expect(/\.op-field select,\s*\.op-field input\s*\{([^}]*)\}/.exec(op)?.[1]).toMatch(/width:\s*100%/);
  });
  it("札と断りは枠も面も持たない", () => {
    expect(body(".stat")).not.toMatch(/(?:^|[\s;])(?:border|background):\s*(?!0|none)/);
    expect(body(".map-notice", MAP)).not.toMatch(/(?:^|[\s;])border:\s*(?!0)/);
  });
  it("黒い太い枠は、状態を示す名指しのものだけ", () => {
    const allowed = new Set([".class-always", ".state-unknown", ".death-hit", ".delete-section"]);
    const bad = cssRules().filter(
      (r) => /(?:^|[\s;])border(?:-\w+)?:\s*[2-9]px\s+\w+\s+(?:var\(--fg\)|#000\b)/.test(r.body) && !allowed.has(r.selector),
    );
    expect(bad.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
  it("フォーカスの示し方を変えない", () => {
    expect(css).toMatch(/a:focus-visible,\s*button:focus-visible\s*\{\s*outline:\s*3px solid var\(--fg\);\s*outline-offset:\s*2px;/);
  });
  it("印刷は白い背景で、貼り紙は画面でも白に黒", () => {
    expect(css).toMatch(/@media print\s*\{[^@]*?body\s*\{\s*background:\s*#fff/);
    const poster = "web/src/pages/public/poster.css";
    const screen = fs.readFileSync(path.join(repoRoot, poster), "utf8").split("@media print")[0]!;
    expect(screen).toMatch(/body:has\(\.poster-page\)\s*\{\s*background:\s*#fff/);
    expect(screen).toMatch(/\.poster-sheet :is\(h1, h2, h3\)\s*\{\s*color:\s*#000/);
  });
});

describe("機械の検査: 画面の文字に絵文字が無い", () => {
  it("web/src と shared/src の .ts .tsx（試験を除く）", () => {
    const files = [
      ...listFiles(webSrc, /\.tsx?$/),
      ...listFiles(path.join(repoRoot, "shared/src"), /\.tsx?$/),
    ].filter((f) => !/\.test\./.test(path.basename(f)));
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter((f) => /\p{Emoji_Presentation}|\uFE0F/u.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});

describe("文字の大きさの下限", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = path.join(dir, e.name);
      return e.isDirectory() ? walk(f) : f.endsWith(".css") ? [f] : [];
    });
  it("web/src の css に、14px 以下の font-size（px か rem）がない", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = walk(root);
    expect(files.length).toBeGreaterThan(3);
    const small: string[] = [];
    for (const f of files) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/font-size\s*:\s*([0-9.]+)(px|rem)\s*[;}]/g)) {
        const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
        if (px <= 14) small.push(`${path.relative(root, f)}: ${m[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
});

describe("表の狭い幅の形（.data-table-stack）", () => {
  const stack = css.match(/@media \(max-width:\s*40rem\)\s*\{\s*\.data-table-stack[\s\S]*?\n\}/)?.[0] ?? "";
  it("40rem 以下で表を縦に積み、見出しの行は視覚だけ隠す", () => {
    expect(stack).not.toBe("");
    expect(stack).toMatch(/\.data-table-stack,[\s\S]*tbody,[\s\S]*tr,[\s\S]*th,[\s\S]*td\s*\{[^}]*display:\s*block/);
    expect(stack).toMatch(/\.data-table-stack thead\s*\{[^}]*position:\s*absolute/);
    expect(stack).not.toMatch(/thead\s*\{[^}]*display:\s*none/);
    expect(stack).toMatch(/th\[scope="row"\]\s*\{[^}]*min-width:\s*0/);
    expect(stack).toMatch(/td\.num\s*\{[^}]*text-align:\s*left/);
    expect(stack).toMatch(/td\[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  });

  it("縦に積む表は caption も block にする（表の外に残すと 1 文字ずつ縦に並ぶ）", () => {
    expect(css).toMatch(/\.data-table-stack caption[^{]*\{\s*display:\s*block/);
  });
});
