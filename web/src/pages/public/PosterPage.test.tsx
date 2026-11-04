import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider } from "../../data/context";
import type { DataSource } from "../../data/types";
import PosterPage from "./PosterPage";

// 貼り紙（§11）。平時から貼れるよう、発生とは読めない文にする。県や家保の看板に似せない。

const BANNED = /発生|鳥インフルエンザ|告|法律|罰則|安全|安心|心配/u;

function ds(now: string): DataSource {
  return {
    mode: "live",
    now: () => new Date(now),
    subscribeCases: () => () => {},
    subscribeWildBirds: () => () => {},
    subscribeWatchStatus: () => () => {},
    loadHistory: () => Promise.resolve([]),
  };
}

function show(now = "2026-11-04T09:00:00+09:00") {
  return render(
    <MemoryRouter>
      <DataSourceProvider value={ds(now)}>
        <PosterPage />
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

/** ruby の読み（rt、rp）を除いた文字 */
function plainText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("rt, rp").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PosterPage", () => {
  it("見出しは、読みを除くと『防疫のため立入禁止』。難しい漢字に ruby がある", () => {
    show();
    const h = screen.getByTestId("poster-heading");
    expect(plainText(h)).toBe("防疫のため立入禁止");
    const pairs = [...h.querySelectorAll("ruby")].map((r) => [plainText(r), r.querySelector("rt")?.textContent]);
    expect(pairs).toEqual([
      ["防疫", "ぼうえき"],
      ["立入", "たちいり"],
      ["禁止", "きんし"],
    ]);
  });

  it("QR は /public へ。data-url が origin つきで、SVG が入っている", () => {
    show();
    const qr = screen.getByTestId("poster-qr");
    expect(qr.getAttribute("data-url")).toBe(`${window.location.origin}/public`);
    expect(qr.querySelector("svg")).not.toBeNull();
  });

  it("端に『印刷日 YYYY 年 M 月 D 日』。画面の時計（dataSource.now()）の日本時間", () => {
    show("2026-11-03T16:00:00Z"); // 日本時間では 11 月 4 日の 1 時
    expect(screen.getByTestId("poster-sheet").textContent).toContain("印刷日 2026 年 11 月 4 日");
  });

  it("印刷する部分の文字に、発生・病名・告・法律・罰則・安全・安心・心配がない", () => {
    show();
    const sheet = screen.getByTestId("poster-sheet");
    expect(sheet.textContent).not.toMatch(BANNED);
    expect(sheet.textContent).toContain("連絡先");
  });

  it("入力欄がない。連絡先は手書きの空欄（印刷する部分に番号を入れない）", () => {
    const { container } = show();
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(screen.getByTestId("poster-sheet").textContent).not.toMatch(/\d{2,}-\d{2,}|\d{10,}/u);
    expect(screen.getByTestId("poster-contact")).toBeTruthy();
  });

  it("本文は 1 行 18 文字以内（読みを除く）。見出しの文字を本文の行に含めない", () => {
    show();
    const lines = screen.getAllByTestId("poster-line");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(plainText(l).length, plainText(l)).toBeLessThanOrEqual(18);
  });

  it("『印刷する』ボタンは印刷する部分の外にあり、押すと window.print を呼ぶ", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show();
    const btn = screen.getByRole("button", { name: "印刷する" });
    expect(screen.getByTestId("poster-sheet").contains(btn)).toBe(false);
    fireEvent.click(btn);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("『鶏を飼っていない方へ』のページ（/public）へのリンクが、印刷しない側にある", () => {
    show();
    const a = screen.getByRole("link", { name: /鶏を飼っていない方へ/ });
    expect(a.getAttribute("href")).toBe("/public");
    expect(screen.getByTestId("poster-sheet").contains(a)).toBe(false);
  });
});

describe("poster.css（画面の幅が狭いとき）", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "poster.css"), "utf8");

  it("@media screen and (max-width: 840px) の中に --poster-h がある", () => {
    const m = css.match(/@media screen and \(max-width: 840px\)\s*\{([\s\S]*?\})\s*\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("--poster-h");
  });

  it("既定の 3 つの値が残る", () => {
    expect(css).toMatch(/--poster-h:\s*90pt/);
    expect(css).toMatch(/--poster-sub:\s*40pt/);
    expect(css).toMatch(/--poster-body:\s*24pt/);
  });

  it("画面用の本文は 14.4px を下限にする", () => {
    const m = css.match(/@media screen and \(max-width: 840px\)\s*\{([\s\S]*?\})\s*\}/);
    expect(m![1]).toMatch(/--poster-body:\s*max\(4vw,\s*14\.4px\)/);
  });

  it(".poster-sheet に letter-spacing: 0 がある", () => {
    const rule = css.match(/\.poster-sheet\s*\{[^}]*\}/)![0];
    expect(rule).toMatch(/letter-spacing:\s*0\s*;/);
  });
});

describe("poster.css（画面用の読み仮名）", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "poster.css"), "utf8");
  it("画面の読み仮名は max(8px, 0.3em) で、10px の下限は残らない", () => {
    expect(css).toMatch(/@media screen and \(max-width: 840px\)\s*\{\s*\.poster-sheet rt\s*\{[^}]*font-size:\s*max\(8px,\s*0\.3em\)/);
    expect(css).not.toMatch(/max\(10px,\s*0\.3em\)/);
  });
});
