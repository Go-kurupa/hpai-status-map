import type { MuniEntry } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import { normalizeForMatch } from "@hpai/shared/text";
import type { MuniCode } from "@hpai/shared/types";

export interface TownHit {
  code: MuniCode;
  /** 「岡山県 西粟倉村」。同じ県に同じ名前の町があるときだけ（市町村コード）を足す */
  label: string;
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/** 「岡山県西粟倉村」と「岡山西粟倉村」。県名を続けて打つ人は「県」「府」「都」を省くことが多い */
function withPref(e: MuniEntry): string[] {
  const pref = PREF_NAME.get(e.prefCode) ?? "";
  return [pref, pref.replace(/[都府県]$/u, "")].map((p) => normalizeForMatch(p + e.name));
}

/**
 * 町を名前の一部で探す（設計書 2026-11-06-town-picker 4 章）。漢字の部分一致で、読み仮名は使わない。
 * 並びは 名前が同じ → 名前が入力で始まる → ほか。同じ順位の中は市町村コードの順。limit を超えた分は数だけ返す。
 */
export function searchTowns(index: Readonly<Record<MuniCode, MuniEntry>>, query: string, limit = 20): { hits: TownHit[]; more: number } {
  const q = normalizeForMatch(query);
  if (!q) return { hits: [], more: 0 };
  const all = Object.values(index);
  const found = all
    .map((e) => {
      const name = normalizeForMatch(e.name);
      const rank = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) || withPref(e).some((s) => s.includes(q)) ? 2 : -1;
      return { e, rank };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (a.e.code < b.e.code ? -1 : 1));
  const hits = found.slice(0, limit).map(({ e }) => {
    const dup = all.some((x) => x.code !== e.code && x.prefCode === e.prefCode && x.name === e.name);
    return { code: e.code, label: `${PREF_NAME.get(e.prefCode) ?? ""} ${e.name}${dup ? `（${e.code}）` : ""}`.trim() };
  });
  return { hits, more: found.length - hits.length };
}
