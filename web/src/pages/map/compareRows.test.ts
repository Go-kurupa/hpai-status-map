import type { Case, HistoryCase } from "@hpai/shared/types";
import { describe, expect, it } from "vitest";
import { rowsOf } from "./CompareOverlay";

const hist = (o: Partial<HistoryCase>): HistoryCase => ({
  season: 2025,
  no: 1,
  prefCode: "33",
  muniCode: "33203",
  muniNameThen: "津山市",
  date: "2025-12-20",
  birdUse: "採卵鶏",
  housing: "ケージ飼い",
  headCount: 430000,
  sourceUrl: "https://www.maff.go.jp/x.pdf",
  related: false,
  ...o,
});
const nowCase = (o: Partial<Case>): Case =>
  ({
    id: "c1",
    season: 2026,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    negation: "none",
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/now"],
    ...o,
  }) as unknown as Case;

describe("rowsOf（比べの欄の事例）", () => {
  const history = [hist({}), hist({ no: 2, date: "2026-01-10" }), hist({ no: 3, related: true }), hist({ season: 2024, no: 4 }), hist({ no: 5, muniCode: "33214" })];
  const currentCases = [
    nowCase({}),
    nowCase({ id: "neg", negation: "negated" } as Partial<Case>),
    nowCase({ id: "rev", confirmState: "reviewing" } as Partial<Case>),
    nowCase({ id: "b", stages: { confirmed: { date: "2026-11-03", time: null } } } as Partial<Case>),
  ];
  const p = { current: 2026, currentCases, history };

  it("今季は件数に数える事例だけ（否定・確認中を除く）。新しい順で、資料は最初のリンク", () => {
    const rows = rowsOf(2026, "33203", p)!;
    expect(rows.map((r) => r.key)).toEqual(["b", "c1"]);
    expect(rows[0]!.url).toBe("https://example.invalid/now");
  });

  it("過去はそのシーズンの国の事例一覧から関連農場を除く。ほかの町とほかのシーズンは入れない。新しい順", () => {
    const rows = rowsOf(2025, "33203", p)!;
    expect(rows.map((r) => r.key)).toEqual(["2025-2", "2025-1"]);
    expect(rowsOf(2024, "33203", p)!.map((r) => r.key)).toEqual(["2024-4"]);
  });

  it("読み込めていなければ null（記録がないとは言わない）", () => {
    expect(rowsOf(2026, "33203", { ...p, currentCases: null })).toBeNull();
    expect(rowsOf(2025, "33203", { ...p, history: null })).toBeNull();
    expect(rowsOf(2026, "33203", { ...p, history: null })).not.toBeNull();
  });
});
