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
