// 取得した本文の取り出し。HTML は本文とリンクだけにする（取り決め 3.7）。
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { extractText, getDocumentProxy } from "unpdf";
import { normalizeForMatch } from "@hpai/shared/text";

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

// ── PDF の文字層と指紋（I-01。X-07、X-14 も使う） ──

/** 1 ページ平均この字数（空白を除く）に満たない PDF は文字層なしとみなす。 */
const MIN_CHARS_PER_PAGE = 30;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 正規化した本文の SHA-256。全角と半角、空白、改行の違いでは変わらない。文字層のない PDF は呼び手が sha256Hex(body)。 */
export function fingerprint(text: string): string {
  return sha256Hex(normalizeForMatch(text));
}

/** 空白を除いた字数の 1 ページ平均が 30 字以上か。 */
export function hasTextLayerOf(text: string, pages: number): boolean {
  if (pages <= 0) return false;
  return [...text.replace(/\s+/gu, "")].length / pages >= MIN_CHARS_PER_PAGE;
}

/** PDF の文字を 1 片ずつ、ページと位置つきで取り出す（表を読むため。環境省の野鳥の一覧）。読めない PDF は空。 */
export async function extractPdfItems(body: Buffer): Promise<Array<{ page: number; s: string; x: number; y: number }>> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const out: Array<{ page: number; s: string; x: number; y: number }> = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
        if (typeof it.str !== "string" || it.str.trim() === "" || !it.transform) continue;
        out.push({ page: p, s: it.str, x: Math.round(it.transform[4]!), y: Math.round(it.transform[5]!) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** PDF の文字層を取り出す。読めない PDF は throw せず空を返す。 */
export async function extractPdfText(body: Buffer): Promise<{ text: string; pages: number; hasTextLayer: boolean }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const joined = text.join("\n");
    return { text: joined, pages: totalPages, hasTextLayer: hasTextLayerOf(joined, totalPages) };
  } catch {
    return { text: "", pages: 0, hasTextLayer: false };
  }
}
