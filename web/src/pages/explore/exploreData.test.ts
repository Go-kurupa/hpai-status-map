import type { Case, HistoryCase } from "@hpai/shared/types";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countBySeason, exploreRows, filterRows, headBand, useBucket } from "./exploreData";

const hist = (o: Partial<HistoryCase>): HistoryCase => ({
  season: 2024,
  no: 1,
  prefCode: "33",
  muniCode: "33203",
  muniNameThen: "津山市",
  date: "2024-12-01",
  birdUse: "採卵鶏",
  housing: null,
  headCount: 50000,
  sourceUrl: "https://www.maff.go.jp/x.pdf",
  related: false,
  ...o,
});

const nowCase = (o: Partial<Case>): Case => ({
  id: "c1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: "採卵鶏",
  housing: null,
  headCount: 1000,
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: ["https://www.pref.example/a"],
  updatedAt: "2026-11-02T12:00:00+09:00",
  ...o,
});

describe("useBucket", () => {
  it("元の表記を 4 つにまとめる。記載なしは null", () => {
    expect(useBucket("採卵鶏等")).toBe("採卵鶏");
    expect(useBucket("育雛(肉用種鶏)")).toBe("肉用鶏");
    expect(useBucket("あひる(あいがも)")).toBe("あひる");
    expect(useBucket("うずら")).toBe("その他");
    expect(useBucket(null)).toBeNull();
  });
});

describe("headBand", () => {
  it("羽数の帯の境", () => {
    expect(headBand(999)).toBe("1,000 羽未満");
    expect(headBand(1000)).toBe("1,000〜1 万");
    expect(headBand(99999)).toBe("1 万〜10 万");
    expect(headBand(100000)).toBe("10 万以上");
    expect(headBand(null)).toBeNull();
  });
});

describe("exploreRows", () => {
  it("過去は関連農場を除き、今季は数える事例だけ。場所は県名と町", () => {
    const rows = exploreRows({
      history: [hist({}), hist({ no: 2, related: true })],
      currentCases: [nowCase({}), nowCase({ id: "c2", negation: "negated" }), nowCase({ id: "c3", muniCode: null, muniName: null })],
      current: 2026,
    });
    expect(rows.filter((r) => !r.current)).toHaveLength(1);
    expect(rows.filter((r) => r.current).map((r) => r.key)).toEqual(["c1", "c3"]);
    expect(rows.find((r) => r.key === "c1")!.place).toBe("岡山県 津山市");
    expect(rows.find((r) => r.key === "c3")!.place).toBe("岡山県");
    expect(rows.find((r) => !r.current)!.url).toBe("https://www.maff.go.jp/x.pdf");
  });
});

describe("filterRows", () => {
  it("記載なしは数えずに数だけ返す", () => {
    const rows = exploreRows({ history: [hist({})], currentCases: [nowCase({ birdUse: null, headCount: null })], current: 2026 });
    const byUse = filterRows(rows, { use: ["採卵鶏"], band: [], region: [] });
    expect(byUse.hits).toHaveLength(1);
    expect(byUse.missingUse).toBe(1);
    expect(byUse.missingBand).toBe(0);
    const byBand = filterRows(rows, { use: [], band: ["1 万〜10 万"], region: [] });
    expect(byBand.missingBand).toBe(1);
    const all = filterRows(rows, { use: [], band: [], region: [] });
    expect(all.hits).toHaveLength(2);
    expect(all.missingUse).toBe(0);
  });

  it("地方で絞る", () => {
    const rows = exploreRows({ history: [hist({}), hist({ no: 3, prefCode: "01", muniCode: "01100" })], currentCases: [], current: 2026 });
    expect(filterRows(rows, { use: [], band: [], region: ["chugoku"] }).hits.map((r) => r.prefCode)).toEqual(["33"]);
  });

  it("本物のデータで見本と同じ数", () => {
    const file = path.resolve(import.meta.dirname, "../../../../data/history/cases.json");
    const history = JSON.parse(fs.readFileSync(file, "utf8")) as HistoryCase[];
    const rows = exploreRows({ history, currentCases: [], current: 2026 });
    expect(filterRows(rows, { use: [], band: [], region: ["chugoku"] }).hits).toHaveLength(19);
    expect(filterRows(rows, { use: ["採卵鶏"], band: [], region: [] }).hits).toHaveLength(171);
    expect(filterRows(rows, { use: [], band: ["1,000 羽未満"], region: [] }).hits).toHaveLength(12);
    // 複数選んだときは、どれかに当てはまれば入る（作者 11/6 夜）
    expect(filterRows(rows, { use: ["採卵鶏", "肉用鶏"], band: [], region: [] }).hits).toHaveLength(225);
    expect(filterRows(rows, { use: [], band: [], region: ["tohoku", "kanto"] }).hits).toHaveLength(88);
  });
});

describe("countBySeason", () => {
  it("件数のないシーズンも 0 で返す", () => {
    const rows = exploreRows({ history: [hist({}), hist({ no: 2 })], currentCases: [], current: 2026 });
    expect(countBySeason(rows, [2023, 2024])).toEqual([
      { season: 2023, count: 0 },
      { season: 2024, count: 2 },
    ]);
  });
});
