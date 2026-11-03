// data/history/ の中身の検査（設計書 §16）。公開してよい data/ だけを読む（private/ は読まない）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MuniEntry } from "@hpai/shared/geo";
import { seasonOf } from "@hpai/shared/season";
import type { HistoryCase } from "@hpai/shared/types";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as unknown;

const all = readJson("data/history/cases.json") as HistoryCase[];
const nameMap = readJson("data/history/name-map.json") as Record<string, string>;
const index = readJson("data/geo/muni-index.json") as Record<string, MuniEntry>;
const main = all.filter((c) => !c.related);
const related = all.filter((c) => c.related);

describe("data/history/cases.json", () => {
  it("related:false は 52、25、84、11、51、24、計 247（シーズン 2020〜2025）", () => {
    const counts = [2020, 2021, 2022, 2023, 2024, 2025].map((s) => main.filter((c) => c.season === s).length);
    expect(counts).toEqual([52, 25, 84, 11, 51, 24]);
    expect(main).toHaveLength(247);
  });

  it("no は各シーズンで 1..N（重複も欠けもない）", () => {
    for (const s of [2020, 2021, 2022, 2023, 2024, 2025]) {
      const nos = main.filter((c) => c.season === s).map((c) => c.no).sort((a, b) => a - b);
      expect(nos, `シーズン ${s}`).toEqual(nos.map((_, i) => i + 1));
    }
  });

  it("related:true は 58 行で、(season, no) が本体にある", () => {
    expect(related).toHaveLength(58);
    const keys = new Set(main.map((c) => `${c.season}-${c.no}`));
    for (const c of related) expect(keys.has(`${c.season}-${c.no}`), `${c.season}-${c.no}`).toBe(true);
  });

  it("muniCode は muni-index にあり、prefCode と先頭 2 桁が合う", () => {
    for (const c of all) {
      expect(index[c.muniCode], `${c.season}-${c.no} ${c.muniNameThen}`).toBeDefined();
      expect(c.muniCode.slice(0, 2)).toBe(c.prefCode);
      expect(index[c.muniCode]!.prefCode).toBe(c.prefCode);
    }
  });

  it("seasonOf(date) が season と合う", () => {
    for (const c of all) expect(seasonOf(c.date), `${c.season}-${c.no} ${c.date}`).toBe(c.season);
  });

  it("sourceUrl は https://www.maff.go.jp/ の下", () => {
    for (const c of all) expect(c.sourceUrl.startsWith("https://www.maff.go.jp/")).toBe(true);
  });

  it("キーは HistoryCase の 11 個だけ（note や県名の綴りを持ち込まない）", () => {
    const keys = ["season", "no", "prefCode", "muniCode", "muniNameThen", "date", "birdUse", "housing", "headCount", "sourceUrl", "related"].sort();
    for (const c of all) expect(Object.keys(c).sort()).toEqual(keys);
  });

  it("同じ県、市町村、日付の別の事例が 8 組（本体）", () => {
    const groups = new Map<string, number>();
    for (const c of main) {
      const k = `${c.prefCode}|${c.muniCode}|${c.date}`;
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    expect([...groups.values()].filter((n) => n > 1)).toHaveLength(8);
  });

  it("並びは (season, related, no)。作り直しても同じになる", () => {
    const key = (c: HistoryCase) => [c.season, c.related ? 1 : 0, c.no];
    for (let i = 1; i < all.length; i++) {
      const [a, b] = [key(all[i - 1]!), key(all[i]!)];
      const cmp = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      expect(cmp, `${i} 行目`).toBeLessThanOrEqual(0);
    }
  });

  it("コードは本体で 124、関連を含めて 136", () => {
    expect(new Set(main.map((c) => c.muniCode)).size).toBe(124);
    expect(new Set(all.map((c) => c.muniCode)).size).toBe(136);
  });
});

describe("data/history/name-map.json", () => {
  it("金ヶ崎町と金ケ崎町は 03381、伊達市は県で分かれ、福岡市は 40130", () => {
    expect(nameMap["岩手県|金ヶ崎町"]).toBe("03381");
    expect(nameMap["岩手県|金ケ崎町"]).toBe("03381");
    expect(nameMap["北海道|伊達市"]).toBe("01233");
    expect(nameMap["福島県|伊達市"]).toBe("07213");
    expect(nameMap["福岡県|福岡市"]).toBe("40130");
  });

  it("キーは整列し、値は muni-index にあり、cases.json の対応と食い違わない", () => {
    const keys = Object.keys(nameMap);
    expect(keys).toEqual([...keys].sort());
    for (const v of Object.values(nameMap)) expect(index[v]).toBeDefined();
    for (const c of all) {
      const entry = Object.entries(nameMap).filter(([k, v]) => k.endsWith(`|${c.muniNameThen}`) && v === c.muniCode);
      expect(entry.length, `${c.season}-${c.no} ${c.muniNameThen}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("data/history/unmatched.md", () => {
  it("対応づかない事例: 0 件", () => {
    expect(fs.readFileSync(path.join(ROOT, "data/history/unmatched.md"), "utf8")).toContain("対応づかない事例: 0 件");
  });
});
