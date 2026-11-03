// 入口を直すエージェントの道具（仮。X-14 が本物に置き換える。署名は X-14 の Interfaces に合わせてある）。
// 仮の範囲: 対象は固定の 3 県、提案は id を返すだけで何も書かない、手数の上限はまだ無い（1 セッション 1 ドルの上限が止める）。
// 変えないこと: 取得は politeFetch だけを通し、県のドメインの外へは 1 度も要求しない（リダイレクトの先も取得の前に判定する）。
import { createHash } from "node:crypto";
import { decodeBody, extractHtml } from "../watch/extract";
import { politeFetch } from "../watch/politeFetch";
import type { IsoDateTime, PrefCode, SourceKind } from "@hpai/shared/types";

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
  /** domain_not_allowed、unsupported_content_type、tls_error、robots_denied、http_<状態>、network_error など。成功なら null。 */
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

// 仮の対象（X-14 の受け入れの 3 県と同じ。入口の一覧 data/sources.json のホスト）。currentUrl は null＝直す対象。
const TEMP_TARGETS: readonly EntranceTarget[] = [
  { prefCode: "33", domain: "www.pref.okayama.jp", currentUrl: null, failingSince: null },
  { prefCode: "01", domain: "www.pref.hokkaido.lg.jp", currentUrl: null, failingSince: null },
  { prefCode: "02", domain: "www.pref.aomori.lg.jp", currentUrl: null, failingSince: null },
];

const MAX_TEXT_CHARS = 40_000;
const MAX_SERIALIZED_CHARS = 60_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** https、利用者情報なし、既定のポート、その県のドメインとの完全一致。 */
function isAllowedUrl(prefCode: PrefCode, url: URL): boolean {
  const target = TEMP_TARGETS.find((t) => t.prefCode === prefCode);
  return (
    target !== undefined &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hostname === target.domain
  );
}

const failure = (error: string): PrefPage => ({ ok: false, finalUrl: null, title: null, text: null, links: [], truncated: false, error });

async function listEntranceTargets(): Promise<EntranceTarget[]> {
  return TEMP_TARGETS.map((t) => ({ ...t }));
}

async function fetchPrefPage(prefCode: PrefCode, url: string): Promise<PrefPage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failure("domain_not_allowed");
  }
  if (!isAllowedUrl(prefCode, parsed)) return failure("domain_not_allowed");

  const outcome = await politeFetch(parsed.href, {
    timeoutMs: 20_000,
    maxBytes: MAX_BODY_BYTES,
    allowUrl: (u) => isAllowedUrl(prefCode, u),
  });

  switch (outcome.kind) {
    case "ok": {
      if (!/text\/html|application\/xhtml/i.test(outcome.contentType)) return failure("unsupported_content_type");
      const page = extractHtml(decodeBody(outcome.body, outcome.contentType), outcome.finalUrl);
      let truncated = page.text.length > MAX_TEXT_CHARS;
      const text = page.text.slice(0, MAX_TEXT_CHARS);
      const size = (n: number) => JSON.stringify({ text, links: page.links.slice(0, n) }).length;
      let keep = page.links.length;
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
      return { ok: true, finalUrl: outcome.finalUrl, title: page.title, text, links: page.links.slice(0, keep), truncated, error: null };
    }
    case "not_allowed":
      return failure("domain_not_allowed");
    case "robots_denied":
      return failure("robots_denied");
    case "http_error":
      return failure(outcome.code ?? `http_${outcome.status}`);
    case "network_error":
      return failure(outcome.tls ? "tls_error" : "network_error");
    case "not_modified":
      return failure("fetch_failed");
  }
}

async function proposeEntrance(p: { prefCode: PrefCode; url: string; kind: ProposableKind; rationale: string }): Promise<{ id: string }> {
  // 仮: 何も書かない。id は県と URL から決まる（同じ提案は同じ id）。
  return { id: `entr-${createHash("sha256").update(`${p.prefCode}|${p.url}`).digest("hex").slice(0, 24)}` };
}

export const agentTools: AgentTools = { listEntranceTargets, fetchPrefPage, proposeEntrance };
