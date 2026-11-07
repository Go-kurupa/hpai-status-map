import { describe, expect, it } from "vitest";
import adjacencyJson from "../../data/geo/adjacency.json";
import historyJson from "../../data/history/cases.json";
import { countSmallFlocks, describePast, nearbyPast, SMALL_FLOCK_HEADS } from "../src/past";
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
  it("隣の町の 2 年前の発生は『2 年前に隣の町で発生しました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR })], geo, 2026);
    expect(r.sentence).toBe("2 年前に隣の町で発生しました（記録）");
    expect(r.latest?.relation).toBe("adjacent");
    expect(r.latest?.ago).toBe("2 年前");
  });

  it("この町の1 年前の発生は『1 年前にこの町で発生しました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2025, muniCode: TOWN })], geo, 2026);
    expect(r.sentence).toBe("1 年前にこの町で発生しました（記録）");
    expect(r.latest?.relation).toBe("same");
  });

  it("いちばん新しいものを選ぶ", () => {
    const rows = [row({ season: 2022, muniCode: TOWN }), row({ season: 2024, muniCode: NEIGHBOR }), row({ season: 2023, muniCode: TOWN })];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.sentence).toBe("2 年前に隣の町で発生しました（記録）");
    expect(r.hits.map((h) => h.season)).toEqual([2024, 2023, 2022]);
  });

  it("同じ日なら、この町を優先する", () => {
    const rows = [
      row({ season: 2025, muniCode: NEIGHBOR, date: "2025-12-20" }),
      row({ season: 2025, muniCode: TOWN, date: "2025-12-20", no: 2 }),
    ];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.sentence).toBe("1 年前にこの町で発生しました（記録）");
    expect(r.hits.map((h) => h.relation)).toEqual(["same", "adjacent"]);
  });

  it("離れた町は入らない。記録がなければ『発生はありません』の文", () => {
    const r = describePast(TOWN, [row({ season: 2025, muniCode: FAR })], geo, 2026);
    expect(r.hits).toEqual([]);
    expect(r.latest).toBeNull();
    expect(r.sentence).toBe("過去の記録に、この町と隣の町の発生はありません（記録）");
    expect(describePast(TOWN, [], geo, 2026).sentence).toBe("過去の記録に、この町と隣の町の発生はありません（記録）");
  });

  it("知らない市町村コードは、隣がない扱い（投げない）。同じ町だけ拾う", () => {
    const r = describePast("99999", [row({ season: 2025, muniCode: "99999" }), row({ season: 2025, muniCode: NEIGHBOR })], geo, 2026);
    expect(r.hits.map((h) => h.muniCode)).toEqual(["99999"]);
  });

  it("再現の今季（2025）は、2025 を数えない。今季より先のシーズンも数えない", () => {
    const rows = [row({ season: 2025, muniCode: NEIGHBOR }), row({ season: 2026, muniCode: NEIGHBOR })];
    const r = describePast(TOWN, rows, geo, 2025);
    expect(r.hits).toEqual([]);
    expect(r.sentence).toBe("過去の記録に、この町と隣の町の発生はありません（記録）");
  });

  it("関連農場は hits に入る。本体があれば sentence は本体から（関連のほうが新しくても）", () => {
    const rows = [
      row({ season: 2023, muniCode: NEIGHBOR, no: 5 }),
      row({ season: 2024, muniCode: TOWN, no: 5, related: true }),
    ];
    const r = describePast(TOWN, rows, geo, 2026);
    expect(r.hits).toHaveLength(2);
    expect(r.hits.map((h) => h.related)).toEqual([true, false]);
    expect(r.sentence).toBe("3 年前に隣の町で発生しました（記録）");
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

  it("関連農場だけなら『2 年前に隣の町で関連農場がありました（記録）』", () => {
    const r = describePast(TOWN, [row({ season: 2024, muniCode: NEIGHBOR, related: true })], geo, 2026);
    expect(r.sentence).toBe("2 年前に隣の町で関連農場がありました（記録）");
    expect(r.latest?.related).toBe(true);
  });

  it("実データ: 真庭市の1 年前は隣の津山市の発生。再現の今季 2025 では何も数えない", () => {
    expect(describePast(TOWN, real, geo, 2026).sentence).toBe("1 年前に隣の町で発生しました（記録）");
    expect(describePast(NEIGHBOR, real, geo, 2026).sentence).toBe("1 年前にこの町で発生しました（記録）");
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

describe("nearbyPast（周辺の過去の集計）", () => {
  const names: Record<string, string> = { "90001": "架空町", "90002": "架空村", "90003": "架空市" };
  const nameOf = (m: string) => names[m]!;
  const km: Record<string, number> = { "90001": 0, "90002": 30, "90003": 60 };
  const dist = (m: string) => km[m]!;
  const SEASONS = [2025, 2024, 2023];

  it("近い順に、町ごとの距離、件数、シーズン（新しい順）を返す。全体の件数とシーズン数も返す", () => {
    const rows = [
      row({ season: 2023, no: 1, muniCode: "90003" }),
      row({ season: 2023, no: 2, muniCode: "90002" }),
      row({ season: 2025, no: 3, muniCode: "90002" }),
      row({ season: 2025, no: 4, muniCode: "90002" }),
      row({ season: 2024, no: 5, muniCode: "90001" }),
    ];
    const r = nearbyPast(rows, SEASONS, nameOf, dist);
    expect(r.towns).toEqual([
      { muniCode: "90001", name: "架空町", distanceKm: 0, count: 1, seasons: [2024] },
      { muniCode: "90002", name: "架空村", distanceKm: 30, count: 3, seasons: [2025, 2023] },
      { muniCode: "90003", name: "架空市", distanceKm: 60, count: 1, seasons: [2023] },
    ]);
    expect(r.total).toBe(5);
    expect(r.seasonsWithCases).toBe(3);
    expect(r.windowSeasons).toBe(3);
  });

  it("関連農場は件数にもシーズンにも入れない", () => {
    const r = nearbyPast(
      [row({ season: 2025, no: 1, muniCode: "90002" }), row({ season: 2024, no: 1, muniCode: "90002", related: true })],
      SEASONS,
      nameOf,
      dist,
    );
    expect(r.total).toBe(1);
    expect(r.towns[0]!.seasons).toEqual([2025]);
    expect(r.seasonsWithCases).toBe(1);
  });

  it("関連農場だけの町は行にならない", () => {
    const r = nearbyPast([row({ season: 2025, muniCode: "90002", related: true })], SEASONS, nameOf, dist);
    expect(r.towns).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("60km ちょうどは入る。60.4km は表で約 60 km に丸まっても入れない（判定は丸めない）", () => {
    const rows = [row({ season: 2025, no: 1, muniCode: "90003" })];
    expect(nearbyPast(rows, SEASONS, nameOf, () => 60).total).toBe(1);
    expect(nearbyPast(rows, SEASONS, nameOf, () => 60.4).total).toBe(0);
  });

  it("渡したシーズンの外は数えない", () => {
    const r = nearbyPast([row({ season: 2019, muniCode: "90002" }), row({ season: 2026, muniCode: "90002" })], SEASONS, nameOf, dist);
    expect(r.total).toBe(0);
    expect(r.windowSeasons).toBe(3);
  });

  it("距離が同じなら町のコードの順。距離は町ごとに 1 度だけ計算する", () => {
    const calls: string[] = [];
    const r = nearbyPast(
      [row({ season: 2025, no: 1, muniCode: "90003" }), row({ season: 2025, no: 2, muniCode: "90002" }), row({ season: 2024, no: 3, muniCode: "90003" })],
      SEASONS,
      nameOf,
      (m) => {
        calls.push(m);
        return 10;
      },
    );
    expect(r.towns.map((t) => t.muniCode)).toEqual(["90002", "90003"]);
    expect(calls.sort()).toEqual(["90002", "90003"]);
  });

  it("距離を計算できない町があれば投げる（0 件にしない）", () => {
    expect(() =>
      nearbyPast([row({ season: 2025, muniCode: "90009" })], SEASONS, nameOf, () => {
        throw new Error("unknown");
      }),
    ).toThrow();
  });
});

describe("countSmallFlocks（全国の 3,000 羽未満）", () => {
  it("2,999 羽は入り、3,000 羽は入らない。null の行は数えず、羽数が分かる件数を分ける", () => {
    const rows = [
      row({ season: 2025, no: 1, muniCode: "90001", headCount: 2999 }),
      row({ season: 2025, no: 2, muniCode: "90001", headCount: 3000 }),
      row({ season: 2024, no: 3, muniCode: "90001", headCount: null }),
    ];
    expect(countSmallFlocks(rows, [2025, 2024])).toEqual({ total: 3, known: 2, small: 1 });
    expect(SMALL_FLOCK_HEADS).toBe(3000);
  });

  it("関連農場と、渡したシーズンの外は数えない", () => {
    const rows = [
      row({ season: 2025, no: 1, muniCode: "90001", headCount: 100, related: true }),
      row({ season: 2019, no: 2, muniCode: "90001", headCount: 100 }),
    ];
    expect(countSmallFlocks(rows, [2025])).toEqual({ total: 0, known: 0, small: 0 });
  });

  it("実データで、関連農場を除いた件数と羽数の分かる件数を数えられる", () => {
    const seasons = [2025, 2024, 2023, 2022, 2021, 2020];
    const main = real.filter((h) => !h.related && seasons.includes(h.season));
    const r = countSmallFlocks(real, seasons);
    expect(r.total).toBe(main.length);
    expect(r.known).toBe(main.filter((h) => h.headCount !== null).length);
    expect(r.small).toBe(main.filter((h) => h.headCount !== null && h.headCount < 3000).length);
    expect(r.small).toBeGreaterThan(0);
  });
});
