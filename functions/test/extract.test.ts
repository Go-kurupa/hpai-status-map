import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeBody, extractHtml } from "../src/watch/extract";

const sjis = (s: string) => iconv.encode(s, "Shift_JIS");
const eucjp = (s: string) => iconv.encode(s, "EUC-JP");

describe("decodeBody", () => {
  it("content-type の charset を使う（Shift_JIS）", () => {
    const body = sjis("<html><body>鳥インフルエンザ</body></html>");
    expect(decodeBody(body, "text/html; charset=Shift_JIS")).toContain("鳥インフルエンザ");
    expect(decodeBody(body, "text/html; charset=x-sjis")).toContain("鳥インフルエンザ");
    expect(decodeBody(body, 'text/html; charset="windows-31j"')).toContain("鳥インフルエンザ");
  });

  it("content-type の charset を使う（EUC-JP）", () => {
    expect(decodeBody(eucjp("<p>家畜保健衛生所</p>"), "text/html; charset=EUC-JP")).toContain("家畜保健衛生所");
  });

  it("content-type になければ XML 宣言を使う", () => {
    const body = sjis('<?xml version="1.0" encoding="Shift_JIS"?><rss><title>新着情報</title></rss>');
    expect(decodeBody(body, "application/xml")).toContain("新着情報");
    expect(decodeBody(body, "")).toContain("新着情報");
  });

  it("どちらもなければ meta を使う（charset 形式と http-equiv 形式）", () => {
    expect(decodeBody(sjis('<html><head><meta charset="shift_jis"></head><body>畜産課</body></html>'), "text/html")).toContain("畜産課");
    expect(
      decodeBody(
        eucjp('<html><head><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=EUC-JP"></head><body>畜産課</body></html>'),
        "text/html",
      ),
    ).toContain("畜産課");
  });

  it("順序は content-type、XML 宣言、meta（食い違えば前を取る）", () => {
    const html = '<?xml version="1.0" encoding="UTF-8"?><html><head><meta charset="utf-8"></head><body>本文テキスト</body></html>';
    // content-type が Shift_JIS ならそれに従う（中身は Shift_JIS で作る）
    expect(decodeBody(sjis(html), "text/html; charset=Shift_JIS")).toContain("本文テキスト");
    // content-type がなく XML 宣言と meta が食い違えば XML 宣言
    const xml = '<?xml version="1.0" encoding="EUC-JP"?><html><head><meta charset="utf-8"></head><body>本文テキスト</body></html>';
    expect(decodeBody(eucjp(xml), "text/html")).toContain("本文テキスト");
  });

  it("手がかりがなければ UTF-8（BOM があれば外す）", () => {
    expect(decodeBody(Buffer.from("<p>鳥インフル</p>", "utf8"), "text/html")).toBe("<p>鳥インフル</p>");
    expect(decodeBody(Buffer.from("﻿<p>鳥インフル</p>", "utf8"), "")).toBe("<p>鳥インフル</p>");
  });

  it("知らない charset の名前は UTF-8 にする（例外にしない）", () => {
    expect(decodeBody(Buffer.from("<p>畜産</p>", "utf8"), "text/html; charset=no-such-charset")).toBe("<p>畜産</p>");
  });
});

describe("extractHtml", () => {
  const BASE = "https://www.pref.example.lg.jp/soshiki/chikusan/index.html";

  it("title と本文を取り出し、script、style、nav、header、footer、aside を落とす", () => {
    const html = `<html><head><title> 高病原性鳥インフルエンザに関する情報 </title><style>.x{}</style><script>var leak = "SCRIPT";</script></head>
      <body><header>ヘッダーの語</header><nav>ナビの語</nav>
      <p>本文その1</p><p>本文その2</p>
      <aside>サイドの語</aside><footer>フッターの語</footer><script>more()</script></body></html>`;
    const r = extractHtml(html, BASE);
    expect(r.title).toBe("高病原性鳥インフルエンザに関する情報");
    expect(r.text).toContain("本文その1");
    expect(r.text).toContain("本文その2");
    for (const dropped of ["ヘッダーの語", "ナビの語", "サイドの語", "フッターの語", "SCRIPT", ".x{}", "more()"]) expect(r.text).not.toContain(dropped);
  });

  it("段落の間に改行を入れる（語がつながらない）", () => {
    const r = extractHtml("<body><p>鳥</p><p>インフル</p><ul><li>一</li><li>二</li></ul>a<br>b</body>", BASE);
    expect(r.text).not.toContain("鳥インフル");
    expect(r.text.split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["鳥", "インフル", "一", "二", "a", "b"]);
  });

  it("本文の容器は #main_content, main, #main, #contents, #tmp_contents, article の最初（並びの優先）", () => {
    const html = `<body><div>外の語</div>
      <article>記事の語</article>
      <div id="contents">contentsの語</div>
      <main>mainの語</main>
      <div id="main_content">main_contentの語</div></body>`;
    const r = extractHtml(html, BASE);
    expect(r.text).toContain("main_contentの語");
    for (const other of ["外の語", "記事の語", "contentsの語", "mainの語"]) expect(r.text).not.toContain(other);

    const second = extractHtml(`<body><div>外の語</div><article>記事の語</article><main>mainの語</main></body>`, BASE);
    expect(second.text).toContain("mainの語"); // article が先に現れても main が優先
    expect(second.text).not.toContain("記事の語");

    const tmp = extractHtml(`<body><div>外の語</div><div id="tmp_contents">tmpの語</div></body>`, BASE);
    expect(tmp.text).toBe("tmpの語");
    const art = extractHtml(`<body><div>外の語</div><article>記事の語</article></body>`, BASE);
    expect(art.text).toBe("記事の語");
  });

  it("容器がなければ body", () => {
    const r = extractHtml("<body><div>外の語</div><span>中の語</span></body>", BASE);
    expect(r.text).toContain("外の語");
    expect(r.text).toContain("中の語");
  });

  it("リンクは絶対 URL。mailto、tel、javascript、# だけのものを除き、重複を除く", () => {
    const html = `<body><main>
      <a href="/soshiki/a.html">絶対パス</a>
      <a href="b.html">相対</a>
      <a href="../c.pdf">PDF</a>
      <a href="https://other.example.go.jp/d">別の場所</a>
      <a href="mailto:x@example.test">メール</a>
      <a href="tel:0000">電話</a>
      <a href="javascript:void(0)">js</a>
      <a href="#">先頭</a>
      <a href="#sec">節</a>
      <a href="/soshiki/a.html">重複</a>
      <a>href なし</a>
      </main></body>`;
    const r = extractHtml(html, BASE);
    expect(r.links).toEqual([
      { href: "https://www.pref.example.lg.jp/soshiki/a.html", text: "絶対パス" },
      { href: "https://www.pref.example.lg.jp/soshiki/chikusan/b.html", text: "相対" },
      { href: "https://www.pref.example.lg.jp/soshiki/c.pdf", text: "PDF" },
      { href: "https://other.example.go.jp/d", text: "別の場所" },
    ]);
  });

  it("nav の中のリンクは含めない", () => {
    const r = extractHtml(`<body><nav><a href="/menu">メニュー</a></nav><main><a href="/news">新着</a></main></body>`, BASE);
    expect(r.links.map((l) => l.href)).toEqual(["https://www.pref.example.lg.jp/news"]);
  });
});
