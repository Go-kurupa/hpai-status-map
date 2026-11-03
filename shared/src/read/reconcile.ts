// 国の一覧との突き合わせ（I-18、設計書 §9.7）。純粋関数だけ。取得も Firestore も時計も、ここでは呼ばない。
// 国の報道発表（確認と解除）から読んだ事実と、作品の事例を比べて、取りこぼしと食い違いを見つける。直さない（直すかは呼び手と運営者が決める）。
import { jstDateOf } from "../dates";
import { currentSeason, seasonOf } from "../season";
import type { Case, IsoDate, PrefCode, Season } from "../types";
import { parseMaffFarm, parseMaffLift, parseMaffPress, type MaffItemType } from "./maff";

const PRESS = "https://www.maff.go.jp/j/press/";

/** 国の報道発表の新着の一覧（約 1 週間分）。 */
export const MAFF_PRESS_INDEX_URL = `${PRESS}index.html`;

/** シーズン中の発生は 10 月から（設計書 §1）。月別の一覧はこの月から数える。 */
const SEASON_FIRST_MONTH = 10;

/**
 * 突き合わせで見る国の一覧。新着の index.html と、今季の 10 月から「前の月」までの月別の一覧（arc/YYMM.html）。
 * 新着の一覧は約 1 週間分なので、長い停止の取りこぼしは月別の一覧で拾う。今の月の月別の一覧は見ない（まだ無いことがあり、無いと全体が比べられなくなる）。
 */
export function nationalListUrls(now: Date): string[] {
  const season = currentSeason(now);
  const today = jstDateOf(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const urls = [MAFF_PRESS_INDEX_URL];
  let y = season;
  let m = SEASON_FIRST_MONTH;
  while (y * 12 + m < year * 12 + month) {
    urls.push(`${PRESS}arc/${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}.html`);
    m += 1;
    if (m > 12) {
      y += 1;
      m = 1;
    }
  }
  return urls;
}

// ── 国の発表から読んだ事実 ──

export type NationalFact =
  | {
      type: "confirmed";
      url: string;
      title: string;
      prefCode: PrefCode;
      muniName: string;
      nationalNo: number;
      date: IsoDate;
      headCount: number | null;
      birdUse: string | null;
    }
  | {
      type: "movement_lifted";
      url: string;
      title: string;
      prefCode: PrefCode;
      muniName: string;
      nationalNos: number[];
      date: IsoDate;
      controlDone: IsoDate | null;
      shipmentLifted: IsoDate | null;
    };

export type NationalLiftFact = Extract<NationalFact, { type: "movement_lifted" }>;

/** 本文（正規化の前でよい）から国の事実を読む。定型が崩れていれば null（推測しない）。 */
export function parseNationalFact(item: { url: string; title: string; type: MaffItemType }, text: string): NationalFact | null {
  if (item.type === "confirmed") {
    const p = parseMaffPress(text);
    if (p === null) return null;
    const farm = parseMaffFarm(text);
    return { type: "confirmed", url: item.url, title: item.title, prefCode: p.prefCode, muniName: p.muniName, nationalNo: p.nationalNo, date: p.date, headCount: farm.headCount, birdUse: farm.birdUse };
  }
  const l = parseMaffLift(text);
  if (l === null) return null;
  return { type: "movement_lifted", url: item.url, title: item.title, prefCode: l.prefCode, muniName: l.muniName, nationalNos: l.nationalNos, date: l.date, controlDone: l.controlDone, shipmentLifted: l.shipmentLifted };
}

/** 今季の確定の N の集合。 */
export function nationalConfirmedNos(facts: readonly NationalFact[], season: Season): Set<number> {
  const out = new Set<number>();
  for (const f of facts) if (f.type === "confirmed" && seasonOf(f.date) === season) out.add(f.nationalNo);
  return out;
}

// ── 比べる ──

/** 作品が「持っている」事例か。確認中（N を持たない）と、否定された事例は、持っていることにしない。 */
const holds = (c: Case, season: Season): boolean => c.season === season && c.confirmState !== "reviewing" && c.negation !== "negated";

/** 国にあって作品にない N（昇順、重複なし）。確認中と否定は数えない。 */
export function missingNationalNos(nationalNos: Iterable<number>, cases: readonly Case[], season: Season): number[] {
  const have = new Set(cases.filter((c) => holds(c, season) && c.nationalNo !== null).map((c) => c.nationalNo as number));
  return [...new Set(nationalNos)].filter((n) => !have.has(n)).sort((a, b) => a - b);
}

/** 確定の時刻（JST）。段階の時刻が null、または壊れていれば 00:00。確定の段階がなければ null。 */
export function confirmedAtOf(c: Case): Date | null {
  const stamp = c.stages.confirmed;
  if (stamp === undefined) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(stamp.time ?? "");
  const hh = m !== null && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1]!.padStart(2, "0") : "00";
  const mm = m !== null && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[2]! : "00";
  const d = new Date(`${stamp.date}T${hh}:${mm}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 作品にあって国にない確定を、運営者に知らせるまでの時間（その間は表示を保つ）。 */
export const APP_ONLY_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * 作品にあって国の一覧にない確定の事例（48 時間以上たったもの）。事例は消さない。
 * 国の情報から作った事例（national）、確認中、否定された事例は対象にしない。N がない事例は、国の一覧に N が見つからないので対象になる。
 */
export function appOnlyConfirmed(cases: readonly Case[], nationalNos: ReadonlySet<number>, season: Season, now: Date): Case[] {
  return cases.filter((c) => {
    if (!holds(c, season) || c.confirmState === "national") return false;
    if (c.nationalNo !== null && nationalNos.has(c.nationalNo)) return false;
    const at = confirmedAtOf(c);
    return at !== null && now.getTime() - at.getTime() >= APP_ONLY_AFTER_MS;
  });
}

/** 解除の段階を持つ（または、解除より先へ進んだ）事例か。 */
const hasLifted = (c: Case): boolean => c.stages.movement_lifted !== undefined || c.stages.surveillance_lifted !== undefined;

/**
 * 事例に反映されていない国の解除の発表（再適用の候補）。事例ができる前に来た解除と、取りこぼした解除が当たる。
 * N のどれかに、事例がない、または解除の段階がなければ返す。
 * 否定された、または否定の候補の事例は、自動で直さない（運営者が否定を決める）ので数えない。今季でない解除は見ない。
 */
export function liftGaps(lifts: readonly NationalLiftFact[], cases: readonly Case[], season: Season): NationalLiftFact[] {
  return lifts.filter((lift) => {
    if (seasonOf(lift.date) !== season) return false;
    return lift.nationalNos.some((no) => {
      const c = cases.find((x) => x.season === season && x.confirmState !== "reviewing" && x.nationalNo === no && x.muniName !== null);
      if (c === undefined) return true;
      return c.negation === "none" && !hasLifted(c);
    });
  });
}
