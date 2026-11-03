// 公開 API と公開 MCP が使う、入力の検証（zod）。HTTP の query と MCP の引数で同じ規則を使う。
import { z } from "zod";
import { API_MIN_SEASON } from "@hpai/shared/api";
import { PREFS } from "@hpai/shared/pref";
import { currentSeason } from "@hpai/shared/season";
import type { MuniCode, PrefCode, Season } from "@hpai/shared/types";

export const PREF_CODES = PREFS.map((p) => p.code) as [string, ...string[]];

/** "01"〜"47" */
export const prefSchema = z.enum(PREF_CODES);
/** 5 桁の数字 */
export const muniCodeSchema = z.string().regex(/^\d{5}$/);
/** 2020 から今季までの整数 */
export const seasonSchema = (now: Date) => z.number().int().min(API_MIN_SEASON).max(currentSeason(now));
/** HTTP の query 用: 4 桁の数字の文字列 */
const seasonQuery = (now: Date) => z.string().regex(/^\d{4}$/).transform(Number).pipe(seasonSchema(now));

/** 値が undefined なら今季。不正は null。 */
export function parseSeason(raw: unknown, now: Date): Season | null {
  if (raw === undefined) return currentSeason(now);
  const r = seasonQuery(now).safeParse(raw);
  return r.success ? r.data : null;
}

/** 未指定は undefined、不正は null。 */
export function parsePref(raw: unknown): PrefCode | null | undefined {
  if (raw === undefined) return undefined;
  const r = prefSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseMuniCode(raw: unknown): MuniCode | null {
  const r = muniCodeSchema.safeParse(raw);
  return r.success ? r.data : null;
}
