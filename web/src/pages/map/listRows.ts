// 発生の一覧の行（W-06、設計書 §12）。公表の範囲（県、市町村、日付、羽数、リンク）だけを持つ。
// 農場の特徴（用途、鶏舎の形）や不備の項目は持たない。確認中の行は県名、確認中、リンクだけ。
import { displayStage } from "@hpai/shared/cases";
import { diffDays, jstDateOf } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import type { Case, IsoDate, WildBird } from "@hpai/shared/types";
import { caseDate } from "./seasonView";

/** 疑いを出せるのは県の発表を見つけられた県だけ、という限り（§9.2） */
export const DETECTION_LIMIT_NOTE = "疑いは、県の発表を見つけられた県だけ出ます。見つけられないと、国の発表（約 1 日後）で初めて確定として載ります";
/** 野鳥の区域の取り違え防止（§5） */
export const WILD_ZONE_NOTE = "環境省の野鳥監視重点区域は、防疫指針の区域とは別のものです";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
/** 否定した事例を一覧に残す日数（§10.2。8 日目に消える） */
const NEGATED_KEEP_DAYS = 7;

export interface ListRow {
  id: string;
  prefName: string;
  /** 確認中は null */
  muniName: string | null;
  label: string;
  /** 発生の日（確定の日、なければ疑いの日）。確認中や日付がなければ null */
  date: IsoDate | null;
  headCount: number | null;
  reviewing: boolean;
  sourceUrls: string[];
}

export interface WildBirdRow {
  id: string;
  prefName: string;
  muniName: string | null;
  species: string | null;
  label: "検査中" | "高病原性の確定";
  date: IsoDate;
  sourceUrl: string;
}

function validJstDate(iso: string): IsoDate | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? jstDateOf(new Date(t)) : null;
}

/** 否定した事例は 7 日残る。negatedAt が読めないときは隠さない */
function visible(c: Case, now: Date): boolean {
  if (c.negation !== "negated" || c.negatedAt === null) return true;
  const day = validJstDate(c.negatedAt);
  return day === null || diffDays(jstDateOf(now), day) <= NEGATED_KEEP_DAYS;
}

/** 並べる日。確認中は日付を公開しないので、更新の日で並べる（行には出さない） */
function sortDay(c: Case): string {
  return (c.confirmState === "reviewing" ? null : caseDate(c)) ?? validJstDate(c.updatedAt) ?? "";
}

/** 新しい順。同じ日は確認中を先に、次に id の降順 */
export function listRows(cases: readonly Case[], now: Date): ListRow[] {
  return cases
    .filter((c) => visible(c, now))
    .sort((a, b) => {
      const da = sortDay(a);
      const db = sortDay(b);
      if (da !== db) return da < db ? 1 : -1;
      const ra = a.confirmState === "reviewing";
      const rb = b.confirmState === "reviewing";
      if (ra !== rb) return ra ? -1 : 1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    })
    .map((c): ListRow => {
      const reviewing = c.confirmState === "reviewing";
      return {
        id: c.id,
        prefName: PREF_NAME.get(c.prefCode) ?? c.prefCode,
        muniName: reviewing ? null : c.muniName,
        label: displayStage(c, now).label,
        date: reviewing ? null : caseDate(c),
        headCount: reviewing ? null : c.headCount,
        reviewing,
        sourceUrls: [...c.sourceUrls],
      };
    });
}

/** 野鳥。否定は除く（表示を消す。§5）。簡易検査の陽性は検査中、高病原性が確定したものは確定。新しい順 */
export function wildBirdRows(birds: readonly WildBird[]): WildBirdRow[] {
  return birds
    .filter((b) => b.test !== "negative")
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(
      (b): WildBirdRow => ({
        id: b.id,
        prefName: PREF_NAME.get(b.prefCode) ?? b.prefCode,
        muniName: b.muniName,
        species: b.species,
        label: b.test === "hpai_confirmed" ? "高病原性の確定" : "検査中",
        date: b.date,
        sourceUrl: b.sourceUrl,
      }),
    );
}
