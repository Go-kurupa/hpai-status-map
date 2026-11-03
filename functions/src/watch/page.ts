// 県のページの見回り（I-02、設計書 §9.2 補 1）。固定 URL のページ（pref_fixed）と報道発表の一覧（pref_press_list）。
// Claude は使わない。前回との差分（足された行、新しいリンク）を取り出し、文書にして読み取り（I-05）に回す。
// 県のサイトには etag も lastModified も送らない（愛知は Last-Modified と本文の日付が食い違う）。変化は本文の指紋で見分ける。
import { logger } from "firebase-functions";
import { toJstIso } from "@hpai/shared/dates";
import { PREF_DOMAINS, isPrefDomainHost } from "@hpai/shared/pref";
import { addedLines, isDateOnlyChange, linkKey, newLinks, pageLines, sameSite, type PageLink } from "@hpai/shared/read/pageDiff";
import { hasHpaiWord, normalizeForMatch } from "@hpai/shared/text";
import type { IsoDateTime, Source } from "@hpai/shared/types";
import { bucket } from "../admin";
import { FAILED, type CheckResult, type Handlers, type WatchDeps } from "./deps";
import { decodeBody, extractHtml, extractPdfText, fingerprint, sha256Hex } from "./extract";
import { storeDocument } from "./store";

/** 1 回の確認で新しく取るリンクの上限（1 ページあたり）。残りは次回に回す。 */
export const MAX_NEW_LINKS_PER_CHECK = 20;
/** 事例のページを追いかける日数。 */
export const FOLLOW_DAYS = 60;
/** 追いかける事例のページの数の上限（新しいものから）。 */
export const MAX_FOLLOWED = 5;
/** 取れないリンクを何回まで取り直すか。超えたら諦める（恒久的な 404 を毎回取りに行かない）。 */
export const MAX_LINK_TRIES = 3;

// ── 取ってよい先 ──

const prefDomainOf = (hostname: string): string | null => {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length; i++) {
    const d = labels.slice(i).join(".");
    if (PREF_DOMAINS.has(d)) return d;
  }
  return null;
};

/**
 * 県の入口を取ってよい先: https で、47 の公式ドメインのうち入口と同じ県のドメインの下だけ（リダイレクトの先にも効く）。
 * TLS の設定は緩めない。
 */
export function allowPrefEntrance(sourceUrl: string): (u: URL) => boolean {
  const own = prefDomainOf(new URL(sourceUrl).hostname);
  return (u) => u.protocol === "https:" && isPrefDomainHost(u.hostname) && own !== null && prefDomainOf(u.hostname) === own;
}

/** 入口のページからたどるリンクを取ってよい先: 入口と同じサイト（www の有無は同じ）。別のサイトは取らない。 */
export function allowPrefLink(sourceUrl: string): (u: URL) => boolean {
  const entrance = allowPrefEntrance(sourceUrl);
  return (u) => entrance(u) && sameSite(u.href, sourceUrl);
}

// ── 前回の状態（Storage の state/pages/{sourceId}.json） ──

interface FollowedState {
  url: string;
  addedAt: IsoDateTime;
  title: string;
  lines: string[];
  links: string[];
  tries: Record<string, number>;
}

export interface PageState {
  version: 1;
  finalUrl: string;
  title: string;
  titleHasWord: boolean;
  hasWord: boolean;
  lines: string[];
  /** 取り込み済みのリンク。取れなかったリンクや上限を超えたリンクは入れない（次回また新しいリンクとして出る）。 */
  links: string[];
  tries: Record<string, number>;
  followed: FollowedState[];
}

const statePath = (sourceId: string) => `state/pages/${sourceId}.json`;

export async function loadJson<T>(sourceId: string): Promise<T | null> {
  const file = bucket().file(statePath(sourceId));
  const [exists] = await file.exists();
  if (!exists) return null;
  try {
    return JSON.parse((await file.download())[0].toString("utf8")) as T;
  } catch {
    return null; // 壊れていれば基準からやり直す（文書は id が重ならないので二重には作らない）
  }
}

export async function saveJson(sourceId: string, state: unknown): Promise<void> {
  await bucket().file(statePath(sourceId)).save(JSON.stringify(state), { contentType: "application/json", resumable: false });
}

const loadState = (sourceId: string): Promise<PageState | null> => loadJson<PageState>(sourceId);

// ── リンク 1 本の処理 ──

export type LinkResult = "done" | "retry";

export interface LinkCtx {
  source: Source;
  deps: WatchDeps;
  allow: (u: URL) => boolean;
}

const isPdf = (contentType: string, body: Buffer): boolean => /pdf/i.test(contentType) || body.subarray(0, 5).toString("latin1") === "%PDF-";

const lastSegment = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url);
  } catch {
    return url;
  }
};

/**
 * 新しいリンクを 1 本取り、文書にする。PDF は無条件に文書（文字層がなければ指紋はバイト列の SHA-256）。
 * HTML は鳥インフルの語（題 + 本文）があるものだけ文書（requireWord:false なら無条件）。リンクの文に語のある HTML は followed に返す。
 * 取得に失敗したら retry（印をつけない）。
 */
export async function processLink(
  link: PageLink,
  ctx: LinkCtx,
  opts: { follow: boolean; requireWord?: boolean },
): Promise<{ result: LinkResult; follow: { url: string; title: string; lines: string[]; links: PageLink[] } | null }> {
  const { source, deps } = ctx;
  const o = await deps.fetch(link.href, { allowUrl: ctx.allow });
  if (o.kind !== "ok") return { result: "retry", follow: null };

  if (isPdf(o.contentType, o.body)) {
    const ex = await extractPdfText(o.body);
    await storeDocument({
      source,
      url: link.href,
      title: link.text || lastSegment(link.href),
      contentType: "pdf",
      body: o.body,
      fingerprint: ex.hasTextLayer ? fingerprint(ex.text) : sha256Hex(o.body),
      textForRead: ex.text,
      hasTextLayer: ex.hasTextLayer,
      prefCode: source.prefCode,
      fetchedAt: o.fetchedAt,
      readState: "pending",
    });
    return { result: "done", follow: null };
  }
  if (!/html|xml|text/i.test(o.contentType) && o.contentType !== "") return { result: "done", follow: null }; // 画像、zip など

  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  if (opts.requireWord === false || hasHpaiWord(`${page.title}\n${page.text}`)) {
    await storeDocument({
      source,
      url: link.href,
      title: page.title || link.text,
      contentType: "html",
      body: o.body,
      fingerprint: fingerprint(page.text),
      textForRead: page.text,
      hasTextLayer: true,
      prefCode: source.prefCode,
      fetchedAt: o.fetchedAt,
      readState: "pending",
    });
  }
  const follow = opts.follow && hasHpaiWord(link.text) ? { url: link.href, title: page.title, lines: bodyLines(page, link.href), links: page.links } : null;
  return { result: "done", follow };
}

/**
 * 差分に使う本文の行。同じサイトのリンクの文だけの行は除く（新しいリンクは別に取るので、リンクの追加がページ自体の文書にならない）。
 * 別のサイトへのリンクの行は残す（取得しないので、行として残さないと更新に気づけない）。
 */
export function bodyLines(page: { text: string; links: readonly PageLink[] }, pageUrl: string): string[] {
  const linked = new Set(page.links.filter((l) => sameSite(l.href, pageUrl)).map((l) => normalizeForMatch(l.text)));
  linked.delete("");
  return pageLines(page.text).filter((line) => !linked.has(normalizeForMatch(line)));
}

const hrefs = (links: readonly PageLink[]): string[] => links.map((l) => l.href);

/**
 * ページの新しいリンクを、上限まで取る。取り込めた（または諦めた）リンクと、規則で選ばれなかったリンクだけを known に足す。
 * 上限を超えたリンクと取れなかったリンクは known に足さない（次回、また新しいリンクとして出る）。
 */
async function scanLinks(
  page: { url: string; titleHasWord: boolean; links: PageLink[] },
  known: string[],
  tries: Record<string, number>,
  ctx: LinkCtx,
  follow: boolean,
): Promise<{ known: string[]; tries: Record<string, number>; follows: Array<{ url: string; title: string; lines: string[]; links: PageLink[] }> }> {
  const candidates = newLinks({ links: page.links, known, pageUrl: page.url, titleHasWord: page.titleHasWord });
  const take = candidates.slice(0, MAX_NEW_LINKS_PER_CHECK);
  const left = new Set(candidates.map((c) => linkKey(c.href)));
  const nextTries: Record<string, number> = {};
  const follows: Array<{ url: string; title: string; lines: string[]; links: PageLink[] }> = [];

  for (const link of take) {
    const key = linkKey(link.href);
    const r = await processLink(link, ctx, { follow });
    if (r.result === "done") {
      left.delete(key);
      if (r.follow !== null) follows.push(r.follow);
      continue;
    }
    const n = (tries[key] ?? 0) + 1;
    if (n >= MAX_LINK_TRIES) {
      left.delete(key); // 諦める
      logger.warn("リンクを取れないまま諦めました", { sourceId: ctx.source.id, url: link.href });
    } else {
      nextTries[key] = n;
    }
  }
  const pending = left; // 上限の外と、取り直すリンク
  const nextKnown = [...new Set([...known, ...hrefs(page.links)])].filter((h) => !pending.has(linkKey(h)));
  return { known: nextKnown, tries: nextTries, follows };
}

// ── 入口 1 つの確認 ──

const sameHostAndPath = (a: string, b: string): boolean => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.pathname === y.pathname;
  } catch {
    return false;
  }
};

/** 追いかける事例のページを確認する。失敗は CheckResult に数えない（次回また確認する）。深さ 1。 */
async function checkFollowed(f: FollowedState, ctx: LinkCtx): Promise<FollowedState> {
  const { source, deps } = ctx;
  const o = await deps.fetch(f.url, { allowUrl: ctx.allow });
  if (o.kind !== "ok") return f;
  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  const lines = bodyLines(page, f.url);
  const titleHasWord = hasHpaiWord(page.title);

  const added = addedLines(f.lines, lines);
  if (added.length > 0 && !isDateOnlyChange(added) && (titleHasWord || hasHpaiWord(added.join("\n")))) {
    const text = added.join("\n");
    await storeDocument({
      source,
      url: f.url,
      title: page.title,
      contentType: "html",
      body: o.body,
      fingerprint: fingerprint(text),
      textForRead: text,
      hasTextLayer: true,
      prefCode: source.prefCode,
      fetchedAt: o.fetchedAt,
      readState: "pending",
    });
  }
  // 追いかけているページは発生に関わるページなので、新しい同じサイトのリンクを全部取る（PDF は無条件、HTML は語のあるものだけ文書）
  const scanned = await scanLinks({ url: f.url, titleHasWord: true, links: page.links }, f.links, f.tries, ctx, false);
  return { ...f, title: page.title, lines, links: scanned.known, tries: scanned.tries };
}

/** 県のページ（pref_fixed、pref_press_list）。取得 → 基準 → 失敗の見分け → 足された行 → 新しいリンク → 追いかけ。 */
export async function checkPrefPage(source: Source, deps: WatchDeps): Promise<CheckResult> {
  const ctx: LinkCtx = { source, deps, allow: allowPrefLink(source.url) };
  const o = await deps.fetch(source.url, { allowUrl: allowPrefEntrance(source.url) });
  if (o.kind === "not_modified") return { ok: true, etag: null, lastModified: null, fingerprint: source.fingerprint };
  if (o.kind !== "ok") return FAILED;

  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  const lines = bodyLines(page, o.finalUrl);
  const titleHasWord = hasHpaiWord(page.title);
  const hasWord = hasHpaiWord(`${page.title}\n${page.text}`);
  const result: CheckResult = { ok: true, etag: null, lastModified: null, fingerprint: fingerprint(page.text) };
  const state = await loadState(source.id);

  // 最初の確認は基準だけ。過去の PDF や事例を Claude に渡さない
  if (state === null) {
    await saveJson(source.id, {
      version: 1,
      finalUrl: o.finalUrl,
      title: page.title,
      titleHasWord,
      hasWord,
      lines,
      links: hrefs(page.links),
      tries: {},
      followed: [],
    } satisfies PageState);
    return result;
  }

  // 200 で中身が別物: 題に語のあった専用のページから語が消えた、または別のホスト、別の経路になった（メンテナンス、ブロック、トップへの転送）。
  // 課のトップ（題に語がない）は平時に語が出ないのが正常なので、語の消失では失敗にしない。基準は壊さない。
  if (state.titleHasWord && !hasWord) return FAILED;
  if (!sameHostAndPath(o.finalUrl, state.finalUrl)) return FAILED;

  // 足された行 → ページ自体を文書に（日付だけの更新と、題に語がなく足された行にも語がないものは作らない。報道発表の一覧は作らない）
  const added = addedLines(state.lines, lines);
  if (source.kind === "pref_fixed" && added.length > 0 && !isDateOnlyChange(added) && (titleHasWord || hasHpaiWord(added.join("\n")))) {
    const text = added.join("\n");
    await storeDocument({
      source,
      url: source.url,
      title: page.title,
      contentType: "html",
      body: o.body,
      fingerprint: fingerprint(text),
      textForRead: text,
      hasTextLayer: true,
      prefCode: source.prefCode,
      fetchedAt: o.fetchedAt,
      readState: "pending",
    });
  }

  // 新しいリンク
  const scanned = await scanLinks({ url: o.finalUrl, titleHasWord, links: page.links }, state.links, state.tries, ctx, true);

  // 追いかけ: 期限内のものを確認し、新しく見つかった事例のページを足す（深さ 1）
  const now = deps.now();
  const alive = state.followed.filter((f) => now.getTime() - Date.parse(f.addedAt) <= FOLLOW_DAYS * 86_400_000);
  const checked: FollowedState[] = [];
  for (const f of alive) checked.push(await checkFollowed(f, ctx));
  for (const found of scanned.follows) {
    if (checked.some((f) => linkKey(f.url) === linkKey(found.url))) continue;
    // 見つけた時点で、そのページ自体のリンクを同じ規則で取る（取った分は次回の「新しいリンク」にならない）
    const sub = await scanLinks({ url: found.url, titleHasWord: true, links: found.links }, [], {}, ctx, false);
    checked.push({ url: found.url, addedAt: toJstIso(now), title: found.title, lines: found.lines, links: sub.known, tries: sub.tries });
  }
  checked.sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));

  await saveJson(source.id, {
    version: 1,
    finalUrl: state.finalUrl, // 入口の場所は最初の確認のまま（移ったら失敗として気づく）
    title: page.title,
    titleHasWord,
    hasWord,
    lines,
    links: scanned.known,
    tries: scanned.tries,
    followed: checked.slice(0, MAX_FOLLOWED),
  } satisfies PageState);
  return result;
}

export const pageHandlers: Handlers = {
  pref_fixed: checkPrefPage,
  pref_press_list: checkPrefPage,
};
