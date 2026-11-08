// AIに対策を相談: 発生の件数の表（stats.ts）。数え方は関連農場を除き、シーズンは 6 月〜翌 5 月。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NEAR_NO_FARM_TEXT, STATS_GROUP_BYS, STATS_MAX_NEAR_ROWS, STATS_MAX_PREF_ROWS, computeStats, nearDateText, nearDistanceText, parseStatsQuery, useBucketOf, type MuniCenterIndex, type NearOrigin } from "../src/consult/stats";
import type { HistoryCase } from "../src/types";
import { findWordingViolations } from "../src/wording";

let n = 0;
function h(over: Partial<HistoryCase> = {}): HistoryCase {
  n += 1;
  return {
    season: 2024, no: n, prefCode: "33", muniCode: "33214", muniNameThen: "町", date: "2024-12-10", birdUse: "採卵鶏",
    housing: null, headCount: 1000, sourceUrl: "https://www.maff.go.jp/x.pdf", related: false, ...over,
  };
}

describe("parseStatsQuery", () => {
  it("知っている数え方・県のコード・整数のシーズンだけを通す。項目がないのは null と同じ", () => {
    expect(parseStatsQuery({ groupBy: "season", season: null, prefCode: "33" })).toEqual({ groupBy: "season", season: null, prefCode: "33" });
    expect(parseStatsQuery({ groupBy: "pref" })).toEqual({ groupBy: "pref", season: null, prefCode: null });
    expect(parseStatsQuery(null)).toBeNull();
    expect(parseStatsQuery({ groupBy: "city", season: null, prefCode: null })).toBeNull();
    expect(parseStatsQuery({ groupBy: "pref", season: 2024.5, prefCode: null })).toBeNull();
    expect(parseStatsQuery({ groupBy: "pref", season: "2024", prefCode: null })).toBeNull();
    expect(parseStatsQuery({ groupBy: "pref", season: null, prefCode: "48" })).toBeNull();
    expect(parseStatsQuery({ groupBy: "pref", season: null, prefCode: "__proto__" })).toBeNull();
    expect(parseStatsQuery(["pref"])).toBeNull();
  });

  it("近くの町（near）は県で絞らない。Claude が県を入れても null に直す", () => {
    expect(STATS_GROUP_BYS).toContain("near");
    expect(parseStatsQuery({ groupBy: "near", season: 2025, prefCode: "33" })).toEqual({ groupBy: "near", season: 2025, prefCode: null });
    expect(parseStatsQuery({ groupBy: "near" })).toEqual({ groupBy: "near", season: null, prefCode: null });
    expect(parseStatsQuery({ groupBy: "near", season: 2025.5, prefCode: null })).toBeNull();
  });
});

describe("computeStats", () => {
  it("関連農場は数えない。県を指定して県で分けると聞かれたら、その県をシーズンで分ける", () => {
    const rows = [h({ season: 2024 }), h({ season: 2024 }), h({ season: 2022 }), h({ season: 2024, related: true }), h({ prefCode: "31" })];
    const s = computeStats(rows, { groupBy: "pref", season: null, prefCode: "33" });
    expect(s.query.groupBy).toBe("season");
    expect(s.title).toBe("岡山県の発生（シーズンごと）");
    expect(s.total).toBe(3);
    expect(s.rows).toHaveLength(6);
    expect(s.rows.find((r) => r.label === "2024 年 6 月〜2025 年 5 月")!.count).toBe(2);
    expect(s.rows.find((r) => r.label === "2020 年 6 月〜2021 年 5 月")!.count).toBe(0);
    expect(s.summary).toBe("岡山県の過去 6 シーズン（2020 年 6 月〜2026 年 5 月）の発生は 3 件です。いちばん多いのは 2024 年 6 月〜2025 年 5 月の 2 件です。");
  });

  it("県で分けると多い順、同じ数は県のコード順。上限を超えた県は「ほか」にまとめる。題にシーズンが入る", () => {
    const rows: HistoryCase[] = [];
    // 3 件 × 3 県、2 件 × 7 県、1 件 × 2 県 = 25 件（10 行目は 2 件、11 行目は 1 件で、境目で同じ件数が割れない）
    const counts = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1];
    counts.forEach((c, i) => {
      for (let k = 0; k < c; k++) rows.push(h({ prefCode: String(i + 1).padStart(2, "0") }));
    });
    const s = computeStats(rows, { groupBy: "pref", season: 2024, prefCode: null });
    expect(s.title).toBe("全国の発生（2024 年 6 月〜2025 年 5 月・都道府県ごと）");
    expect(s.rows[0]).toEqual({ label: "北海道", count: 3 });
    expect(s.rows).toHaveLength(STATS_MAX_PREF_ROWS);
    expect(s.rest).toEqual({ rows: 2, count: 2 });
    expect(s.total).toBe(25);
    expect(s.summary).toBe("全国の 2024 年 6 月〜2025 年 5 月のシーズンの発生は 25 件です。");
  });

  it("10 行の境目で同じ件数の県が割れるときは、その件数の県をまとめて「ほか」に入れる。全部が同じ件数なら全部出す", () => {
    const rows: HistoryCase[] = [];
    rows.push(h({ prefCode: "12" }), h({ prefCode: "12" }));
    for (let i = 1; i <= STATS_MAX_PREF_ROWS + 2; i++) if (i !== 12) rows.push(h({ prefCode: String(i).padStart(2, "0") }));
    const s = computeStats(rows, { groupBy: "pref", season: 2024, prefCode: null });
    expect(s.rows).toEqual([{ label: "千葉県", count: 2 }]);
    expect(s.rest).toEqual({ rows: STATS_MAX_PREF_ROWS + 1, count: STATS_MAX_PREF_ROWS + 1 });
    const flat: HistoryCase[] = [];
    for (let i = 1; i <= STATS_MAX_PREF_ROWS + 2; i++) flat.push(h({ prefCode: String(i).padStart(2, "0") }));
    const all = computeStats(flat, { groupBy: "pref", season: 2024, prefCode: null });
    expect(all.rows).toHaveLength(STATS_MAX_PREF_ROWS + 2);
    expect(all.rest).toBeNull();
  });

  it("「いちばん多い」は 2 件以上で、ほかの行にも分かれていて、記載なしでないときだけ", () => {
    expect(computeStats([h({ birdUse: "採卵鶏" })], { groupBy: "use", season: null, prefCode: null }).summary).not.toContain("いちばん多い");
    expect(computeStats([h(), h()], { groupBy: "use", season: null, prefCode: null }).summary).not.toContain("いちばん多い");
    expect(computeStats([h({ birdUse: null }), h({ birdUse: null }), h()], { groupBy: "use", season: null, prefCode: null }).summary).not.toContain("いちばん多い");
    expect(computeStats([h(), h(), h({ birdUse: "肉用鶏" })], { groupBy: "use", season: null, prefCode: null }).summary).toContain("いちばん多いのは採卵鶏の 2 件です。");
  });

  it("一覧の範囲の外のシーズンの事例は、絞らないときも数えない（後から足されても合計と行が食い違わない）", () => {
    const s = computeStats([h({ season: 2024 }), h({ season: 2026 }), h({ season: 2019 })], { groupBy: "season", season: null, prefCode: null });
    expect(s.total).toBe(1);
    expect(s.rows.reduce((a, r) => a + r.count, 0)).toBe(1);
  });

  it("月で分けると 12 か月を 0 件も含めて、シーズンの並び（6 月から）で出す（データで探すと同じ）", () => {
    const s = computeStats([h({ date: "2024-11-01" }), h({ date: "2025-01-03" }), h({ date: "2024-07-01" })], { groupBy: "month", season: null, prefCode: null });
    expect(s.rows.map((r) => r.label)).toEqual(["6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月", "1 月", "2 月", "3 月", "4 月", "5 月"]);
    expect(s.rows.find((r) => r.label === "6 月")!.count).toBe(0);
    expect(s.rows.find((r) => r.label === "11 月")!.count).toBe(1);
  });

  it("飼っている鳥は 4 つにまとめ、記載なしは別の行", () => {
    const s = computeStats(
      [h({ birdUse: "採卵鶏" }), h({ birdUse: "肉用種鶏" }), h({ birdUse: "あひる(あいがも)" }), h({ birdUse: "うずら" }), h({ birdUse: null })],
      { groupBy: "use", season: null, prefCode: null },
    );
    expect(s.rows).toEqual([
      { label: "採卵鶏", count: 1 },
      { label: "肉用鶏", count: 1 },
      { label: "あひる", count: 1 },
      { label: "その他", count: 1 },
      { label: "記載なし", count: 1 },
    ]);
    expect(useBucketOf("採卵鶏、だちょう(エミュー)")).toBe("採卵鶏");
  });

  it("いちばん多い行が 2 つ以上あるとき・0 件のときは「いちばん多いのは」を書かない", () => {
    const tie = computeStats([h({ season: 2023 }), h({ season: 2024 })], { groupBy: "season", season: null, prefCode: null });
    expect(tie.summary).not.toContain("いちばん多い");
    const zero = computeStats([], { groupBy: "season", season: null, prefCode: "47" });
    expect(zero.total).toBe(0);
    expect(zero.summary).toBe("沖縄県の過去 6 シーズン（2020 年 6 月〜2026 年 5 月）の発生は 0 件です。");
  });

  it("一覧の外のシーズン（今季など）は数えず、地図へ案内する", () => {
    const s = computeStats([h()], { groupBy: "pref", season: 2026, prefCode: null });
    expect(s.outOfRange).toBe(true);
    expect(s.rows).toEqual([]);
    expect(s.summary).toContain("今季の発生は、地図で見てください。");
  });

  it("本物の一覧で、シーズンごとの件数が国の発表の数（52、25、84、11、51、24）と同じ", () => {
    const file = path.resolve(import.meta.dirname, "../../data/history/cases.json");
    const all = JSON.parse(fs.readFileSync(file, "utf8")) as HistoryCase[];
    const s = computeStats(all, { groupBy: "season", season: null, prefCode: null });
    expect(s.rows.map((r) => r.count)).toEqual([52, 25, 84, 11, 51, 24]);
    expect(s.total).toBe(247);
  });

  it("表の文に禁句・あおる語がない（0 件のときも）", () => {
    for (const q of [
      { groupBy: "season", season: null, prefCode: "47" },
      { groupBy: "pref", season: 2024, prefCode: null },
      { groupBy: "month", season: null, prefCode: null },
      { groupBy: "use", season: 2026, prefCode: null },
    ] as const) {
      const s = computeStats([h()], q);
      expect(findWordingViolations([s.title, s.summary, ...s.rows.map((r) => r.label)].join("\n"))).toEqual([]);
    }
  });
});

describe("computeStats の near（農場の町の中心から約 60 km 以内の町の事例の一覧）", () => {
  const MUNI = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/geo/muni-index.json"), "utf8")) as MuniCenterIndex;
  const HISTORY = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../data/history/cases.json"), "utf8")) as HistoryCase[];
  const ORIGIN: NearOrigin = { muniCode: "33643", town: "岡山県西粟倉村", index: MUNI };
  /** 中心が [経度, 緯度] の見本の索引。緯度 1 度は約 111 km */
  const index: MuniCenterIndex = {
    "33001": { center: [134, 35] },
    "33002": { center: [134, 35.2] }, // 約 22 km
    "33003": { center: [134, 35.53] }, // 約 59 km
    "33004": { center: [134, 35.55] }, // 約 61 km
  };
  const origin: NearOrigin = { muniCode: "33001", town: "岡山県見本町", index };

  it("本物の一覧で、西粟倉村の去年のシーズン（2025）は 3 件。新しい順で、日付・場所・用途・羽数・距離・資料を出す", () => {
    const s = computeStats(HISTORY, { groupBy: "near", season: 2025, prefCode: null }, ORIGIN);
    expect(s.outOfRange).toBe(false);
    expect(s.total).toBe(3);
    expect(s.near!.noFarm).toBe(false);
    expect(s.near!.rows.map((r) => [r.date, r.place, r.use, r.headCount, r.distance])).toEqual([
      ["2026年1月8日", "兵庫県姫路市", "採卵鶏", "155,000 羽", "約 44 km"],
      ["2025年12月20日", "岡山県津山市", "採卵鶏", "430,000 羽", "約 32 km"],
      ["2025年12月16日", "兵庫県姫路市", "採卵鶏", "240,000 羽", "約 44 km"],
    ]);
    expect(s.near!.rows.every((r) => r.sourceUrl.startsWith("https://www.maff.go.jp/"))).toBe(true);
    expect(s.title).toBe("岡山県西粟倉村から約 60 km 以内の町の発生（2025 年 6 月〜2026 年 5 月）");
    expect(s.summary).toBe(
      "岡山県西粟倉村の中心から約 60 km 以内の町で、2025 年のシーズン（2025年6月〜2026年5月）に起きた発生は 3 件です。距離は町の中心どうしの目安です。",
    );
    // 件数の表の項目は空（画面は near の一覧だけを出す）
    expect(s.rows).toEqual([]);
    expect(s.labelHeader).toBe("");
    expect(s.rest).toBeNull();
  });

  it("本物の一覧で、シーズンを絞らなければ過去 6 シーズンの 8 件", () => {
    const s = computeStats(HISTORY, { groupBy: "near", season: null, prefCode: null }, ORIGIN);
    expect(s.total).toBe(8);
    expect(s.near!.rows.at(-1)!.place).toBe("岡山県美作市");
    expect(s.summary).toBe(
      "岡山県西粟倉村の中心から約 60 km 以内の町で、過去 6 シーズン（2020年6月〜2026年5月）に起きた発生は 8 件です。距離は町の中心どうしの目安です。",
    );
  });

  it("60 km の判定は丸める前の距離。関連農場と範囲の外のシーズンは入れない。同じ町は「同じ町」、記載なしの羽数は「記載なし」", () => {
    const rows = [
      h({ muniCode: "33002", muniNameThen: "二町", date: "2024-12-01" }),
      h({ muniCode: "33003", muniNameThen: "三町", date: "2025-01-05", headCount: null }),
      h({ muniCode: "33004", muniNameThen: "四町", date: "2025-01-06" }),
      h({ muniCode: "33001", muniNameThen: "見本町", date: "2024-11-03", birdUse: "あひる(あいがも)" }),
      h({ muniCode: "33002", muniNameThen: "二町", date: "2024-12-02", related: true }),
      h({ muniCode: "33002", muniNameThen: "二町", date: "2026-12-02", season: 2026 }),
      h({ muniCode: "99999", muniNameThen: "索引にない町", date: "2024-12-03" }),
    ];
    const s = computeStats(rows, { groupBy: "near", season: null, prefCode: null }, origin);
    expect(s.near!.rows.map((r) => [r.date, r.place, r.use, r.headCount, r.distance])).toEqual([
      ["2025年1月5日", "岡山県三町", "採卵鶏", "記載なし", "約 59 km"],
      ["2024年12月1日", "岡山県二町", "採卵鶏", "1,000 羽", "約 22 km"],
      ["2024年11月3日", "岡山県見本町", "あひる(あいがも)", "1,000 羽", "同じ町"],
    ]);
    expect(s.total).toBe(3);
  });

  it("一覧は新しい順の先頭 20 件まで。残りは more に数え、上の文の件数は全体の件数のまま", () => {
    const many = Array.from({ length: 23 }, (_, i) => h({ muniCode: "33002", muniNameThen: "二町", date: `2024-12-${String(i + 1).padStart(2, "0")}` }));
    const s = computeStats(many, { groupBy: "near", season: 2024, prefCode: null }, origin);
    expect(STATS_MAX_NEAR_ROWS).toBe(20);
    expect(s.total).toBe(23);
    expect(s.near!.rows).toHaveLength(20);
    expect(s.near!.more).toBe(3);
    expect(s.near!.rows[0]!.date).toBe("2024年12月23日");
    expect(s.near!.rows.at(-1)!.date).toBe("2024年12月4日");
    expect(s.summary).toContain("に起きた発生は 23 件です。");
    // 20 件ちょうどなら more は 0
    expect(computeStats(many.slice(0, 20), { groupBy: "near", season: 2024, prefCode: null }, origin).near!.more).toBe(0);
  });

  it("0 件のときは「ありませんでした」で、距離の断りを付けない", () => {
    const s = computeStats([h({ muniCode: "33004" })], { groupBy: "near", season: 2024, prefCode: null }, origin);
    expect(s.total).toBe(0);
    expect(s.near!.rows).toEqual([]);
    expect(s.summary).toBe("岡山県見本町の中心から約 60 km 以内の町で、2024 年のシーズン（2024年6月〜2025年5月）に起きた発生はありませんでした。");
  });

  it("条件（町）がないときは一覧を作らず決まった文。今季は件数の表と同じく一覧の外として地図へ案内する", () => {
    const none = computeStats(HISTORY, { groupBy: "near", season: 2025, prefCode: null }, null);
    expect(none.summary).toBe(NEAR_NO_FARM_TEXT);
    expect(none.summary).toBe("近くの町の発生は、『登録した農場の情報で相談する』を選ぶと答えられます。地図の『過去の発生』でも見られます。");
    expect(none.near).toEqual({ rows: [], more: 0, noFarm: true });
    expect(none.total).toBe(0);
    const current = computeStats(HISTORY, { groupBy: "near", season: 2026, prefCode: null }, ORIGIN);
    expect(current.outOfRange).toBe(true);
    expect(current.near).toEqual({ rows: [], more: 0, noFarm: false });
    expect(current.summary).toContain("今季の発生は、地図で見てください。");
  });

  it("日付と距離の書き方", () => {
    expect(nearDateText("2025-12-09")).toBe("2025年12月9日");
    expect(nearDistanceText(24.6, false)).toBe("約 25 km");
    expect(nearDistanceText(0.4, false)).toBe("約 1 km 未満");
    expect(nearDistanceText(0, true)).toBe("同じ町");
  });

  it("一覧の文に禁句・あおる語がない（0 件・条件なし・今季のときも）", () => {
    const cases: [number | null, NearOrigin | null][] = [[2025, ORIGIN], [null, ORIGIN], [2024, origin], [2025, null], [2026, ORIGIN]];
    for (const [season, o] of cases) {
      const s = computeStats(o === origin ? [h({ muniCode: "33004" })] : HISTORY, { groupBy: "near", season, prefCode: null }, o);
      const texts = [s.title, s.summary, ...(s.near?.rows ?? []).flatMap((r) => [r.date, r.place, r.use, r.headCount, r.distance])];
      expect(findWordingViolations(texts.join("\n"))).toEqual([]);
    }
  });
});
