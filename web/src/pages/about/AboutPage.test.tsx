import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionTabs } from "../../ui/SectionTabs";
import AboutPage from "./AboutPage";
import { DATA_SOURCES } from "./aboutTexts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SectionTabs（今季の発生／過去の発生の中の見方）", () => {
  const current = () =>
    screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page")
      .map((a) => a.textContent);
  it("今季: / は地図、/season は一覧と数が選択中", () => {
    render(<MemoryRouter initialEntries={["/season"]}><SectionTabs group="now" /></MemoryRouter>);
    expect(within(screen.getByRole("navigation", { name: "今季の発生の見方" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/season"]);
    expect(current()).toEqual(["一覧と数"]);
  });
  it("過去: 地図で比べる、数で見るの 2 つ（2026-11-07 作者の決定 案 A で名前を変えた）。選択地域のまわり（/town）は最初の画面と重なるので並べない（作者 11/7）。去年の再現も並べない（決定 16）", () => {
    render(<MemoryRouter initialEntries={["/explore"]}><SectionTabs group="past" /></MemoryRouter>);
    expect(within(screen.getByRole("navigation", { name: "過去の発生の見方" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/compare", "/explore"]);
    expect(current()).toEqual(["数で見る"]);
  });
});

describe("AboutPage（このサイトについて）", () => {
  beforeEach(() => {
    // 試験の結果の JSON は読めない扱い（読めなくても画面は出る）
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
  });
  it("題は 1 つで、目次は 5 つ。利用上のご案内、運営者、データの出典、AI の読み取りの確かさと費用、集める情報と消し方の順", async () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["このサイトについて"]);
    const toc = within(screen.getByRole("navigation", { name: "もくじ" })).getAllByRole("link");
    expect(toc.map((a) => a.textContent)).toEqual(["利用上のご案内", "運営者", "データの出典", "AI の読み取りの確かさと費用", "集める情報と消し方"]);
    expect(toc.map((a) => a.getAttribute("href"))).toEqual(["#about-guide", "#about-operator", "#about-sources", "#about-ai", "#about-privacy"]);
    // 入れ子の試験の結果とプライバシーは、自分の題（h1）と運営者の節を重ねて出さない
    await screen.findByRole("heading", { level: 3, name: "読み取りの試験（実測）" }).catch(() => null);
    expect(screen.queryByRole("heading", { name: "試験の結果と費用" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "プライバシー" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "運営者" })).toHaveLength(1);
  });
  it("利用上のご案内に、1 年前の流れ（/replay の唯一の入口）と記録を試すがある。審査員向けの文と入口（?judge=1）はサイトに出さない（2026-11-07 作者の決定）", async () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    const sec = document.getElementById("about-guide") as HTMLElement;
    expect(within(sec).getByRole("heading", { level: 2 }).textContent).toBe("利用上のご案内");
    expect(within(sec).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/replay", "/sample"]);
    expect(sec.textContent).toContain("県の発表が正");
    expect(document.body.textContent).not.toContain("審査員");
    expect(document.querySelector('a[href*="judge=1"]')).toBeNull();
    // 舞台裏は AI の節から開ける
    const back = await screen.findByRole("link", { name: "去年の再現の舞台裏を見る" });
    expect(back.closest("#about-ai")).not.toBeNull();
  });
  it("データの出典は一覧で、URL のあるものは新しいタブで開くリンク。作品の中ですでに使っている URL だけ", () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    const items = within(document.querySelector(".about-sources") as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(DATA_SOURCES.length);
    const links = within(document.querySelector(".about-sources") as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(DATA_SOURCES.filter((d) => d.url).length);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("href")).toMatch(/^https:\/\/(www\.maff\.go\.jp|www\.env\.go\.jp|nlftp\.mlit\.go\.jp|maps\.gsi\.go\.jp)\//);
    }
  });
});
