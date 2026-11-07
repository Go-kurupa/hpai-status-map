// AIに対策を相談: 発生の件数の表（stats.ts）。数え方は関連農場を除き、シーズンは 6 月〜翌 5 月。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATS_MAX_PREF_ROWS, computeStats, parseStatsQuery, useBucketOf } from "../src/consult/stats";
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
