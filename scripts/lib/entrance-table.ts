// 入口の点検（§13）。47 都道府県の見回り先を 1 件ずつ取り、結果を表にする。
// 取得は注入された取得器（politeFetch）だけを通す。ここでは fetch を直接呼ばない。
import { toJstIso } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { hasHpaiWord } from "@hpai/shared/text";
import type { IsoDateTime, PrefCode, SourceKind, SourceSeed } from "@hpai/shared/types";
import { decodeBody, extractHtml } from "../../functions/src/watch/extract";
import { isTlsCode, type FetchOutcome, type PoliteFetchOptions } from "../../functions/src/watch/politeFetch";

export interface EntranceCheckRow {
  prefCode: PrefCode;
  prefName: string;
  url: string;
  kind: SourceKind;
  outcome: FetchOutcome["kind"];
  /** network_error は最も深い code（TLS は握手の code）。http_error は robots.txt の失敗のときだけ code が入る。 */
  errorCode: string | null;
  status: number | null;
  title: string | null;
  hasHpaiWord: boolean | null;
  checkedAt: IsoDateTime;
}

// ── 取得 ──

export interface CheckDeps {
  fetcher: (url: string, opts?: PoliteFetchOptions) => Promise<FetchOutcome>;
  /** network_error で TLS と分からないときだけ 1 回呼ぶ。fetch は TLS の失敗を隠すため。 */
  handshake: (url: string) => Promise<{ code: string | null; tls: boolean }>;
  now: () => Date;
}

/**
 * 県の公式のドメイン（47）。この名前そのものか、その下のホスト（www、web、www.sangyo-rodo など）だけを許す。
 * 「pref.<名>.jp」の形だけでは他人の取ったドメイン（pref.attacker.jp）も通るので、名前を固定する。
 * 先頭は必ず「.」で区切る（evilpref.… は通さない）。取得の関門（functions/src/probe/run.ts の isProbeHostAllowed）より狭い。
 */
const PREF_DOMAINS: ReadonlySet<string> = new Set([
  "metro.tokyo.lg.jp", "pref.aichi.jp", "pref.akita.lg.jp", "pref.aomori.lg.jp", "pref.chiba.lg.jp", "pref.ehime.jp",
  "pref.fukui.lg.jp", "pref.fukuoka.lg.jp", "pref.fukushima.lg.jp", "pref.gifu.lg.jp", "pref.gunma.jp", "pref.hiroshima.lg.jp",
  "pref.hokkaido.lg.jp", "pref.hyogo.lg.jp", "pref.ibaraki.jp", "pref.ishikawa.lg.jp", "pref.iwate.jp", "pref.kagawa.lg.jp",
  "pref.kagoshima.jp", "pref.kanagawa.jp", "pref.kochi.lg.jp", "pref.kumamoto.jp", "pref.kyoto.jp", "pref.mie.lg.jp",
  "pref.miyagi.jp", "pref.miyazaki.lg.jp", "pref.nagano.lg.jp", "pref.nagasaki.jp", "pref.nara.lg.jp", "pref.niigata.lg.jp",
  "pref.oita.jp", "pref.okayama.jp", "pref.okinawa.lg.jp", "pref.osaka.lg.jp", "pref.saga.lg.jp", "pref.saitama.lg.jp",
  "pref.shiga.lg.jp", "pref.shimane.lg.jp", "pref.shizuoka.jp", "pref.tochigi.lg.jp", "pref.tokushima.lg.jp", "pref.tottori.lg.jp",
  "pref.toyama.jp", "pref.wakayama.lg.jp", "pref.yamagata.jp", "pref.yamaguchi.lg.jp", "pref.yamanashi.jp",
]);

/** 県のホストだけを許す。ポートは空・80・443 に限る（内部のポートへ向けさせない）。リダイレクトの先もこれを通る。 */
export function isPrefHost(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  for (let i = 0; i < labels.length; i++) {
    if (PREF_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** 本文から題名と語の有無を読む。HTML と XML（RSS）だけ。PDF などは null。 */
function readBody(outcome: Extract<FetchOutcome, { kind: "ok" }>): { title: string | null; hasWord: boolean | null } {
  const type = outcome.contentType.toLowerCase();
  const text = decodeBody(outcome.body, outcome.contentType);
  if (type.includes("html")) {
    const page = extractHtml(text, outcome.finalUrl);
    return { title: page.title === "" ? null : page.title, hasWord: hasHpaiWord(`${page.title} ${page.text}`) };
  }
  if (/xml|rss|rdf/.test(type)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
    const clean = title === undefined ? "" : collapse(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    return { title: clean === "" ? null : clean, hasWord: hasHpaiWord(text) };
  }
  return { title: null, hasWord: null };
}

/** 県の行（prefCode がある行）を順に 1 件ずつ取る。1 件の失敗で止めない。 */
export async function checkEntrances(seeds: readonly SourceSeed[], deps: CheckDeps): Promise<EntranceCheckRow[]> {
  const rows: EntranceCheckRow[] = [];
  for (const seed of seeds) {
    if (seed.prefCode === null) continue;
    const prefName = PREFS.find((p) => p.code === seed.prefCode)?.name ?? seed.prefCode;

    let outcome: FetchOutcome;
    try {
      outcome = await deps.fetcher(seed.url, { allowUrl: isPrefHost });
    } catch (e) {
      outcome = { kind: "network_error", message: e instanceof Error ? e.message : String(e), code: null, tls: false };
    }

    let errorCode: string | null = null;
    let status: number | null = null;
    let title: string | null = null;
    let word: boolean | null = null;
    switch (outcome.kind) {
      case "ok": {
        status = outcome.status;
        const body = readBody(outcome);
        title = body.title;
        word = body.hasWord;
        break;
      }
      case "http_error":
        status = outcome.status;
        errorCode = outcome.code ?? null;
        break;
      case "network_error": {
        errorCode = outcome.code;
        if (!outcome.tls) {
          const hs = await deps.handshake(seed.url).catch(() => ({ code: null, tls: false }));
          if (hs.tls) errorCode = hs.code;
        }
        break;
      }
      default:
        break;
    }
    rows.push({
      prefCode: seed.prefCode,
      prefName,
      url: seed.url,
      kind: seed.kind,
      outcome: outcome.kind,
      errorCode,
      status,
      title,
      hasHpaiWord: word,
      checkedAt: toJstIso(deps.now()),
    });
  }
  return rows;
}

// ── 表 ──

/** 確認できた県: その県の入口がすべて ok の県（WatchStatus の ok と同じ）。入口のない県は数えない。 */
export function countConfirmedPrefs(rows: readonly EntranceCheckRow[]): number {
  return PREFS.filter((p) => {
    const mine = rows.filter((r) => r.prefCode === p.code);
    return mine.length > 0 && mine.every((r) => r.outcome === "ok");
  }).length;
}

const TITLE_MAX = 40;
const cell = (s: string | null) => {
  if (s === null || s === "") return "-";
  return s.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
};
const shorten = (s: string | null) => {
  if (s === null) return null;
  const one = collapse(s);
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX)}…` : one;
};

function resultText(r: EntranceCheckRow): string {
  switch (r.outcome) {
    case "ok":
      return "確認できました";
    case "http_error":
      return r.errorCode === "robots_unavailable" ? "確認できません（robots.txt を読めません）" : `確認できません（HTTP ${r.status ?? "?"}）`;
    case "network_error":
      if (r.errorCode !== null && isTlsCode(r.errorCode)) return `確認できません（古い TLS で握手に失敗: ${r.errorCode}）`;
      return r.errorCode !== null ? `確認できません（接続できません: ${r.errorCode}）` : "確認できません（接続できません）";
    case "robots_denied":
      return "確認できません（robots.txt が禁止）";
    case "not_allowed":
      return "確認できません（許可していないホスト）";
    case "not_modified":
      return "確認できません（想定外の応答）";
  }
}

/** 47 都道府県の行を出す。入口がない県は「入口なし」。列は 県、URL、種類、結果、題名、語の有無、時刻 だけ。 */
export function formatEntranceTable(rows: readonly EntranceCheckRow[]): string {
  const lines = [
    `# 入口の点検 確認できた県 ${countConfirmedPrefs(rows)} / ${PREFS.length}`,
    "",
    "確認できた県は、その県の入口がすべて確認できた県です。",
    "",
    "| 県 | URL | 種類 | 結果 | 題名 | 語の有無 | 時刻 |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const p of PREFS) {
    const mine = rows.filter((r) => r.prefCode === p.code);
    if (mine.length === 0) {
      lines.push(`| ${p.name} | - | - | 入口なし | - | - | - |`);
      continue;
    }
    for (const r of mine) {
      const word = r.hasHpaiWord === null ? null : r.hasHpaiWord ? "あり" : "なし";
      lines.push(
        `| ${[p.name, r.url, r.kind, resultText(r), shorten(r.title), word, r.checkedAt].map((c) => cell(c)).join(" | ")} |`,
      );
    }
  }
  lines.push(
    "",
    "取得できることと、県の発生を見分けられることは別です。福岡と福井は、取得できても県の発生を見分けられる根拠がなく、国の発表で補います。",
    "",
  );
  return lines.join("\n");
}
