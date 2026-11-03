// 県と公式ドメインの束縛（X-14）。入口の一覧 data/sources.json から作る。エージェントの道具が取りに行ける先は、ここで決まる。
// 県ごとに 1 つのドメイン（例: 33 → pref.okayama.jp）。そのドメインそのもの、またはその下のホスト（www、web、www.sangyo-rodo など）だけを許す。
import { logger } from "firebase-functions";
import { isPrefDomainHost } from "@hpai/shared/pref";
import type { PrefCode, SourceSeed } from "@hpai/shared/types";
import rawSeeds from "../../../data/sources.json";

/** 入口のホストの末尾に当てる。当たらないときは入口の一覧（F-09）が県の公式でないので、差し戻す。 */
const DOMAIN_TAIL = /(pref\.[a-z]+(\.lg)?\.jp|metro\.tokyo\.lg\.jp)$/;

interface Problem {
  prefCode: PrefCode | null;
  message: string;
}

/** 入口の一覧を調べる。使える県の表と、問題（どの県のどの行がだめか）を返す。問題のある県は表に入れない。例外は投げない。 */
function analyze(seeds: readonly Pick<SourceSeed, "prefCode" | "url">[]): { domains: Map<PrefCode, string>; problems: Problem[] } {
  const found = new Map<PrefCode, string>();
  const problems: Problem[] = [];
  const bad = new Set<PrefCode>();
  const fail = (prefCode: PrefCode, message: string) => {
    bad.add(prefCode);
    problems.push({ prefCode, message });
  };

  for (const seed of seeds) {
    if (seed === null || typeof seed !== "object") {
      problems.push({ prefCode: null, message: "入口の一覧に、行の形でないものがあります" });
      continue;
    }
    if (seed.prefCode === null) continue;
    if (typeof seed.prefCode !== "string") {
      problems.push({ prefCode: null, message: "入口の一覧に、県のコードが文字列でない行があります" });
      continue;
    }
    const code = seed.prefCode;
    let host: string;
    try {
      host = new URL(seed.url).hostname.toLowerCase();
    } catch {
      fail(code, `県 ${code} の入口の URL を読めません。入口の一覧（F-09）へ差し戻してください`);
      continue;
    }
    const domain = DOMAIN_TAIL.exec(host)?.[1];
    // 先頭は「.」で区切るか、ホストそのもの（evilpref.… を通さない）
    if (domain === undefined || !(host === domain || host.endsWith(`.${domain}`))) {
      fail(code, `県 ${code} の入口のホスト ${host} が県の公式ドメインの形ではありません。入口の一覧（F-09）へ差し戻してください`);
      continue;
    }
    if (!isPrefDomainHost(domain)) {
      fail(code, `県 ${code} のドメイン ${domain} は県の公式ドメインの表にありません。入口の一覧（F-09）へ差し戻してください`);
      continue;
    }
    const known = found.get(code);
    if (known !== undefined && known !== domain) {
      fail(code, `県 ${code} の入口に別のドメインが混ざっています（${known}、${domain}）`);
      continue;
    }
    found.set(code, domain);
  }

  const byDomain = new Map<string, PrefCode[]>();
  for (const [code, domain] of found) byDomain.set(domain, [...(byDomain.get(domain) ?? []), code]);
  for (const [domain, codes] of byDomain) {
    if (codes.length > 1) for (const c of codes) fail(c, `県 ${codes.join("、")} が同じドメイン ${domain} になっています`);
  }

  const domains = new Map([...found].filter(([code]) => !bad.has(code)));
  return { domains, problems };
}

/**
 * 県ごとの公式ドメインを入口の一覧から作る（厳密版。試験と CI の差し戻し用）。
 * 当たらない、同じ県で別のドメインが混ざる、別の県が同じドメインを名乗る、shared の県の公式ドメインの表にない、のどれかなら例外。
 */
export function buildPrefDomains(seeds: readonly Pick<SourceSeed, "prefCode" | "url">[]): ReadonlyMap<PrefCode, string> {
  const { domains, problems } = analyze(seeds);
  if (problems.length > 0) throw new Error(problems[0]?.message);
  return domains;
}

/**
 * 実行時の版。例外を投げず、問題のある県を表から外す（外した県は isAllowedUrl が常に false ＝取得も提案もできない。安全側に閉じる）。
 * 1 行の誤りで、全関数を 1 つにまとめた bundle のほかの関数（watchTick など）の起動を止めないため。差し戻しは試験（47 県すべてある）が行う。
 */
export function buildPrefDomainsLenient(seeds: readonly Pick<SourceSeed, "prefCode" | "url">[]): {
  domains: ReadonlyMap<PrefCode, string>;
  excluded: Array<{ prefCode: PrefCode | null; message: string }>;
} {
  const { domains, problems } = analyze(seeds);
  return { domains, excluded: problems };
}

function loadPrefDomains(): ReadonlyMap<PrefCode, string> {
  if (!Array.isArray(rawSeeds)) {
    logger.error("data/sources.json が配列ではありません。エージェントは県のページを取得できません");
    return new Map();
  }
  const { domains, excluded } = buildPrefDomainsLenient(rawSeeds as readonly SourceSeed[]);
  for (const e of excluded) logger.error("sources.json の行を除きました。その県はエージェントの取得も提案もできません", { prefCode: e.prefCode, message: e.message });
  return domains;
}

/** 同梱の入口の一覧から作った県の表。47 県そろうことは試験が確かめる。 */
export const PREF_DOMAINS: ReadonlyMap<PrefCode, string> = loadPrefDomains();

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
