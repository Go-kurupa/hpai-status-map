import { describe, expect, it } from "vitest";
import { feedItemHit, parseFeed } from "../src/watch/rss";

const RSS2_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>新着</title>
<item><title>鳥インフルエンザについて</title><link>https://www.pref.example.jp/a.html</link><description>説明です</description><guid>g1</guid></item>
</channel></rss>`;

const RSS1 = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://www.pref.example.jp/"><title>新着</title></channel>
<item rdf:about="https://www.pref.example.jp/1.html"><title>一つ目</title><link>https://www.pref.example.jp/1.html</link><description>高病原性鳥インフルエンザの発生</description></item>
<item rdf:about="https://www.pref.example.jp/2.html"><title>二つ目</title><link>https://www.pref.example.jp/2.html</link></item>
</rdf:RDF>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>新着</title>
<entry><title type="html">家きんの疾病</title><link rel="self" href="https://www.pref.example.jp/self"/><link rel="alternate" href="https://www.pref.example.jp/e1.html"/><id>tag:e1</id><summary>要約</summary></entry>
<entry><title>二つ目</title><link href="https://www.pref.example.jp/e2.html"/><id>tag:e2</id><content type="html">本文</content></entry>
</feed>`;

describe("parseFeed", () => {
  it("1 件だけの RSS 2.0 でも配列で返す", () => {
    expect(parseFeed(RSS2_ONE)).toEqual([{ id: "g1", title: "鳥インフルエンザについて", link: "https://www.pref.example.jp/a.html", description: "説明です" }]);
  });
  it("RSS 1.0（rdf:RDF 直下の item）", () => {
    const items = parseFeed(RSS1);
    expect(items.map((i) => i.link)).toEqual(["https://www.pref.example.jp/1.html", "https://www.pref.example.jp/2.html"]);
    expect(items[0]!.description).toBe("高病原性鳥インフルエンザの発生");
    expect(items[1]!.description).toBe("");
  });
  it("Atom（entry、link の href。alternate を選び、type つきの題も文字にする）", () => {
    const items = parseFeed(ATOM);
    expect(items).toEqual([
      { id: "tag:e1", title: "家きんの疾病", link: "https://www.pref.example.jp/e1.html", description: "要約" },
      { id: "tag:e2", title: "二つ目", link: "https://www.pref.example.jp/e2.html", description: "本文" },
    ]);
  });
  it("id は guid、なければ link、なければ題", () => {
    const xml = `<rss><channel><item><title>t</title><link>https://x.jp/1</link></item><item><title>題だけ</title></item></channel></rss>`;
    expect(parseFeed(xml).map((i) => i.id)).toEqual(["https://x.jp/1", "題だけ"]);
  });
  it("item が 0 件の正しい RSS は、解釈としては空の配列（それを成功とするかは checkRss が基準と比べて決める）", () => {
    expect(parseFeed(`<rss><channel><title>t</title></channel></rss>`)).toEqual([]);
  });
  it("壊れた XML は throw する（失敗に数える）", () => {
    expect(() => parseFeed("<rss><channel><item><title>a</title></item>")).toThrow();
    expect(() => parseFeed("<rss><channel><item><title>a</titl></item></channel></rss>")).toThrow();
    expect(() => parseFeed("not xml at all")).toThrow();
  });
  it("フィードではない正しい XML（HTML のエラーページなど）も throw する", () => {
    expect(() => parseFeed("<html><body>メンテナンス中</body></html>")).toThrow();
  });
});

describe("feedItemHit: 語で絞る", () => {
  const item = (title: string, description = "") => ({ id: "x", title, link: null, description });
  it("学校の臨時休業（インフルエンザだけ）は拾わない", () => {
    expect(feedItemHit(item("インフルエンザ様疾患による学校の臨時休業について（第23報）", "インフルエンザによる学級閉鎖"))).toBe(false);
  });
  it("題に語があれば拾う。説明文に「高病原性鳥」があれば拾う", () => {
    expect(feedItemHit(item("鳥インフルエンザの発生について"))).toBe(true);
    expect(feedItemHit(item("家きんの疾病について", "高病原性鳥インフルエンザの疑似患畜を確認しました"))).toBe(true);
  });
});

describe("parseFeed: 発表日（publishedOn）", () => {
  const one = (extra: string) => `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>t</title><link>https://x.jp/1</link>${extra}</item></channel></rss>`;
  const atom = (extra: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>t</title><link href="https://x.jp/1"/><id>1</id>${extra}</entry></feed>`;
  it("RSS の pubDate と Atom の published だけを日本時間の日付にする", () => {
    expect(parseFeed(one("<pubDate>Sat, 20 Dec 2025 01:00:00 +0900</pubDate>"))[0]!.publishedOn).toBe("2025-12-20");
    expect(parseFeed(one("<pubDate>Fri, 19 Dec 2025 23:00:00 GMT</pubDate>"))[0]!.publishedOn).toBe("2025-12-20");
    expect(parseFeed(atom("<published>2025-12-19T15:30:00Z</published><updated>2025-12-25T00:00:00Z</updated>"))[0]!.publishedOn).toBe("2025-12-20");
  });
  it("日本時間の 15 時以降を、ゾーンなしで書いても 1 日ずらさない", () => {
    expect(parseFeed(one("<pubDate>Sat, 20 Dec 2025 16:00:00</pubDate>"))[0]!.publishedOn).toBe("2025-12-20");
    expect(parseFeed(atom("<published>2025-12-20T16:00:00</published>"))[0]!.publishedOn).toBe("2025-12-20");
  });
  it("updated だけの Atom、dc:date だけの RSS は発表日にしない（更新日かもしれない）", () => {
    expect("publishedOn" in parseFeed(atom("<updated>2025-12-20T09:00:00+09:00</updated>"))[0]!).toBe(false);
    expect("publishedOn" in parseFeed(one("<dc:date>2025-12-20T09:00:00+09:00</dc:date>"))[0]!).toBe(false);
  });
  it("日付がない、読み込めないときは項目に publishedOn を持たせない", () => {
    expect("publishedOn" in parseFeed(one(""))[0]!).toBe(false);
    expect("publishedOn" in parseFeed(one("<pubDate>いつか</pubDate>"))[0]!).toBe(false);
    expect("publishedOn" in parseFeed(atom("<published>2025/12/20</published>"))[0]!).toBe(false);
  });
});
