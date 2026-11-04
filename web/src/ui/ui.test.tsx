import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import fs from "node:fs";
import path from "node:path";
import type { ChecklistClass } from "@hpai/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { AsOf, AsOfPrecisionContext, formatAsOf } from "./AsOf";
import { Button } from "./Button";
import { AppShell, shellContextOf } from "./AppShell";
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
  it("読めない文字列は『時点』と言わない", () => {
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
  it("陰影・グラデーション・ぼかしを使わない", () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|drop-shadow|gradient|backdrop-filter/i);
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
      ["lv3", "#00639B"],
      ["lv4", "#4A4F57"],
      ["muted", "#5C6168"],
    ] as const) {
      expect(css, name).toMatch(new RegExp(`--${name}:\\s*${hex}\\b`, "i"));
    }
  });
  it("段階の色と補助の文字色は白とのコントラスト 4.5 以上", () => {
    for (const name of ["lv1", "lv2", "lv3", "lv4", "muted"]) {
      const m = css.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
      expect(m, name).not.toBeNull();
      expect(contrastWithWhite(m![1]!), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function contrastWithWhite(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const l = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (l + 0.05);
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
  const nav = screen.getByRole("navigation", { name: "メイン" });
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
  it("/recordx は記録に当たらない", () => {
    expect(shellContextOf("/recordx").tabs.some((t) => t.current)).toBe(false);
    expect(shellContextOf("/record").tabs.find((t) => t.label === "記録")!.current).toBe(true);
  });
});

describe("AppShell の帯とタブ", () => {
  it("/ は帯なし。行き先は / /todo /record/deaths で地図が選択中", () => {
    const { container } = renderShell("/");
    expect(container.querySelector(".app-context")).toBeNull();
    expect(hrefs()).toEqual(["/", "/todo", "/record/deaths"]);
    expect(currentLabels()).toEqual(["地図"]);
  });
  it("/record と /record/self-check で記録が選択中", () => {
    renderShell("/record");
    expect(currentLabels()).toEqual(["記録"]);
    cleanup();
    renderShell("/record/self-check");
    expect(currentLabels()).toEqual(["記録"]);
  });
  it("/todo でやることが選択中", () => {
    renderShell("/todo");
    expect(currentLabels()).toEqual(["やること"]);
  });
  it("/sample/todo は見本の行き先、帯に見本を終わる、設定なし", () => {
    const { container } = renderShell("/sample/todo");
    expect(hrefs()).toEqual(["/", "/sample/todo", "/sample/record/deaths"]);
    expect(currentLabels()).toEqual(["やること"]);
    const band = container.querySelector(".app-context")!;
    expect(band.textContent).toContain("見本の農場を見ています");
    const end = within(band as HTMLElement).getByRole("link", { name: "見本を終わる" });
    expect(end.getAttribute("href")).toBe("/");
    expect(end.className).toContain("tap-link");
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
  });
  it("/sample/record/deaths と /sample の選択中", () => {
    renderShell("/sample/record/deaths");
    expect(currentLabels()).toEqual(["記録"]);
    cleanup();
    const { container } = renderShell("/sample");
    expect(currentLabels()).toEqual([]);
    expect(container.querySelector(".app-context")).not.toBeNull();
  });
  it("/replay と /replay/backstage は帯に再現を終わる、行き先は通常、選択中なし", () => {
    for (const p of ["/replay", "/replay/backstage"]) {
      const { container, unmount } = renderShell(p);
      const band = container.querySelector(".app-context")!;
      expect(band.textContent).toContain("去年の再現を見ています");
      expect(band.textContent).not.toContain("去年の再現です");
      const end = within(band as HTMLElement).getByRole("link", { name: "再現を終わる" });
      expect(end.getAttribute("href")).toBe("/");
      expect(end.className).toContain("tap-link");
      expect(hrefs()).toEqual(["/", "/todo", "/record/deaths"]);
      expect(currentLabels()).toEqual([]);
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
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/--s1:\s*8px[\s\S]*--s4:\s*48px/);
    expect(rule("body")).toMatch(/letter-spacing:\s*\.02em/);
    expect(rule("h1")).toMatch(/font-size:\s*1\.5rem/);
    expect(rule("h2")).toMatch(/font-size:\s*1\.25rem/);
    for (const s of [".as-of", ".source-line", ".tag"]) expect(rule(s), s).toMatch(/font-size:\s*1rem/);
  });
  it("帯: sticky、scroll-padding、印刷で隠す", () => {
    expect(rule(".app-context")).toMatch(/position:\s*sticky/);
    expect(css).toMatch(/scroll-padding-bottom:\s*64px/);
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
  const DECOR_ALLOWED = new Set([
    `${MAP} .swatch-hatch`,
    `${MAP} .swatch-unwatched`,
    `${MAP} .swatch-hatch.is-past`,
  ]);
  const RADIUS_ALLOWED = new Set([`${MAP} .pref-badge`, `${MAP} .swatch-ring`]);

  it("グラデーション・影・ぼかしは許可の 3 つ以外に無い", () => {
    const bad = cssRules().filter(
      (r) =>
        /linear-gradient|radial-gradient|box-shadow|backdrop-filter|text-shadow/i.test(r.body) &&
        !DECOR_ALLOWED.has(`${r.file} ${r.selector}`),
    );
    expect(bad.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
  it("許可の 3 つは、凡例の斜線の見本としてだけ使われている", () => {
    const used = cssRules()
      .filter((r) => /gradient|shadow|backdrop-filter/i.test(r.body))
      .map((r) => `${r.file} ${r.selector}`)
      .sort();
    expect(used).toEqual([...DECOR_ALLOWED].sort());
  });
  it("角丸は 4px 以下。例外は県のバッジと凡例の輪の 2 つ", () => {
    const bad: string[] = [];
    for (const r of cssRules()) {
      for (const m of r.body.matchAll(/border-radius:\s*([^;]+)/g)) {
        const vals = m[1]!.trim().split(/[\s/]+/);
        const ok = vals.every((v) => /^0(px)?$/.test(v) || (/^(\d+(?:\.\d+)?)px$/.test(v) && parseFloat(v) <= 4));
        if (!ok && !RADIUS_ALLOWED.has(`${r.file} ${r.selector}`)) bad.push(`${r.file} ${r.selector} ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
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
