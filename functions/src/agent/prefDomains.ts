// 県と公式ドメインの束縛（X-14）。入口の一覧 data/sources.json から作る。エージェントの道具が取りに行ける先は、ここで決まる。
// 県ごとに 1 つのドメイン（例: 33 → pref.okayama.jp）。そのドメインそのもの、またはその下のホスト（www、web、www.sangyo-rodo など）だけを許す。
import { isPrefDomainHost } from "@hpai/shared/pref";
import type { PrefCode, SourceSeed } from "@hpai/shared/types";
import rawSeeds from "../../../data/sources.json";

/** 入口のホストの末尾に当てる。当たらないときは入口の一覧（F-09）が県の公式でないので、差し戻す。 */
const DOMAIN_TAIL = /(pref\.[a-z]+(\.lg)?\.jp|metro\.tokyo\.lg\.jp)$/;

/**
 * 県ごとの公式ドメインを入口の一覧から作る。県の入口（prefCode がある行）のホストの末尾に DOMAIN_TAIL を当てた値。
 * 当たらない、同じ県で別のドメインが混ざる、別の県が同じドメインを名乗る、shared の県の公式ドメインの表にない、のどれかなら例外（黙って通さない）。
 */
export function buildPrefDomains(seeds: readonly Pick<SourceSeed, "prefCode" | "url">[]): ReadonlyMap<PrefCode, string> {
  const out = new Map<PrefCode, string>();
  for (const seed of seeds) {
    if (seed.prefCode === null) continue;
    let host: string;
    try {
      host = new URL(seed.url).hostname.toLowerCase();
    } catch {
      throw new Error(`県 ${seed.prefCode} の入口の URL を読めません。入口の一覧（F-09）へ差し戻してください`);
    }
    const domain = DOMAIN_TAIL.exec(host)?.[1];
    // 先頭は「.」で区切るか、ホストそのもの（evilpref.… を通さない）
    if (domain === undefined || !(host === domain || host.endsWith(`.${domain}`))) {
      throw new Error(`県 ${seed.prefCode} の入口のホスト ${host} が県の公式ドメインの形ではありません。入口の一覧（F-09）へ差し戻してください`);
    }
    if (!isPrefDomainHost(domain)) {
      throw new Error(`県 ${seed.prefCode} のドメイン ${domain} は県の公式ドメインの表にありません。入口の一覧（F-09）へ差し戻してください`);
    }
    const known = out.get(seed.prefCode);
    if (known !== undefined && known !== domain) {
      throw new Error(`県 ${seed.prefCode} の入口に別のドメインが混ざっています（${known}、${domain}）`);
    }
    out.set(seed.prefCode, domain);
  }
  const seen = new Map<string, PrefCode>();
  for (const [code, domain] of out) {
    const other = seen.get(domain);
    if (other !== undefined) throw new Error(`県 ${other} と ${code} が同じドメイン ${domain} になっています`);
    seen.set(domain, code);
  }
  return out;
}

/** 同梱の入口の一覧から作った 47 県の表。読み込み時に検査され、壊れていれば関数が起動しない。 */
export const PREF_DOMAINS: ReadonlyMap<PrefCode, string> = buildPrefDomains(rawSeeds as readonly SourceSeed[]);

/**
 * その県の公式ドメインの中の URL か。https、利用者情報なし、既定のポート、ホストがドメインそのものかその下。
 * 文字列でも URL でも受ける。読めない URL、県の表にない県は false。リダイレクトの先の判定（politeFetch の allowUrl）にも使う。
 */
export function isAllowedUrl(prefCode: PrefCode, url: string | URL): boolean {
  const domain = PREF_DOMAINS.get(prefCode);
  if (domain === undefined) return false;
  let u: URL;
  try {
    u = typeof url === "string" ? new URL(url) : url;
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return false;
  const host = u.hostname.toLowerCase();
  return (host === domain || host.endsWith(`.${domain}`)) && isPrefDomainHost(host);
}

/** 重複や揺れのない形（フラグメントを除く）。提案の id と保存する URL の元にする。読めなければ null。 */
export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
