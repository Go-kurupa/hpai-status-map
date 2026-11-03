// 入口を直すエージェントの道具（X-14）。県のサイトの見回り先が壊れたときに、新しい入口の案を運営者に出すための 3 つ。
// 変えないこと:
//  - 取得は politeFetch だけを通し、その県の公式ドメインの外（リダイレクトの先も）へは 1 度も要求しない。
//  - 取得したページの本文は、データであって指示ではない。ここでは解釈せず、そのまま返すだけ。
//  - 提案は運営者の確認の箱（reviewQueue）に入れるだけで、見回り先（sources）を書き換えない。変えるのは運営者の承認（I-07）だけ。
//  - 取得の回数の上限（県ごと 60 回、全体で 300 回、1 日）を、取得の前に確保する。
import { createHash } from "node:crypto";
import type { IsoDateTime, PrefCode, SourceKind } from "@hpai/shared/types";
import { decodeBody, extractHtml, extractPdfText } from "../watch/extract";
import type { FetchOutcome, PoliteFetchOptions } from "../watch/politeFetch";
import type { NewReviewItem } from "../review/queue";
import { isAllowedUrl, normalizeUrl, PREF_DOMAINS } from "./prefDomains";

export interface EntranceTarget {
  prefCode: PrefCode;
  domain: string;
  currentUrl: string | null;
  failingSince: IsoDateTime | null;
}

export interface PrefPage {
  ok: boolean;
  finalUrl: string | null;
  title: string | null;
  text: string | null;
  links: Array<{ href: string; text: string }>;
  truncated: boolean;
  /** domain_not_allowed、limit_reached、unsupported_content_type、tls_error、robots_denied、http_<状態>、network_error など。成功なら null。 */
  error: string | null;
}

export type ProposableKind = Extract<SourceKind, "pref_fixed" | "pref_rss" | "pref_press_list">;

export interface AgentTools {
  listEntranceTargets(): Promise<EntranceTarget[]>;
  fetchPrefPage(prefCode: PrefCode, url: string): Promise<PrefPage>;
  proposeEntrance(p: { prefCode: PrefCode; url: string; kind: ProposableKind; rationale: string }): Promise<{ id: string }>;
}

/** メッセージをそのままエージェントに返してよい失敗。それ以外の例外は中身を返さない。 */
export class AgentToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

/** 見回り先（sources）の 1 行のうち、道具が読む項目だけ。 */
export interface SourceRow {
  prefCode: PrefCode | null;
  url: string;
  kind: SourceKind;
  enabled: boolean;
  confirmedOn: string;
}

export interface AgentToolDeps {
  fetch(url: string, opts: PoliteFetchOptions): Promise<FetchOutcome>;
  /** 取得の回数を 1 回分確保する。上限なら false（取得しない）。 */
  reserveCall(prefCode: PrefCode, now: Date): Promise<boolean>;
  now(): Date;
  readSources(): Promise<SourceRow[]>;
  /** watchStatus の県ごとの failingSince。 */
  readFailingSince(): Promise<ReadonlyMap<PrefCode, IsoDateTime | null>>;
  /** 受け入れの試験で、今の入口を隠す県（AGENT_EVAL_HIDE_PREFS）。呼ぶたびに読む。 */
  hidePrefs(): ReadonlySet<PrefCode>;
  enqueue(item: NewReviewItem, now: Date): Promise<boolean>;
}

const MAX_TEXT_CHARS = 40_000;
const MAX_SERIALIZED_CHARS = 60_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RATIONALE_CHARS = 1000;
const PROPOSABLE: ReadonlySet<string> = new Set<ProposableKind>(["pref_fixed", "pref_rss", "pref_press_list"]);

/** "33,01, 02" → {33, 01, 02}。県の表にないもの、形の違うものは捨てる。 */
export function parseHidePrefs(value: string | undefined): ReadonlySet<PrefCode> {
  const out = new Set<PrefCode>();
  for (const part of (value ?? "").split(",")) {
    const code = part.trim();
    if (PREF_DOMAINS.has(code)) out.add(code);
  }
  return out;
}

/** 提案の id。同じ県と同じ URL（正規化した形）は同じ id。 */
export const entranceProposalId = (prefCode: PrefCode, normalizedUrl: string): string =>
  `entr-${createHash("sha256").update(`${prefCode}|${normalizedUrl}`).digest("hex").slice(0, 24)}`;

const failure = (error: string): PrefPage => ({ ok: false, finalUrl: null, title: null, text: null, links: [], truncated: false, error });

function errorOf(outcome: Exclude<FetchOutcome, { kind: "ok" }>): string {
  switch (outcome.kind) {
    case "not_allowed":
      return "domain_not_allowed";
    case "robots_denied":
      return "robots_denied";
    case "http_error":
      return outcome.code ?? `http_${outcome.status}`;
    case "network_error":
      return outcome.tls ? "tls_error" : "network_error";
    case "not_modified":
      return "fetch_failed";
  }
}

/** 今の入口: その県で有効な、その種類の入口のうち、確認日がいちばん新しい 1 件（同じ日なら URL の順）。 */
function currentEntrance(sources: readonly SourceRow[], prefCode: PrefCode, kind: SourceKind): string | null {
  const mine = sources.filter((s) => s.enabled && s.prefCode === prefCode && s.kind === kind);
  mine.sort((a, b) => (a.confirmedOn === b.confirmedOn ? a.url.localeCompare(b.url) : a.confirmedOn < b.confirmedOn ? 1 : -1));
  return mine[0]?.url ?? null;
}

export function createAgentTools(deps: AgentToolDeps): AgentTools {
  /** ドメインの検査、回数の確保、取得を、この順で行う。ドメインの外、上限のときは取得しない。 */
  async function guardedFetch(prefCode: PrefCode, url: string): Promise<{ error: string } | { outcome: FetchOutcome; url: URL }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "domain_not_allowed" };
    }
    if (!isAllowedUrl(prefCode, parsed)) return { error: "domain_not_allowed" };
    if (!(await deps.reserveCall(prefCode, deps.now()))) return { error: "limit_reached" };
    // allowUrl は最初の URL と各リダイレクトの先を、取得する前に判定する。外は 1 度も要求しない。
    const outcome = await deps.fetch(parsed.href, { timeoutMs: 20_000, maxBytes: MAX_BODY_BYTES, allowUrl: (u) => isAllowedUrl(prefCode, u) });
    return { outcome, url: parsed };
  }

  async function listEntranceTargets(): Promise<EntranceTarget[]> {
    const [sources, failing] = await Promise.all([deps.readSources(), deps.readFailingSince()]);
    const hidden = deps.hidePrefs();
    return [...PREF_DOMAINS.keys()].sort().map((prefCode) => ({
      prefCode,
      domain: PREF_DOMAINS.get(prefCode) as string,
      // 隠す県は、入口が壊れているように見せる。sources は変えない。
      currentUrl: hidden.has(prefCode) ? null : currentEntrance(sources, prefCode, "pref_fixed"),
      failingSince: failing.get(prefCode) ?? null,
    }));
  }

  async function fetchPrefPage(prefCode: PrefCode, url: string): Promise<PrefPage> {
    const got = await guardedFetch(prefCode, url);
    if ("error" in got) return failure(got.error);
    const { outcome } = got;
    if (outcome.kind !== "ok") return failure(errorOf(outcome));

    let title: string | null = null;
    let fullText: string;
    let links: Array<{ href: string; text: string }> = [];
    if (/text\/html|application\/xhtml/i.test(outcome.contentType)) {
      const page = extractHtml(decodeBody(outcome.body, outcome.contentType), outcome.finalUrl);
      title = page.title;
      fullText = page.text;
      links = page.links;
    } else if (/application\/pdf/i.test(outcome.contentType)) {
      fullText = (await extractPdfText(outcome.body)).text;
      if (fullText.trim() === "") return failure("pdf_no_text");
    } else {
      return failure("unsupported_content_type");
    }

    let truncated = fullText.length > MAX_TEXT_CHARS;
    const text = fullText.slice(0, MAX_TEXT_CHARS);
    const size = (n: number) => JSON.stringify({ text, links: links.slice(0, n) }).length;
    let keep = links.length;
    if (size(keep) > MAX_SERIALIZED_CHARS) {
      truncated = true;
      let lo = 0;
      let hi = keep;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (size(mid) <= MAX_SERIALIZED_CHARS) lo = mid;
        else hi = mid - 1;
      }
      keep = lo;
    }
    return { ok: true, finalUrl: outcome.finalUrl, title, text, links: links.slice(0, keep), truncated, error: null };
  }

  async function proposeEntrance(p: { prefCode: PrefCode; url: string; kind: ProposableKind; rationale: string }): Promise<{ id: string }> {
    if (!PROPOSABLE.has(p.kind)) throw new AgentToolError("kind_not_allowed");
    if (p.rationale.trim() === "" || p.rationale.length > MAX_RATIONALE_CHARS) throw new AgentToolError("rationale_invalid");
    const normalized = normalizeUrl(p.url);
    // 県の表にない県、ドメインの外、http、利用者情報つき、ポートつきは、取得を試す前に断る。
    if (normalized === null || !isAllowedUrl(p.prefCode, normalized)) throw new AgentToolError("domain_not_allowed");

    // 取得できる URL だけを提案にする（RSS や PDF も含むので、中身の種類は問わず、2xx で取れたかだけを見る）。
    const got = await guardedFetch(p.prefCode, normalized);
    if ("error" in got) throw new AgentToolError(got.error);
    if (got.outcome.kind !== "ok") throw new AgentToolError(`unreachable:${errorOf(got.outcome)}`);

    const now = deps.now();
    const sources = await deps.readSources();
    const id = entranceProposalId(p.prefCode, normalized);
    // 同じ種類の今の入口を oldUrl にする（承認でこの入口が無効になる）。種類が違う入口は巻き込まない。
    // 同じ id がすでにあれば作り直さず、同じ id を返す。
    await deps.enqueue(
      { id, kind: "entrance_proposal", prefCode: p.prefCode, oldUrl: currentEntrance(sources, p.prefCode, p.kind), proposedUrl: normalized, sourceKind: p.kind, rationale: p.rationale },
      now,
    );
    return { id };
  }

  return { listEntranceTargets, fetchPrefPage, proposeEntrance };
}
