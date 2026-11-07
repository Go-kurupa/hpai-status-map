// 全国の傾向の深掘りの集計（設計書 2026-11-06-trends-redesign）。作った抽出の行と事例一覧で調べる（実在の文ではない）。
// data/private/ は読まない。
import { describe, expect, it } from "vitest";
import { findWordingViolations } from "@hpai/shared/wording";
import { parseTrendInsights } from "../../web/src/pages/trends/insightsTypes";
import { REPORT_QUOTES, aggregateInsights, checkInsights, housingGroupOf, rodentSourceOf, suppressColumn, useGroupOf, type CaseRow } from "../lib/trends-insights";
import type { SurveyExtract, SurveyExtractRow } from "../lib/trends";

type St = "issue" | "no_issue" | "not_mentioned";
const item = (status: St, quote: string | null = status === "not_mentioned" ? null : "文。") => ({ status, quote });
const ex = (c: St, r: St, w: St, rq?: string, wq?: string): SurveyExtract => ({
  external_clothing: item(c),
  rodent_signs: item(r, r === "not_mentioned" ? null : (rq ?? "文。")),
  wall_net_damage: item(w, w === "not_mentioned" ? null : (wq ?? "文。")),
});

function fixture(n: number, use: string | null, housing: string | null, season = 2024, start = 1): { rows: SurveyExtractRow[]; cases: CaseRow[] } {
  const rows: SurveyExtractRow[] = [];
  const cases: CaseRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ season, no: start + i, extract: ex("issue", "issue", "issue") });
    cases.push({ season, no: start + i, birdUse: use, housing, related: false });
  }
  return { rows, cases };
}

describe("群のまとめ方", () => {
  it("用途は採卵鶏・肉用鶏・その他の 3 つ", () => {
    expect(useGroupOf("採卵鶏")).toBe("採卵鶏");
    expect(useGroupOf("採卵鶏、だちょう(エミュー)")).toBe("採卵鶏");
    expect(useGroupOf("肉用鶏")).toBe("肉用鶏");
    expect(useGroupOf("肉用種鶏")).toBe("その他");
    expect(useGroupOf(null)).toBe("その他");
  });
  it("飼い方は併用を平飼いに入れ、記載なしを分ける", () => {
    expect(housingGroupOf("ケージ飼い")).toBe("ケージ");
    expect(housingGroupOf("ケージ・平飼い")).toBe("平飼い（併用を含む）");
    expect(housingGroupOf("平飼い")).toBe("平飼い（併用を含む）");
    expect(housingGroupOf(null)).toBe("記載なし");
  });
});

describe("小さな数の伏せ", () => {
  it("5 件以上ならそのまま", () => {
    expect(suppressColumn([5, 9, 12])).toEqual([5, 9, 12]);
  });
  it("4 件以下が 1 つなら、残りの最も小さいものも伏せる（引き算で戻せないように）", () => {
    expect(suppressColumn([4, 9, 12])).toEqual([{ suppressed: true }, { suppressed: true }, 12]);
  });
  it("4 件以下が 2 つなら、その 2 つだけ伏せる", () => {
    expect(suppressColumn([0, 3, 12])).toEqual([{ suppressed: true }, { suppressed: true }, 12]);
  });
});

describe("ねずみの根拠の文の出どころ", () => {
  it("調査のときに見つかった / 農場の人の話 / どちらとも読み込めない", () => {
    expect(rodentSourceOf("調査時、鶏舎内でネズミの糞が確認された。")).toBe("survey");
    expect(rodentSourceOf("鶏舎内でネズミを時折見かけるとのこと。")).toBe("interview");
    expect(rodentSourceOf("ネズミの侵入対策は不十分。")).toBe("unclear");
  });
});

describe("aggregateInsights", () => {
  const a = fixture(10, "採卵鶏", "ケージ飼い", 2024, 1);
  const b = fixture(6, "肉用鶏", "平飼い", 2025, 1);
  const c = fixture(6, "あひる", null, 2025, 7);
  const rows = [...a.rows, ...b.rows, ...c.rows, { season: 2025, no: 99, extract: null, failure: "x" } as SurveyExtractRow];
  const cases = [...a.cases, ...b.cases, ...c.cases, { season: 2025, no: 99, birdUse: null, housing: null, related: false }];
  rows[0]!.extract = ex("no_issue", "issue", "not_mentioned", "鶏舎内でネズミを時折見かけるとのこと。", undefined);
  rows[1]!.extract = ex("not_mentioned", "issue", "issue", "調査時、ネズミの糞とかじり跡を確認した。", "金網の破損と壁の隙間が認められた。");
  const s = aggregateInsights(rows, cases, "2026-11-07T00:00:00+09:00");

  it("読み込めなかったものは数えず、あった・なかった・触れていないの和が読み込めた数になる", () => {
    expect(s.total.surveyed).toBe(22);
    for (const i of s.total.items) expect(i.issue + i.noIssue + i.notMentioned).toBe(22);
    expect(s.total.items.find((i) => i.key === "external_clothing")).toEqual({ key: "external_clothing", issue: 20, noIssue: 1, notMentioned: 1 });
    expect(s.seasons.map((x) => [x.season, x.surveyed])).toEqual([[2025, 12], [2024, 10]]);
  });

  it("語の数と出どころを数える", () => {
    const rodent = s.phrases.find((p) => p.key === "rodent_signs")!;
    expect(rodent.base).toBe(22);
    expect(rodent.words.find((w) => w.label === "ふん")!.count).toBe(1);
    expect(rodent.words.find((w) => w.label === "かじり跡")!.count).toBe(1);
    expect(rodent.words.find((w) => w.label === "姿・捕獲")!.count).toBe(1);
    expect(s.rodentSource).toEqual({ survey: 1, interview: 1, unclear: 20 });
    expect(s.phrases.some((p) => p.key === "external_clothing")).toBe(false);
  });

  it("群ごとの数を出し、公開前の検査を通る", () => {
    const use = s.groups.find((g) => g.dimension === "use")!;
    expect(use.rows.map((r) => [r.label, r.total, r.issue.rodent_signs])).toEqual([["採卵鶏", 10, 10], ["肉用鶏", 6, 6], ["その他", 6, 6]]);
    expect(checkInsights(s)).toEqual([]);
    expect(parseTrendInsights(JSON.parse(JSON.stringify(s)))).not.toBeNull();
  });

  it("事例一覧につながらない行があれば止める", () => {
    expect(() => aggregateInsights([{ season: 2024, no: 500, extract: ex("issue", "issue", "issue") }], cases)).toThrow(/つながりません/u);
  });

  it("小さな群は伏せ、検査は伏せ忘れと市町村名を見つける", () => {
    const egg = fixture(10, "採卵鶏", "ケージ飼い", 2023, 1);
    const broiler = fixture(3, "肉用鶏", "ケージ飼い", 2023, 11);
    const other = fixture(6, "あひる", "ケージ飼い", 2023, 21);
    const t = aggregateInsights([...egg.rows, ...broiler.rows, ...other.rows], [...egg.cases, ...broiler.cases, ...other.cases]);
    const use = t.groups.find((g) => g.dimension === "use")!;
    // 3 件の肉用鶏を伏せ、合計からの引き算で戻せないよう、残りで最も小さいその他（6 件）も伏せる
    expect(use.rows.map((r) => r.issue.rodent_signs)).toEqual([10, { suppressed: true }, { suppressed: true }]);
    expect(use.rows.map((r) => r.total)).toEqual([10, 3, 6]);
    expect(checkInsights(t)).toEqual([]);
    const leaked = { ...t, groups: [{ dimension: "use" as const, rows: [{ label: "x", total: 3, issue: { external_clothing: 3, rodent_signs: 3, wall_net_damage: 3 } }] }] };
    expect(checkInsights(leaked).length).toBeGreaterThan(0);
    expect(checkInsights(t, ["津山市"])).toEqual([]);
    expect(checkInsights({ ...t, reportQuotes: [{ ...REPORT_QUOTES[0]!, text: "津山市で確認された。" }] }, ["津山市"]).some((e) => e.includes("市町村名"))).toBe(true);
  });
});

describe("報告書の文の表", () => {
  it("例目や県・市町村の手がかりを含まず、禁句もない", () => {
    for (const q of REPORT_QUOTES) {
      expect(q.text).not.toMatch(/例目/u);
      expect(findWordingViolations(q.text)).toEqual([]);
      expect(q.reportUrl.startsWith("https://www.maff.go.jp/")).toBe(true);
    }
  });
});

describe("parseTrendInsights", () => {
  const s = aggregateInsights(fixture(6, "採卵鶏", "ケージ飼い").rows, fixture(6, "採卵鶏", "ケージ飼い").cases, "2026-11-07T00:00:00+09:00");
  const json = (): Record<string, unknown> => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  it("正しい形は読み込める", () => {
    expect(parseTrendInsights(json())).not.toBeNull();
  });
  it("知らないキーや市町村の手がかりのキーを拒む", () => {
    expect(parseTrendInsights({ ...json(), muniName: "x" })).toBeNull();
    const t = json();
    (t.total as { items: Record<string, unknown>[] }).items[0]!.no = 1;
    expect(parseTrendInsights(t)).toBeNull();
  });
  it("和が合わないものを拒む", () => {
    const t = json();
    (t.total as { items: { issue: number }[] }).items[0]!.issue += 1;
    expect(parseTrendInsights(t)).toBeNull();
  });
});

describe("noticingFromSummary（段階 2 の集計を画面の形に）", () => {
  it("6 シーズン合計だけを取り、値の並びは決まりの順で、記載なしを含む", async () => {
    const { NOTICING_FIELDS, NOTICING_KEYS } = await import("../lib/trends-noticing");
    const { noticingFromSummary } = await import("../lib/trends-insights");
    const fields = Object.fromEntries(
      NOTICING_KEYS.map((k) => [k, { counts: Object.fromEntries(NOTICING_FIELDS[k].map((v, i) => [v, i === 0 ? 7 : v === "not_mentioned" ? 2 : 0])), unverified: 1 }]),
    );
    const n = noticingFromSummary({ total: { caseCount: 12, read: 10, failed: 0, fields } } as never);
    expect(n.read).toBe(10);
    expect(n.fields.map((f) => f.key)).toEqual(NOTICING_KEYS);
    const first = n.fields[0]!;
    expect(first.values[0]).toEqual({ key: "mass_death", label: "まとまった死亡・急な大量死", count: 7 });
    expect(first.values.at(-1)).toEqual({ key: "not_mentioned", label: "記載なし", count: 2 });
    expect(parseTrendInsights(JSON.parse(JSON.stringify({ ...aggregateInsights(fixture(10, "採卵鶏", "ケージ飼い").rows, fixture(10, "採卵鶏", "ケージ飼い").cases), noticing: n })))).not.toBeNull();
  });
});
