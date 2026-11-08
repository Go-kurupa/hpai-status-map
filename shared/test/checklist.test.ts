import { describe, expect, it } from "vitest";
import {
  CHECKLIST_HEADINGS,
  CHECKLIST_ITEMS,
  ZONE_AUTHORITY_NOTE,
  buildChecklist,
  shortReminder,
  type ChecklistSection,
} from "../src/checklist";
import type { FarmHousing, Level, Production } from "../src/types";
import { FIXED_TEXT, findForbiddenPhrases } from "../src/wording";

const build = (level: Level, production: Production | null = null, housing: FarmHousing | null = null) =>
  buildChecklist({ level, production, housing });
const ids = (s: ChecklistSection | undefined) => s?.items.map((i) => i.id) ?? [];
const sec = (r: ChecklistSection[], cls: string) => r.find((s) => s.class === cls);

describe("buildChecklist: 段階ごとの分類", () => {
  it("段階 1 は 3 分類（いつも、区域に入っていれば、確かめておくとよいこと）の順", () => {
    expect(build(1).map((s) => s.class)).toEqual(["always", "if_in_zone", "good_to_check"]);
  });
  it("段階 2 と 3 は always と good_to_check、4 は always だけ", () => {
    expect(build(2).map((s) => s.class)).toEqual(["always", "good_to_check"]);
    expect(build(3).map((s) => s.class)).toEqual(["always", "good_to_check"]);
    expect(build(4).map((s) => s.class)).toEqual(["always"]);
  });
  it("always の項目は段階で変わらない（飼養衛生管理基準の 9 項目）", () => {
    const base = ids(sec(build(4), "always"));
    expect(base).toEqual(["always-17", "always-18", "always-19", "always-22", "always-23", "always-25", "always-27", "always-32", "always-33"]);
    for (const l of [1, 2, 3] as const) expect(ids(sec(build(l), "always"))).toEqual(base);
  });
  it("区域の項目は段階 1 だけ", () => {
    expect(ids(sec(build(1), "if_in_zone"))).toEqual(["zone-daily", "zone-visitors", "zone-entry", "zone-lime", "zone-inside", "zone-abnormal"]);
    for (const l of [2, 3, 4] as const) expect(sec(build(l), "if_in_zone")).toBeUndefined();
  });
  it("見出しは決まりの文。『確かめておくとよいこと』に『義務ではありません』と並び順の説明がある", () => {
    const r = build(1);
    expect(sec(r, "always")?.heading).toBe("いつも求められていること");
    expect(sec(r, "if_in_zone")?.heading).toBe("区域に入っていれば求められること");
    expect(sec(r, "good_to_check")?.heading).toBe("確かめておくとよいこと（義務ではありません。関係が深そうな順）");
    expect(CHECKLIST_HEADINGS.good_to_check).toBe(sec(r, "good_to_check")?.heading);
    expect(ZONE_AUTHORITY_NOTE).toBe("区域に入っているかは、県の連絡で確かめてください");
  });
  it("『義務ではない』は good_to_check の見出しだけ。always と if_in_zone の項目と見出しに出ない", () => {
    for (const s of build(1).filter((x) => x.class !== "good_to_check")) {
      expect(s.heading).not.toContain("義務ではない");
      for (const i of s.items) expect(`${i.text}${i.source.note ?? ""}`).not.toContain("義務ではない");
    }
  });
});

describe("buildChecklist: 採卵か肉用か、飼い方", () => {
  it("採卵は good-egg、肉用は good-broiler、未設定は両方", () => {
    const g = (p: Production | null) => ids(sec(build(2, p), "good_to_check"));
    expect(g("layer")).toContain("good-egg");
    expect(g("layer")).not.toContain("good-broiler");
    expect(g("broiler")).toContain("good-broiler");
    expect(g("broiler")).not.toContain("good-egg");
    expect(g(null)).toEqual(expect.arrayContaining(["good-egg", "good-broiler"]));
  });
  it("open と free_range は good-walls、good-rats が先頭。それ以外は good-visitor-clothes が先頭", () => {
    for (const h of ["open", "free_range"] as const) {
      expect(ids(sec(build(2, null, h), "good_to_check")).slice(0, 2)).toEqual(["good-walls", "good-rats"]);
    }
    for (const h of ["windowless", null] as const) {
      expect(ids(sec(build(2, null, h), "good_to_check"))[0]).toBe("good-visitor-clothes");
    }
  });
  it("並べ替えは写しで行い、CHECKLIST_ITEMS の rank を書き換えない", () => {
    const before = CHECKLIST_ITEMS.map((i) => i.rank);
    build(2, null, "open");
    expect(CHECKLIST_ITEMS.map((i) => i.rank)).toEqual(before);
    const walls = sec(build(2, null, "open"), "good_to_check")?.items[0];
    expect(walls).toMatchObject({ id: "good-walls", rank: 1 });
    expect(sec(build(2, null, "open"), "good_to_check")?.items[1]).toMatchObject({ id: "good-rats", rank: 2 });
  });
  it("rank は表の順に 10、20、…", () => {
    expect(CHECKLIST_ITEMS.map((i) => i.rank)).toEqual(CHECKLIST_ITEMS.map((_, n) => (n + 1) * 10));
    expect(CHECKLIST_ITEMS[0]?.id).toBe("always-17");
  });
});

describe("項目の出典と文", () => {
  it("全項目に https:// の出典があり、title は空でない", () => {
    expect(CHECKLIST_ITEMS.length).toBe(24);
    for (const i of CHECKLIST_ITEMS) {
      expect(i.source.url, i.id).toMatch(/^https:\/\//);
      expect(i.source.title.length, i.id).toBeGreaterThan(0);
      expect(i.text.length, i.id).toBeGreaterThan(0);
    }
  });
  it("id は重ならない", () => {
    expect(new Set(CHECKLIST_ITEMS.map((i) => i.id)).size).toBe(CHECKLIST_ITEMS.length);
  });
  it("飼養衛生管理基準の項目の note に、番号が 2025-10-01 に変わったことがある", () => {
    const std = CHECKLIST_ITEMS.filter((i) => i.source.url === "https://laws.e-gov.go.jp/law/326M50010000035");
    expect(std.length).toBeGreaterThanOrEqual(10); // always の 9 項目と good-worker
    for (const i of std) expect(i.source.note, i.id).toContain("2025-10-01");
    expect(CHECKLIST_ITEMS.find((i) => i.id === "always-17")?.source.note).toContain("項目 17");
  });
  it("項目番号と条文の位置を note に持つ（表のとおり）", () => {
    const note = (id: string) => CHECKLIST_ITEMS.find((i) => i.id === id)?.source.note ?? "";
    expect(note("always-32")).toContain("項目 32");
    expect(note("zone-daily")).toContain("第 9 の 1(5)");
    expect(note("zone-daily")).toContain("留意事項 48");
    expect(note("zone-lime")).toContain("留意事項 48");
    expect(note("zone-abnormal")).toContain("第 9 の 1(5)");
    expect(note("good-egg")).toContain("第 9 の 5(2)");
    expect(note("good-broiler")).toContain("第 9 の 5(1)");
    expect(note("good-records")).toContain("平成 24 年度ごろの古い資料の事例です");
    expect(note("good-worker")).toContain("作者の経験");
  });
  it("留意事項 48 は『区域内』の規定。区域の項目（if_in_zone）にだけ使う", () => {
    for (const i of CHECKLIST_ITEMS) {
      if (i.source.note?.includes("留意事項 48")) expect(i.class, i.id).toBe("if_in_zone");
    }
  });
  it("消毒を記録できる項目は決まった 6 つ", () => {
    expect(CHECKLIST_ITEMS.filter((i) => i.disinfectionLoggable).map((i) => i.id)).toEqual([
      "always-17",
      "always-19",
      "always-22",
      "zone-entry",
      "zone-lime",
      "zone-inside",
    ]);
  });
  it("確認リストで「やった」を出す項目（doneLoggable）は、いつも求められていることと区域に入っていれば求められることの全項目。確かめておくとよいことには出さない（2026-11-08）", () => {
    for (const i of CHECKLIST_ITEMS) expect(i.doneLoggable, i.id).toBe(i.class === "always" || i.class === "if_in_zone");
    expect(CHECKLIST_ITEMS.filter((i) => i.doneLoggable)).toHaveLength(15);
    // 消毒の 6 項目（今日のやることに並べる）は、確認リストの「やった」にも含まれる
    for (const i of CHECKLIST_ITEMS.filter((x) => x.disinfectionLoggable)) expect(i.doneLoggable, i.id).toBe(true);
  });
  it("全文（見出し、項目、出典、短い確認）に禁止語がない", () => {
    const all: string[] = [];
    for (const l of [1, 2, 3, 4] as const) {
      all.push(...shortReminder(l));
      for (const s of build(l)) all.push(s.heading, ...s.items.flatMap((i) => [i.text, i.source.title, i.source.note ?? ""]));
    }
    all.push(ZONE_AUTHORITY_NOTE, ...Object.values(CHECKLIST_HEADINGS));
    expect(findForbiddenPhrases(all.join("\n"))).toEqual([]);
  });
});

describe("shortReminder", () => {
  it("どの段階も 4 行以内", () => {
    for (const l of [1, 2, 3, 4] as const) {
      expect(shortReminder(l).length).toBeGreaterThan(0);
      expect(shortReminder(l).length).toBeLessThanOrEqual(4);
    }
  });
  it("段階 4 は国の報告書の言葉と自己点検", () => {
    expect(shortReminder(4)).toEqual([FIXED_TEXT.riskAnywhere, "今月の自己点検を確かめましょう"]);
  });
  it("段階 2 と 3 は同じ 4 行", () => {
    const expected = [
      "近くの町で発表がありました。県の発表を確かめましょう",
      "消毒と着替えを確かめましょう",
      "働く人に声をかけましょう",
      FIXED_TEXT.prefContactIsAuthority,
    ];
    expect(shortReminder(2)).toEqual(expected);
    expect(shortReminder(3)).toEqual(expected);
  });
  it("段階 1 は『県の連絡を確かめてください』", () => {
    expect(shortReminder(1)).toEqual([
      "区域に入っている可能性があります。県の連絡を確かめてください",
      "毎日の死亡羽数の報告があるか確かめましょう",
      "消毒と出入りの制限を確かめましょう",
      FIXED_TEXT.prefContactIsAuthority,
    ]);
  });
});
