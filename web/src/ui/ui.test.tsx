import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type { ChecklistClass } from "@hpai/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { AsOf, formatAsOf } from "./AsOf";
import { Button } from "./Button";
import { ClassBlock } from "./ClassBlock";
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
