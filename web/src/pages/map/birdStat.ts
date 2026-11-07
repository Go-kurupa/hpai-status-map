// 野鳥の陽性の札に添える県名（2026-11-07 作者の決定: 最初の画面の数字の欄にも野鳥を出し、地図の外の発生も県名で分かるようにする）
import { PREFS } from "@hpai/shared/pref";
import type { WildBird } from "@hpai/shared/types";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const PREF_ORDER = new Map(PREFS.map((p, i) => [p.code, i]));
/** これより多いときは最初の何県かと県の数にする */
const MAX_NAMES = 4;
const SHORT_NAMES = 3;

/**
 * 陽性（否定を除く。wildBirdCounts と同じ扱い）の県名を、新しい日付の順（同じ日は県の番号の順）に重ねずに並べる。
 * 県が多いときに最初の画面で省くのは古い方（新しい発生ほど知りたい）。
 * 陽性がなければ null。
 */
export function birdPrefsText(birds: readonly WildBird[]): string | null {
  const rows = birds
    .filter((b) => b.test !== "negative")
    .slice()
    .sort((a, b) => (a.date === b.date ? (PREF_ORDER.get(a.prefCode) ?? 99) - (PREF_ORDER.get(b.prefCode) ?? 99) : a.date > b.date ? -1 : 1));
  const codes = [...new Set(rows.map((b) => b.prefCode))];
  if (codes.length === 0) return null;
  const names = codes.map((c) => PREF_NAME.get(c) ?? c);
  if (names.length <= MAX_NAMES) return names.join("・");
  return `${names.slice(0, SHORT_NAMES).join("・")}など ${names.length} 都道府県`;
}
