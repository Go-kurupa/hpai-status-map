// 県のページの前回との差分を取る純粋関数（I-02、設計書 §9.2 補 1）。固定 URL のページを更新する県（宮城など）は、
// 新しい URL を見るだけでは更新を逃すので、本文の足された行を見る。取得も時計も持たない。
import { hasHpaiWord, normalizeForMatch } from "../text";

export interface PageLink {
  href: string;
  text: string;
}

/** 本文を行に分ける。前後の空白（全角を含む）を取り、空行を除く。 */
export function pageLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s　]+|[\s　]+$/gu, ""))
    .filter((l) => l !== "");
}

/** 前回になくて今回にある行だけ（消えた行は入らない）。比べるのは正規化の後で、同じ行は 1 つにする。順は今回のまま。 */
export function addedLines(prev: readonly string[], next: readonly string[]): string[] {
  const seen = new Set(prev.map(normalizeForMatch));
  const out: string[] = [];
  for (const line of next) {
    const key = normalizeForMatch(line);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

const DATE_WORDS = /更新日|最終更新|年|月|日|時|分|令和|:|\/|-/gu;

/** 足された行が日付だけか（更新日の書き換えだけ）。数字、空白、更新日などの語を除いて空になれば true。足された行が 0 なら false。 */
export function isDateOnlyChange(added: readonly string[]): boolean {
  if (added.length === 0) return false;
  return added.every((line) => {
    const rest = normalizeForMatch(line).replace(/\d/gu, "").replace(DATE_WORDS, "");
    return rest === "";
  });
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
const bareHost = (u: URL): string => u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

/** 同じサイトか。ホストが同じで、先頭の www の有無だけは同じとみなす（www2 や他の県は別）。 */
export function sameSite(a: string, b: string): boolean {
  const ua = parse(a);
  const ub = parse(b);
  return ua !== null && ub !== null && bareHost(ua) === bareHost(ub);
}

/** リンクの同一性の鍵。fragment と先頭の www は無視する。 */
export function linkKey(href: string): string {
  const u = parse(href);
  if (u === null) return href;
  return `${u.protocol}//${bareHost(u)}${u.port === "" ? "" : `:${u.port}`}${u.pathname}${u.search}`;
}

/**
 * ページの新しいリンク。同じサイト（pageUrl と）のものだけで、知っているリンクと自分自身は除く（鍵で比べる）。
 * ページの題に語がある（titleHasWord）なら全部、ないなら（課のトップ、報道発表の一覧）リンクの文に語があるものだけ。
 * 返す href は fragment を外したもの。順は元のまま。数の上限は呼び手が決める。
 */
export function newLinks(input: { links: readonly PageLink[]; known: readonly string[]; pageUrl: string; titleHasWord: boolean }): PageLink[] {
  const known = new Set(input.known.map(linkKey));
  known.add(linkKey(input.pageUrl));
  const out: PageLink[] = [];
  for (const link of input.links) {
    const u = parse(link.href);
    if (u === null || (u.protocol !== "https:" && u.protocol !== "http:")) continue;
    if (!sameSite(link.href, input.pageUrl)) continue;
    u.hash = "";
    const key = linkKey(u.href);
    if (known.has(key)) continue;
    if (!input.titleHasWord && !hasHpaiWord(link.text)) continue;
    known.add(key);
    out.push({ href: u.href, text: link.text });
  }
  return out;
}
