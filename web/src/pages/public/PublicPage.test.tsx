import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { PAGE_NOTES } from "./pageNotes";
import PublicPage, { PublicView } from "./PublicPage";

// 「鶏を飼っていない方へ」（§11）。AI は答えない。公式の文を、出典と確認日つきで固定して示す。

const MEDICAL_ADVICE = /受診|治療|医師に|病院へ|保健所/u;

function show(node = <PublicPage />) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

afterEach(cleanup);

describe("PublicPage", () => {
  it("入力欄がない（質問する入口を作らない。§11）", () => {
    const { container } = show();
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "鶏を飼っていない方へ" })).toBeTruthy();
    expect(document.body.textContent).toContain("質問に答える機能はありません");
  });

  it("7 つの節が決まった順で並び、節の id は topic と同じ", () => {
    const { container } = show();
    const sections = [...container.querySelectorAll("section[data-topic]")];
    expect(sections.map((s) => s.getAttribute("data-topic"))).toEqual(OFFICIAL_GUIDANCE.map((g) => g.topic));
    for (const g of OFFICIAL_GUIDANCE) {
      const s = container.querySelector(`section#${g.topic}`);
      expect(s, g.topic).not.toBeNull();
      expect(within(s as HTMLElement).getByRole("heading", { level: 2, name: g.heading })).toBeTruthy();
    }
  });

  it("各節の文ごとに、出典の名前（リンク）と確認日がある", () => {
    const { container } = show();
    for (const g of OFFICIAL_GUIDANCE) {
      const section = container.querySelector(`section#${g.topic}`) as HTMLElement;
      const official = [...section.querySelectorAll("[data-role='official']")];
      expect(official, g.topic).toHaveLength(g.statements.length);
      g.statements.forEach((st, i) => {
        const block = official[i] as HTMLElement;
        expect(block.textContent, g.topic).toContain(st.text);
        const source = block.querySelector(".source-line") as HTMLElement;
        expect(source.textContent).toContain(`確認日 ${st.checkedOn}`);
        const a = within(source).getByRole("link", { name: st.sourceTitle });
        expect(a.getAttribute("href")).toBe(st.sourceUrl);
      });
    }
  });

  it("PAGE_NOTES は『このページからのお願い』の下だけに出て、公式の文の中には出ない", () => {
    const { container } = show();
    const all = Object.values(PAGE_NOTES).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const [topic, notes] of Object.entries(PAGE_NOTES)) {
      const section = container.querySelector(`section#${topic}`) as HTMLElement;
      const box = section.querySelector("[data-role='page-notes']") as HTMLElement;
      expect(box, topic).not.toBeNull();
      expect(within(box).getByRole("heading", { name: "このページからのお願い" })).toBeTruthy();
      for (const n of notes ?? []) expect(box.textContent, n).toContain(n);
    }
    for (const official of container.querySelectorAll("[data-role='official']")) {
      for (const n of all) expect(official.textContent, n).not.toContain(n);
    }
    // お願いの外（見出しと公式の文の外）に、作品の文が漏れていない
    for (const n of all) {
      const holders = [...container.querySelectorAll("p, li")].filter((el) => el.children.length === 0 && el.textContent === n);
      expect(holders.length, n).toBeGreaterThan(0);
      for (const h of holders) expect(h.closest("[data-role='page-notes']"), n).not.toBeNull();
    }
  });

  it("「このページからのお願い」は、公式の文と県のリンクの後ろにある（rumor の『上の県のページ』が指す先）", () => {
    const { container } = show();
    const section = container.querySelector("section#rumor") as HTMLElement;
    const links = section.querySelector(".guidance-links") as HTMLElement;
    const notes = section.querySelector("[data-role='page-notes']") as HTMLElement;
    expect(links.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes.textContent).toContain("上の県のページ");
  });

  it("PAGE_NOTES にも、禁止語と受診の案内がない", () => {
    for (const note of Object.values(PAGE_NOTES).flat()) {
      expect(findForbiddenPhrases(note), note).toEqual([]);
      expect(note, note).not.toMatch(MEDICAL_ADVICE);
    }
  });

  it("文面の確認の前は『文面は確認中です』（OFFICIAL_GUIDANCE_REVIEWED_ON が null の間）", () => {
    show();
    expect(screen.getByText(/文面は確認中です/)).toBeTruthy();
  });

  it("確認の後は確認日を出し、『確認中』とは出さない", () => {
    show(<PublicView reviewedOn="2026-11-07" />);
    expect(document.body.textContent).toContain("2026-11-07");
    expect(document.body.textContent).not.toContain("文面は確認中です");
  });

  it("ページ全体に、禁止語（区域の外です・安全・安心）がない", () => {
    show();
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });

  it("県のページは links のリンクだけで、文を写していない。外のリンクは新しい画面で開く", () => {
    const { container } = show();
    for (const g of OFFICIAL_GUIDANCE) {
      const section = container.querySelector(`section#${g.topic}`) as HTMLElement;
      for (const l of g.links ?? []) {
        const a = within(section).getByRole("link", { name: l.title });
        expect(a.getAttribute("href")).toBe(l.url);
        expect(a.getAttribute("rel")).toContain("noopener");
      }
    }
  });

  it("数羽飼っている方へ: 地図へのリンクがある（href は /）", () => {
    const { container } = show();
    const section = container.querySelector("section#small_flock") as HTMLElement;
    expect(within(section).getByRole("link", { name: /地図/ }).getAttribute("href")).toBe("/");
  });

  it("上に、7 つの節へのもくじ（#topic）がある", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(OFFICIAL_GUIDANCE.map((g) => `#${g.topic}`));
  });
});
