import { describe, expect, it } from "vitest";
import adjacencyJson from "../../data/geo/adjacency.json";
import historyJson from "../../data/history/cases.json";
import { describePast } from "../src/past";
import type { HistoryCase } from "../src/types";

const adjacency = adjacencyJson as Record<string, string[]>;
const geo = { adjacency };
const real = historyJson as HistoryCase[];

// 33214 真庭市の隣に 33203 津山市（data/geo/adjacency.json）
const TOWN = "33214";
const NEIGHBOR = "33203";
const FAR = "13101";

function row(o: Partial<HistoryCase> & { season: number; muniCode: string }): HistoryCase {
  return {
    no: 1,
    prefCode: o.muniCode.slice(0, 2),
    muniNameThen: "テスト市",
    date: `${o.season}-12-20`,
    birdUse: null,
    housing: null,
    headCount: null,
    sourceUrl: "https://example.invalid/h",
    related: false,
    ...o,
  };
}

const BANNED = /また発生しやすい|危ない|うつる|危険地帯|ホットスポット|確率/;

describe("describePast", () => {
  it("隣町の 2 年前の発生は『2 年前に隣町で発生しました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR })], geo, 2026);
    expect(r.sentence).toBe("2 年前に隣町で発生しました（記録）");
    expect(r.latest?.relation).toBe("adjacent");
    expect(r.latest?.ago).toBe("2 年前");
  });

  it("この町の昨季の発生は『昨季にこの町で発生しました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2025, muniCode: TOWN })], geo, 2026);
    expect(r.sentence).toBe("昨季にこの町で発生しました（記録）");
    expect(r.latest?.relation).toBe("same");
  });

  it("いちばん新しいものを選ぶ", () => {
    const rows = [row({ season: 2022, muniCode: TOWN }), row({ season: 2024, muniCode: NEIGHBOR }), row({ season: 2023, muniCode: TOWN })];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.sentence).toBe("2 年前に隣町で発生しました（記録）");
    expect(r.hits.map((h) => h.season)).toEqual([2024, 2023, 2022]);
  });

  it("同じ日なら、この町を優先する", () => {
    const rows = [
      row({ season: 2025, muniCode: NEIGHBOR, date: "2025-12-20" }),
      row({ season: 2025, muniCode: TOWN, date: "2025-12-20", no: 2 }),
    ];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.sentence).toBe("昨季にこの町で発生しました（記録）");
    expect(r.hits.map((h) => h.relation)).toEqual(["same", "adjacent"]);
  });

  it("離れた町は入らない。記録がなければ『発生はありません』の文", () => {
    const r = describePast(TOWN, [row({ season: 2025, muniCode: FAR })], geo, 2026);
    expect(r.hits).toEqual([]);
    expect(r.latest).toBeNull();
    expect(r.sentence).toBe("過去の記録に、この町と隣町の発生はありません（記録）");
    expect(describePast(TOWN, [], geo, 2026).sentence).toBe("過去の記録に、この町と隣町の発生はありません（記録）");
  });

  it("知らない市町村コードは、隣がない扱い（投げない）。同じ町だけ拾う", () => {
    const r = describePast("99999", [row({ season: 2025, muniCode: "99999" }), row({ season: 2025, muniCode: NEIGHBOR })], geo, 2026);
    expect(r.hits.map((h) => h.muniCode)).toEqual(["99999"]);
  });

  it("再現の今季（2025）は、2025 を数えない。今季より先のシーズンも数えない", () => {
    const rows = [row({ season: 2025, muniCode: NEIGHBOR }), row({ season: 2026, muniCode: NEIGHBOR })];
    const r = describePast(TOWN, rows, geo, 2025);
    expect(r.hits).toEqual([]);
    expect(r.sentence).toBe("過去の記録に、この町と隣町の発生はありません（記録）");
  });

  it("関連農場は hits に入る。本体があれば sentence は本体から（関連のほうが新しくても）", () => {
    const rows = [
      row({ season: 2023, muniCode: NEIGHBOR, no: 5 }),
      row({ season: 2024, muniCode: TOWN, no: 5, related: true }),
    ];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.hits).toHaveLength(2);
    expect(r.hits.map((h) => h.related)).toEqual([true, false]);
    expect(r.sentence).toBe("3 年前に隣町で発生しました（記録）");
    expect(r.latest?.related).toBe(false);
  });

  it("関連農場には本体の発生日（parentDate）を付ける。本体が離れた町でも history 全体から探す。関連農場自身の日付とは別", () => {
    const rows = [
      row({ season: 2023, muniCode: FAR, no: 5, date: "2023-12-20" }), // 本体は離れた町（hits に入らない）
      row({ season: 2023, muniCode: NEIGHBOR, no: 5, related: true, date: "2024-01-05" }),
      row({ season: 2023, muniCode: NEIGHBOR, no: 9, related: true, date: "2024-01-06" }), // 本体が history にない
    ];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.hits.map((h) => [h.no, h.parentDate])).toEqual([
      [9, null],
      [5, "2023-12-20"],
    ]);
    const body = describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR })], geo, 2026);
    expect(body.hits[0]!.parentDate).toBeNull(); // 本体の行には付けない
  });

  it("実データ: 関連農場 58 行のどれも、本体が見つかり、parentDate が付く", () => {
    const all = new Set(real.filter((h) => h.related).map((h) => `${h.season}-${h.no}`));
    expect(all.size).toBeGreaterThan(0);
    for (const code of new Set(real.filter((h) => h.related).map((h) => h.muniCode))) {
      for (const hit of describePast(code, real, geo, 2026).hits.filter((h) => h.related && h.relation === "same")) {
        expect(hit.parentDate, `${hit.season}-${hit.no}`).not.toBeNull();
      }
    }
  });

  it("関連農場だけなら『2 年前に隣町で関連農場がありました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR, related: true })], geo, 2026);
    expect(r.sentence).toBe("2 年前に隣町で関連農場がありました（記録）");
    expect(r.latest?.related).toBe(true);
  });

  it("実データ: 真庭市の昨季は隣の津山市の発生。再現の今季 2025 では何も数えない", () => {
    expect(describePast(TOWN, real, geo, 2026).sentence).toBe("昨季に隣町で発生しました（記録）");
    expect(describePast(NEIGHBOR, real, geo, 2026).sentence).toBe("昨季にこの町で発生しました（記録）");
    const replay = describePast(TOWN, real, geo, 2025);
    expect(replay.hits.every((h) => h.season < 2025)).toBe(true); // 再現の今季 2025 は数えない
  });

  it("予測や煽りの言葉がない（§11）。禁じた語もない", () => {
    const sentences = [
      describePast(TOWN, [row({ season: 2025, muniCode: TOWN })], geo, 2026).sentence,
      describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR })], geo, 2026).sentence,
      describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR, related: true })], geo, 2026).sentence,
      describePast(TOWN, [], geo, 2026).sentence,
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(/安全|安心|区域の外です/);
    }
  });

  it("入力を並べ替えない", () => {
    const rows = [row({ season: 2022, muniCode: TOWN }), row({ season: 2024, muniCode: TOWN })];
    const copy = rows.map((r) => ({ ...r }));
    describePast(TOWN, rows, geo, 2026);
    expect(rows).toEqual(copy);
  });
});
