// 県の RSS の見回り（I-02、設計書 §9.2 補 2）。全庁新着や報道発表の RSS から、鳥インフルの語のある項目だけを拾う。
// 最初の確認は基準だけ（過去の項目を読み取りに渡さない）。別のサイトのリンクは取得しない。
import { logger } from "firebase-functions";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseIso8601Date, parseRfc822Date } from "@hpai/shared/read/announcedOn";
import { hasHpaiWord } from "@hpai/shared/text";
import type { IsoDate, Source } from "@hpai/shared/types";
import { FAILED, type CheckResult, type Handlers, type WatchDeps } from "./deps";
import { decodeBody, fingerprint } from "./extract";
import { MAX_LINK_TRIES, MAX_NEW_LINKS_PER_CHECK, allowPrefEntrance, allowPrefLink, loadJson, processLink, queueUnreachable, saveJson } from "./page";
import { storeDocument } from "./store";

export interface FeedItem {
  /** guid、なければ link、なければ題。見たかどうかの鍵。 */
  id: string;
  title: string;
  link: string | null;
  description: string;
  /** 項目の発表日（日本時間）。RSS の pubDate と Atom の published だけ。なければ、読めなければ項目に持たない。 */
  publishedOn?: IsoDate;
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, isArray: (name) => name === "item" || name === "entry" });

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => v !== null && typeof v === "object" && !Array.isArray(v);

/** 文字、または {#text} を持つ要素（Atom の type="html" の題など）から文字を取る。 */
function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (isNode(v)) return textOf(v["#text"]);
  return "";
}

/** Atom の link（href 属性）。alternate か rel のないものを優先し、なければ最初。RSS の link は文字。 */
function linkOf(v: unknown): string | null {
  const list = Array.isArray(v) ? v : [v];
  const hrefs = list
    .map((l) => (isNode(l) ? { href: textOf(l["@_href"]), rel: textOf(l["@_rel"]) } : { href: textOf(l), rel: "" }))
    .filter((l) => l.href !== "");
  const pick = hrefs.find((l) => l.rel === "" || l.rel === "alternate") ?? hrefs[0];
  return pick?.href ?? null;
}

/**
 * RSS 2.0、RSS 1.0（rdf:RDF 直下の item）、Atom を項目の配列にする。
 * 壊れた XML、フィードではない XML（エラーページなど）は throw する（呼び手は失敗に数える）。
 */
export function parseFeed(xml: string): FeedItem[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`XML が壊れています: ${valid.err.msg}`);
  const doc = parser.parse(xml) as Node;

  let raw: unknown[];
  if (isNode(doc.rss)) {
    const channel = doc.rss.channel;
    raw = isNode(channel) && Array.isArray(channel.item) ? channel.item : [];
  } else if (isNode(doc.RDF)) {
    raw = Array.isArray(doc.RDF.item) ? doc.RDF.item : [];
  } else if (isNode(doc.feed)) {
    raw = Array.isArray(doc.feed.entry) ? doc.feed.entry : [];
  } else {
    throw new Error("RSS でも Atom でもありません");
  }

  return raw.filter(isNode).map((n) => {
    const title = textOf(n.title);
    const link = linkOf(n.link);
    const description = textOf(n.description) || textOf(n.summary) || textOf(n.encoded) || textOf(n.content);
    // 発表日は RSS の pubDate と Atom の published だけ（updated と dc:date は更新日かもしれないので使わない）。決まった書き方だけを厳密に読む
    const publishedOn = parseRfc822Date(textOf(n.pubDate)) ?? parseIso8601Date(textOf(n.published));
    return { id: textOf(n.guid) || textOf(n.id) || link || title, title, link, description, ...(publishedOn === null ? {} : { publishedOn }) };
  });
}

/** 題か説明に鳥インフルの語があるか。「インフルエンザ」だけ（学校の臨時休業など）は拾わない。 */
export function feedItemHit(item: FeedItem): boolean {
  return hasHpaiWord(item.title) || hasHpaiWord(item.description);
}

interface RssState {
  version: 1;
  seen: string[];
  tries: Record<string, number>;
}

/** 県の RSS。新しい項目のうち語のあるものを文書にする。リンクが同じサイトならそのページを取り、そうでなければ項目の文を文書にする。 */
export async function checkRss(source: Source, deps: WatchDeps): Promise<CheckResult> {
  const o = await deps.fetch(source.url, { allowUrl: allowPrefEntrance(source.url) });
  if (o.kind === "not_modified") return { ok: true, etag: null, lastModified: null, fingerprint: source.fingerprint };
  if (o.kind !== "ok") return FAILED;

  let items: FeedItem[];
  try {
    items = parseFeed(decodeBody(o.body, o.contentType));
  } catch (e) {
    logger.warn("RSS を解釈できませんでした", { sourceId: source.id, message: e instanceof Error ? e.message : String(e) });
    return FAILED;
  }
  const result: CheckResult = { ok: true, etag: null, lastModified: null, fingerprint: fingerprint(items.map((i) => `${i.id}\n${i.title}`).join("\n")) };

  const state = await loadJson<RssState>(source.id);
  if (state === null) {
    await saveJson(source.id, { version: 1, seen: items.map((i) => i.id), tries: {} } satisfies RssState);
    return result;
  }

  // 200 でも、基準に項目があったのに 0 項目なら空や別物のフィード。失敗にして基準（seen）を上書きしない
  if (items.length === 0 && state.seen.length > 0) return FAILED;

  const seen = new Set(state.seen);
  const hits = items.filter((i) => !seen.has(i.id) && feedItemHit(i));
  const take = hits.slice(0, MAX_NEW_LINKS_PER_CHECK);
  const pending = new Set(hits.slice(MAX_NEW_LINKS_PER_CHECK).map((i) => i.id)); // 上限の外は次回に回す
  const tries: Record<string, number> = {};
  const allowLink = allowPrefLink(source.url);

  for (const item of take) {
    const link = item.link;
    let linkUrl: URL | null = null;
    try {
      linkUrl = link === null ? null : new URL(link);
    } catch {
      linkUrl = null;
    }
    let done = false;
    let unreachable = false; // 取れないまま項目の文で代える（運営者の箱にも入れる）
    if (linkUrl !== null && allowLink(linkUrl)) {
      const r = await processLink({ href: linkUrl.href, text: item.title }, { source, deps, allow: allowLink }, { follow: false, requireWord: false, announcedOn: item.publishedOn });
      if (r.result === "done") {
        done = true;
      } else {
        const n = (state.tries[item.id] ?? 0) + 1;
        if (r.result === "retry" && n < MAX_LINK_TRIES) {
          tries[item.id] = n;
          pending.add(item.id); // 取り直す
          continue;
        }
        unreachable = true; // 拒否（robots_denied、not_allowed）は再試行せず、取れない回数が上限でも諦める
        logger.warn("RSS の項目のリンクを取れないので、項目の文を文書にして運営者の箱に入れます", { sourceId: source.id, url: link, why: r.why });
      }
    }
    if (!done) {
      // 別のサイトや、リンクのない項目、取れなかった項目: 項目の題と説明を文書にする（別のサイトは取得しない）
      const text = `${item.title}\n${item.description}`.trim();
      const stored = await storeDocument({
        source,
        url: link ?? source.url,
        title: item.title,
        contentType: "html",
        body: Buffer.from(text),
        fingerprint: fingerprint(text),
        textForRead: text,
        hasTextLayer: true,
        prefCode: source.prefCode,
        fetchedAt: o.fetchedAt,
        readState: "pending",
        ...(item.publishedOn === undefined ? {} : { announcedOn: item.publishedOn }),
      });
      if (unreachable) await queueUnreachable({ source, deps, allow: allowLink }, { url: link ?? source.url, title: item.title, documentId: stored.id });
    }
  }

  await saveJson(source.id, { version: 1, seen: items.map((i) => i.id).filter((id) => !pending.has(id)), tries } satisfies RssState);
  return result;
}

export const rssHandlers: Handlers = { pref_rss: checkRss };

