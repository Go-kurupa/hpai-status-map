// 市町村名の書き方をそろえる（I-04）。geo を使わない純粋な文字列の処理で、verify と compare が同じ関数を使う。
import { PREFS } from "../pref";
import { normalizeForMatch } from "../text";

// 先頭の県名は、正式名（都道府県まで付いたもの）だけを取り除く。短い名前（「岡山」）で取ると「岡山市」が壊れる。
const PREF_FULL_NAMES: readonly string[] = PREFS.map((p) => p.name);

/**
 * 郡、区、先頭の県名を除いた市町村名。
 * 苫田郡鏡野町→鏡野町、岡山市北区→岡山市、東京都港区→港区。郡山市と大和郡山市、港区は変えない。
 * 郡は「X郡Y町」「X郡Y村」の形だけ、区は「C市D区」の形だけ取り除く。
 */
export function muniCoreName(name: string): string {
  let s = normalizeForMatch(name);
  for (const p of PREF_FULL_NAMES) {
    if (s.startsWith(p) && s.length > p.length) {
      s = s.slice(p.length);
      break;
    }
  }
  const gun = /^.+?郡(.+[町村])$/u.exec(s);
  if (gun) return gun[1]!;
  const ku = /^(.+?市).+区$/u.exec(s);
  if (ku) return ku[1]!;
  return s;
}
