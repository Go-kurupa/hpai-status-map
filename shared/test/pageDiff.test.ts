import { describe, expect, it } from "vitest";
import { addedLines, isDateOnlyChange, newLinks, pageLines, sameSite } from "../src/read/pageDiff";

describe("pageLines", () => {
  it("改行で分け、前後の空白を取り、空行を除く", () => {
    expect(pageLines("  a \n\n b\n　\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("addedLines: 足された行だけ", () => {
  it("消えた行は入らず、足された行だけが順に入る", () => {
    expect(addedLines(["a", "b", "c"], ["a", "c", "d", "e"])).toEqual(["d", "e"]);
  });
  it("全角と半角、空白の違いは同じ行とみなす", () => {
    expect(addedLines(["令和７年　12月20日 発生"], ["令和7年12月20日発生"])).toEqual([]);
  });
  it("同じ行が 2 つ足されても 1 つにする。空の前は全部が足された行", () => {
    expect(addedLines([], ["x", "x", "y"])).toEqual(["x", "y"]);
  });
});

describe("isDateOnlyChange", () => {
  it("「更新日：2026年11月3日」だけは日付のみの変更", () => {
    expect(isDateOnlyChange(["更新日：2026年11月3日"])).toBe(true);
    expect(isDateOnlyChange(["最終更新日 令和8年11月3日 10:30", "2026/11/03"])).toBe(true);
  });
  it("「第2報」や本文の足しは違う", () => {
    expect(isDateOnlyChange(["第2報"])).toBe(false);
    expect(isDateOnlyChange(["更新日：2026年11月3日", "第2報を掲載しました"])).toBe(false);
    expect(isDateOnlyChange(["津山市の農場で発生しました"])).toBe(false);
  });
  it("足された行が 0 のときは日付のみではなく、変更なし（false）", () => {
    expect(isDateOnlyChange([])).toBe(false);
  });
});

describe("sameSite", () => {
  it("www の有無は同じ。サブドメインや他の県は別", () => {
    expect(sameSite("https://www.pref.okayama.jp/a", "https://pref.okayama.jp/b")).toBe(true);
    expect(sameSite("https://www.pref.okayama.jp/a", "https://www.pref.okayama.jp/b")).toBe(true);
    expect(sameSite("https://www.pref.okayama.jp/a", "https://www.pref.hyogo.lg.jp/a")).toBe(false);
    expect(sameSite("https://www.pref.okayama.jp/a", "https://www2.pref.okayama.jp/a")).toBe(false);
    expect(sameSite("https://www.pref.okayama.jp/a", "not a url")).toBe(false);
  });
});

describe("newLinks", () => {
  const page = "https://www.pref.okayama.jp/page/816850.html";
  const L = (path: string, text: string) => ({ href: `https://www.pref.okayama.jp${path}`, text });
  const links = [L("/page/1.html", "お知らせ"), L("/uploaded/a.pdf", "第2報"), { href: "https://example.jp/x.html", text: "鳥インフルエンザ" }, L("/page/2.html", "高病原性鳥インフルエンザ（津山市）")];

  it("題に語のあるページは、新しい同じサイトのリンクを全部取る。別のサイトは取らない", () => {
    const got = newLinks({ links, known: [], pageUrl: page, titleHasWord: true });
    expect(got.map((l) => l.href)).toEqual([
      "https://www.pref.okayama.jp/page/1.html",
      "https://www.pref.okayama.jp/uploaded/a.pdf",
      "https://www.pref.okayama.jp/page/2.html",
    ]);
  });
  it("題に語がないページ（課のトップ、報道発表の一覧）は、リンクの文に語があるものだけ", () => {
    const got = newLinks({ links, known: [], pageUrl: page, titleHasWord: false });
    expect(got.map((l) => l.href)).toEqual(["https://www.pref.okayama.jp/page/2.html"]);
  });
  it("知っているリンクは除く（fragment と www の有無は無視）。自分自身も除く", () => {
    const got = newLinks({
      links: [L("/page/1.html#top", "a"), { href: "https://pref.okayama.jp/page/2.html", text: "b" }, L("/page/816850.html", "自分"), L("/page/3.html", "c")],
      known: ["https://www.pref.okayama.jp/page/1.html", "https://www.pref.okayama.jp/page/2.html"],
      pageUrl: page,
      titleHasWord: true,
    });
    expect(got.map((l) => l.href)).toEqual(["https://www.pref.okayama.jp/page/3.html"]);
  });
});
