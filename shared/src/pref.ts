import { normalizeForMatch } from "./text";
import type { PrefCode } from "./types";

const NAMES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export const PREFS: ReadonlyArray<{ code: PrefCode; name: string }> = NAMES.map((name, i) => ({
  code: String(i + 1).padStart(2, "0"),
  name,
}));

// 正式名と、末尾の 都・府・県 を取った短い名前（北海道は正式名だけ）の完全一致だけを受ける
const CODE_BY_NAME: ReadonlyMap<string, PrefCode> = new Map(
  PREFS.flatMap(({ code, name }) => {
    const entries: Array<[string, PrefCode]> = [[name, code]];
    if (name !== "北海道") entries.push([name.slice(0, -1), code]);
    return entries;
  }),
);

/** "岡山県" も "岡山" も "33"。見つからなければ null（"東北" など）。 */
export function prefCodeOfName(name: string): PrefCode | null {
  return CODE_BY_NAME.get(normalizeForMatch(name)) ?? null;
}

/**
 * 県の公式のドメイン（47）。この名前そのものか、その下のホスト（www、web、www.sangyo-rodo など）だけを許す。
 * 「pref.<名>.jp」の形だけでは他人の取ったドメイン（pref.attacker.jp）も通るので、名前を固定する。
 * 先頭は必ず「.」で区切る（evilpref.… は通さない）。取得の関門（functions/src/probe/run.ts の isProbeHostAllowed）と入口の点検（scripts/lib/entrance-table.ts の isPrefHost）が共有する。
 */
export const PREF_DOMAINS: ReadonlySet<string> = new Set([
  "metro.tokyo.lg.jp", "pref.aichi.jp", "pref.akita.lg.jp", "pref.aomori.lg.jp", "pref.chiba.lg.jp", "pref.ehime.jp",
  "pref.fukui.lg.jp", "pref.fukuoka.lg.jp", "pref.fukushima.lg.jp", "pref.gifu.lg.jp", "pref.gunma.jp", "pref.hiroshima.lg.jp",
  "pref.hokkaido.lg.jp", "pref.hyogo.lg.jp", "pref.ibaraki.jp", "pref.ishikawa.lg.jp", "pref.iwate.jp", "pref.kagawa.lg.jp",
  "pref.kagoshima.jp", "pref.kanagawa.jp", "pref.kochi.lg.jp", "pref.kumamoto.jp", "pref.kyoto.jp", "pref.mie.lg.jp",
  "pref.miyagi.jp", "pref.miyazaki.lg.jp", "pref.nagano.lg.jp", "pref.nagasaki.jp", "pref.nara.lg.jp", "pref.niigata.lg.jp",
  "pref.oita.jp", "pref.okayama.jp", "pref.okinawa.lg.jp", "pref.osaka.lg.jp", "pref.saga.lg.jp", "pref.saitama.lg.jp",
  "pref.shiga.lg.jp", "pref.shimane.lg.jp", "pref.shizuoka.jp", "pref.tochigi.lg.jp", "pref.tokushima.lg.jp", "pref.tottori.lg.jp",
  "pref.toyama.jp", "pref.wakayama.lg.jp", "pref.yamagata.jp", "pref.yamaguchi.lg.jp", "pref.yamanashi.jp",
]);

/** ホスト名が県の公式ドメインそのもの、またはその下のホストなら true。先頭は「.」で区切る（evilpref.… や pref.<他人>.jp は通さない）。 */
export function isPrefDomainHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length; i++) {
    if (PREF_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
