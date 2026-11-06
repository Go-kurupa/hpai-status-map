import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ILLUST_NAMES } from "./Illust";
import KnownPage from "./KnownPage";
import { KNOWN_FINDINGS } from "./knownFindings";
import PublicPage from "./PublicPage";

// 見出しに添える線画（設計書 2026-11-06-public-known-redesign §9）。作品の中で描いた絵で、外の素材を使わない。

afterEach(cleanup);
const show = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("線画", () => {
  it("鶏を飼っていない方への 7 節と、分かっていることの 7 件に、1 つずつ絵がある", () => {
    expect([...ILLUST_NAMES].sort()).toEqual([...OFFICIAL_GUIDANCE.map((g) => g.topic), ...KNOWN_FINDINGS.map((f) => f.id)].sort());
  });

  it("/public: 各節の見出しの中に、その節の絵が 1 つ。見出しの名前（読み上げ）は変わらない", () => {
    const { container } = show(<PublicPage />);
    for (const g of OFFICIAL_GUIDANCE) {
      const h2 = container.querySelector(`section#${g.topic} h2`) as HTMLElement;
      const svgs = h2.querySelectorAll("svg.illust");
      expect(svgs, g.topic).toHaveLength(1);
      expect(svgs[0]?.getAttribute("data-illust")).toBe(g.topic);
      expect(within(container.querySelector(`section#${g.topic}`) as HTMLElement).getByRole("heading", { level: 2, name: g.heading })).toBe(h2);
    }
  });

  it("/known: 各知見の見出しの中に、その知見の絵が 1 つ。見出しの文字は変わらない", () => {
    const { container } = show(<KnownPage />);
    for (const f of KNOWN_FINDINGS) {
      const h2 = container.querySelector(`li#${f.id} h2`) as HTMLElement;
      expect(h2.querySelector("svg.illust")?.getAttribute("data-illust"), f.id).toBe(f.id);
      expect(h2.textContent).toBe(f.heading);
    }
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });

  it("絵は飾り: 読み上げで飛ばし、フォーカスを受けず、文字を持たない", () => {
    const { container } = show(<KnownPage />);
    const { container: c2 } = show(<PublicPage />);
    for (const svg of [...container.querySelectorAll("svg.illust"), ...c2.querySelectorAll("svg.illust")]) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.querySelector("text, title, image, foreignObject")).toBeNull();
      expect(svg.textContent).toBe("");
    }
  });

  it("絵の色は public.css の --ill-* だけから取る（色の値を直に書かない。外の画像を読まない）", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "Illust.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/iu);
    expect(src).not.toMatch(/href=|src=|\.png|\.jpe?g|\.webp/iu);
    const used = new Set([...src.matchAll(/var\((--ill-[a-z-]+)\)/gu)].map((m) => m[1]));
    const css = readFileSync(path.resolve(import.meta.dirname, "public.css"), "utf8");
    for (const v of used) expect(css, v).toMatch(new RegExp(`${v}:`, "u"));
  });
});
