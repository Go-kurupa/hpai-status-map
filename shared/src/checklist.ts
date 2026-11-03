// 確認リスト（設計書 §7）。決まりとしてコードで作り、Claude に判断させない。
// 条文上の義務（always、if_in_zone）と、見直しの推奨（good_to_check）を混ぜない。
// 区域に入っているかは県の連絡が正で、ここでは断定しない。
import { CHECKLIST_ITEMS } from "./checklist/items";
import type { ChecklistClass, FarmHousing, Level, Production } from "./types";
import { FIXED_TEXT } from "./wording";

export interface ChecklistSource {
  title: string;
  url: string;
  note: string | null;
}
export interface ChecklistItem {
  id: string;
  class: ChecklistClass;
  text: string;
  source: ChecklistSource;
  /** 小さいほど先。表の順に 10、20、… */
  rank: number;
  /** 「やった」を消毒の記録に残せる */
  disinfectionLoggable: boolean;
}
export interface ChecklistSection {
  class: ChecklistClass;
  heading: string;
  items: ChecklistItem[];
}

export { CHECKLIST_ITEMS };

export const CHECKLIST_HEADINGS: Readonly<Record<ChecklistClass, string>> = {
  always: "いつも求められていること",
  if_in_zone: "区域に入っていれば求められること",
  good_to_check: "確かめておくとよいこと（義務ではありません。関係が深そうな順）",
};

/** 『区域に入っていれば求められること』の見出しに添える。区域の内外はここでは決めない */
export const ZONE_AUTHORITY_NOTE = "区域に入っているかは県の連絡が正です";

/** 開放的な鶏舎と放し飼いは、野生動物に関わる項目を上に */
const WILD_ANIMAL_FIRST: ReadonlyArray<readonly [string, number]> = [
  ["good-walls", 1],
  ["good-rats", 2],
];

function visible(item: ChecklistItem, production: Production | null): boolean {
  if (item.id === "good-egg") return production !== "broiler";
  if (item.id === "good-broiler") return production !== "layer";
  return true;
}

export function buildChecklist(i: { level: Level; production: Production | null; housing: FarmHousing | null }): ChecklistSection[] {
  const classes: ChecklistClass[] = ["always"];
  if (i.level === 1) classes.push("if_in_zone");
  if (i.level <= 3) classes.push("good_to_check");

  const wildFirst = i.housing === "open" || i.housing === "free_range";
  return classes.map((cls) => {
    const items = CHECKLIST_ITEMS.filter((it) => it.class === cls && visible(it, i.production)).map((it): ChecklistItem => {
      const first = wildFirst ? WILD_ANIMAL_FIRST.find(([id]) => id === it.id) : undefined;
      return first ? { ...it, rank: first[1] } : { ...it };
    });
    items.sort((a, b) => a.rank - b.rank);
    return { class: cls, heading: CHECKLIST_HEADINGS[cls], items };
  });
}

/** ふだん出す短い確認。「くわしく」を押す前の数行（4 行以内） */
export function shortReminder(level: Level): string[] {
  if (level === 4) return [FIXED_TEXT.riskAnywhere, "今月の自己点検を確かめましょう"];
  if (level === 1) {
    return [
      "区域に入っている可能性があります。県の連絡を確かめてください",
      "毎日の死亡羽数の報告があるか確かめましょう",
      "消毒と出入りの制限を確かめましょう",
      FIXED_TEXT.prefContactIsAuthority,
    ];
  }
  return [
    "近くの町で発表がありました。県の発表を確かめましょう",
    "消毒と着替えを確かめましょう",
    "働く人に声をかけましょう",
    FIXED_TEXT.prefContactIsAuthority,
  ];
}
