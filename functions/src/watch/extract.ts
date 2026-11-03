// 取得した本文の取り出し。HTML は本文とリンクだけにする（取り決め 3.7）。
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const SNIFF_BYTES = 4096;

function pickCharset(text: string | null | undefined): string | null {
  const m = /charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i.exec(text ?? "");
  return m?.[1] ?? null;
}

/** content-type、XML 宣言、meta の順に文字コードを決める。分からなければ UTF-8。 */
export function decodeBody(body: Buffer, contentType: string): string {
  const head = body.subarray(0, SNIFF_BYTES).toString("latin1");
  const candidates = [
    pickCharset(contentType),
    /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9_.:-]+)["']/i.exec(head)?.[1] ?? null,
    /<meta\s[^>]*charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i.exec(head)?.[1] ?? null,
  ];
  const charset = candidates.find((c): c is string => c !== null && iconv.encodingExists(c)) ?? "utf-8";
  return iconv.decode(body, charset);
}

const DROPPED = "script, style, nav, header, footer, aside";
/** 本文の容器。並びの順に探し、最初に見つかったものを使う。 */
const CONTAINERS = ["#main_content", "main", "#main", "#contents", "#tmp_contents", "article"];
const BLOCKS = "p, div, li, tr, td, th, h1, h2, h3, h4, h5, h6, section, article, dt, dd, ul, ol, table, pre, blockquote";

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function extractHtml(html: string, baseUrl: string): { title: string; text: string; links: Array<{ href: string; text: string }> } {
  const $ = cheerio.load(html);
  const title = collapse($("title").first().text());
  $(DROPPED).remove();

  let container: cheerio.Cheerio<any> = $("body").first();
  for (const selector of CONTAINERS) {
    const found = $(selector).first();
    if (found.length > 0) {
      container = found;
      break;
    }
  }

  // リンクは文を変える前に集める
  const links = new Map<string, string>();
  container.find("a[href]").each((_, el) => {
    const raw = ($(el).attr("href") ?? "").trim();
    if (raw === "" || raw.startsWith("#")) return;
    let href: URL;
    try {
      href = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (href.protocol !== "http:" && href.protocol !== "https:") return; // mailto、tel、javascript など
    const text = collapse($(el).text()) || collapse($(el).find("img").first().attr("alt") ?? "");
    if (!links.has(href.href) || (links.get(href.href) === "" && text !== "")) links.set(href.href, text);
  });

  container.find("br").replaceWith("\n");
  container.find(BLOCKS).append("\n");
  const text = container
    .text()
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t　]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");

  return { title, text, links: [...links].map(([href, linkText]) => ({ href, text: linkText })) };
}
