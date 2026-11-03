// 環境省の見回り（I-12、設計書 §9.2 野鳥）。野鳥の鳥インフルの陽性の一覧（今季の PDF）と、野鳥の発生状況の報道発表を文書にして読み取り（I-05）に回す。
// 野鳥の陽性は、この文書の読み取りで wildBirds になる（ここでは読まない）。Claude は使わない。
// 今季の PDF は確認のたびに取り、指紋が変われば新しい文書になる（同じなら増えない）。報道発表は state の hrefs にないものだけ取る。
import { logger } from "firebase-functions";
import { toJstIso } from "@hpai/shared/dates";
import { linkKey } from "@hpai/shared/read/pageDiff";
import { currentSeason } from "@hpai/shared/season";
import { hasHpaiWord, normalizeForMatch } from "@hpai/shared/text";
import type { IsoDateTime, Season, Source } from "@hpai/shared/types";
import { FAILED, type CheckResult, type Handlers, type WatchDeps } from "./deps";
import { decodeBody, extractHtml, extractPdfText, fingerprint, sha256Hex } from "./extract";
import { MAX_LINK_TRIES, MAX_NEW_LINKS_PER_CHECK, giveUpLink, loadJson, saveJson, type LinkCtx } from "./page";
import { storeDocument } from "./store";

const MOE_HOST = "www.env.go.jp";
/** 環境省の入口は www.env.go.jp の https だけ。リダイレクトも含めてこの外へは出ない。 */
export const allowMoe = (u: URL): boolean => u.protocol === "https:" && u.hostname === MOE_HOST;

export interface MoeLink {
  href: string;
  text: string;
  type: "season_pdf" | "press";
}

const SEASON_TITLE = "年シーズンの野鳥における鳥インフルエンザ発生状況";
const PRESS_TITLE = "野鳥における高病原性鳥インフルエンザ発生状況について";

const isPdfHref = (href: string): boolean => {
  try {
    return new URL(href).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(href);
  }
};

/**
 * 入口のリンクから、今季の PDF（season_pdf）と野鳥の発生状況の報道発表（press）を選ぶ。リンクの文を正規化して判定し、URL には頼らない。
 * season_pdf は PDF で、題に「（{season}）年シーズンの野鳥における鳥インフルエンザ発生状況」がある。前の季や、サーベイランスの結果、対応レベルの引き上げなどは選ばない。
 */
export function selectMoeLinks(links: ReadonlyArray<{ href: string; text: string }>, season: Season): MoeLink[] {
  const seasonWord = normalizeForMatch(`(${season})${SEASON_TITLE}`);
  const pressWord = normalizeForMatch(PRESS_TITLE);
  const out: MoeLink[] = [];
  for (const l of links) {
    const text = normalizeForMatch(l.text);
    if (isPdfHref(l.href) && text.includes(seasonWord)) out.push({ ...l, type: "season_pdf" });
    else if (text.includes(pressWord)) out.push({ ...l, type: "press" });
  }
  return out;
}

/** state/pages/{sourceId}.json。取り込み済みの報道発表（取れずに諦めたものを含む）と、取れなかった回数。 */
export interface MoeState {
  version: 1;
  hrefs: string[];
  tries: Record<string, number>;
  /** 今季の PDF を最後に取れたときの基準。同じ季でこれがあるのに入口から見つからなくなったら失敗にする（題の形が変わった、リンクが移った）。 */
  seasonPdf: { season: Season; href: string; seenAt: IsoDateTime } | null;
}

const isPdfBody = (body: Buffer): boolean => body.subarray(0, 5).toString("latin1") === "%PDF-";

const sameHostAndPath = (a: string, b: string): boolean => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.pathname === y.pathname;
  } catch {
    return false;
  }
};

type Fetched = Extract<Awaited<ReturnType<WatchDeps["fetch"]>>, { kind: "ok" }>;

/** PDF を文書にする。文字層のない PDF は指紋がバイト列の SHA-256。指紋を返す。 */
async function storePdf(o: Fetched, link: MoeLink, ctx: LinkCtx): Promise<string> {
  const ex = await extractPdfText(o.body);
  const fp = ex.hasTextLayer ? fingerprint(ex.text) : sha256Hex(o.body);
  await storeDocument({
    source: ctx.source,
    url: link.href,
    title: link.text,
    contentType: "pdf",
    body: o.body,
    fingerprint: fp,
    textForRead: ex.text,
    hasTextLayer: ex.hasTextLayer,
    prefCode: ctx.source.prefCode,
    fetchedAt: o.fetchedAt,
    readState: "pending",
  });
  return fp;
}

/** 今季の PDF を取って文書にする。PDF でないもの（メンテナンスの HTML など）は文書にせず失敗。 */
async function processSeasonPdf(link: MoeLink, ctx: LinkCtx): Promise<{ ok: true; fingerprint: string } | { ok: false }> {
  // 上限は既定（8 MiB）。今の PDF は約 100 KB。超えたら失敗として見える
  const o = await ctx.deps.fetch(link.href, { allowUrl: ctx.allow });
  if (o.kind !== "ok" || !isPdfBody(o.body)) return { ok: false };
  return { ok: true, fingerprint: await storePdf(o, link, ctx) };
}

/**
 * 報道発表を 1 本取って文書にする。PDF はそのまま、HTML は別の経路へ転送されておらず、鳥インフルの語（題 + 本文）があるものだけ。
 * 200 でも別物（トップへの転送、メンテナンス）は文書にも done にもしない（retry）。
 */
async function processPress(link: MoeLink, ctx: LinkCtx): Promise<"done" | "retry"> {
  const o = await ctx.deps.fetch(link.href, { allowUrl: ctx.allow });
  if (o.kind !== "ok") return "retry";
  if (isPdfBody(o.body)) {
    await storePdf(o, link, ctx);
    return "done";
  }
  if (!/html|xml|text/i.test(o.contentType) || !sameHostAndPath(o.finalUrl, link.href)) return "retry";
  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  if (!hasHpaiWord(`${page.title}\n${page.text}`)) return "retry";
  await storeDocument({
    source: ctx.source,
    url: link.href,
    title: page.title || link.text,
    contentType: "html",
    body: o.body,
    fingerprint: fingerprint(page.text),
    textForRead: page.text,
    hasTextLayer: true,
    prefCode: ctx.source.prefCode,
    fetchedAt: o.fetchedAt,
    readState: "pending",
  });
  return "done";
}

/**
 * 環境省の入口。取得 → 別物の見分け → 今季の PDF（毎回取る）→ 新しい報道発表。
 * 取れないもの、PDF でないもの、別のページへ転送された入口は失敗にして、何もないとは見せない（今季の PDF が入口にまだないのは失敗ではない）。
 * 入口には etag も lastModified も送らない（今季の PDF は毎回取るので、入口の変化を待たない）。
 */
export async function checkMoe(source: Source, deps: WatchDeps): Promise<CheckResult> {
  const o = await deps.fetch(source.url, { allowUrl: allowMoe });
  if (o.kind !== "ok") return FAILED;

  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  // 200 でも、別のページへ転送された、鳥インフルの語が本文にない（メンテナンスなど）ときは失敗にする
  if (!sameHostAndPath(o.finalUrl, source.url) || !hasHpaiWord(`${page.title}\n${page.text}`)) return FAILED;

  const ctx: LinkCtx = { source, deps, allow: allowMoe };
  const season = currentSeason(deps.now());
  const selected = selectMoeLinks(page.links, season);
  const saved = await loadJson<Partial<MoeState>>(source.id);
  const state: MoeState = { version: 1, hrefs: saved?.hrefs ?? [], tries: saved?.tries ?? {}, seasonPdf: saved?.seasonPdf ?? null }; // seasonPdf のない古い状態も読む
  let failed = false;
  let fp: string | null = null;
  let seasonPdf = state.seasonPdf;

  const seasonPdfs = selected.filter((l) => l.type === "season_pdf");
  if (seasonPdfs.length === 0) {
    // 今季の PDF が入口に見えない間は、見回れているとは言えない（未確認）。ok にすると、題の形が変わっても何もないように見える
    failed = true;
    logger.warn(
      state.seasonPdf?.season === season
        ? "環境省の入口から、見えていた今季の PDF が見つからなくなりました（題の形かリンクが変わった可能性）"
        : "環境省の入口に今季の PDF がまだ見つかりません（季の初めか、題の形が変わった可能性）。未確認として扱います",
      { sourceId: source.id, season, lastSeen: state.seasonPdf },
    );
  }
  for (const link of seasonPdfs) {
    const r = await processSeasonPdf(link, ctx);
    if (r.ok) {
      if (fp === null) {
        fp = r.fingerprint;
        seasonPdf = { season, href: link.href, seenAt: toJstIso(deps.now()) };
      }
    } else {
      failed = true;
    }
  }

  const known = new Set(state.hrefs.map(linkKey));
  const candidates = selected.filter((l) => l.type === "press" && !known.has(linkKey(l.href)));
  const hrefs = [...state.hrefs];
  const tries: Record<string, number> = {};
  for (const link of candidates.slice(0, MAX_NEW_LINKS_PER_CHECK)) {
    const key = linkKey(link.href);
    if ((await processPress(link, ctx)) === "done") {
      hrefs.push(link.href);
      continue;
    }
    failed = true;
    const n = (state.tries[key] ?? 0) + 1;
    if (n >= MAX_LINK_TRIES) {
      // 諦める前に、題と URL だけの文書を残して運営者の箱に入れる（黙って捨てない。県のページと同じ形）。箱に入れられなければ throw し、印はつけず次回また試す
      await giveUpLink(ctx, link, "retry_exhausted");
      hrefs.push(link.href); // 諦める（恒久的に取れないリンクを毎回取りに行かない）
    } else {
      tries[key] = n;
    }
  }
  await saveJson(source.id, { version: 1, hrefs, tries, seasonPdf } satisfies MoeState);

  if (failed) return FAILED;
  return { ok: true, etag: null, lastModified: null, fingerprint: fp ?? fingerprint(page.text) };
}

export const moeHandlers: Handlers = { moe: checkMoe };
