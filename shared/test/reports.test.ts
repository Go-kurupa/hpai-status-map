// M-04: 報告文と CSV の組み立て（設計書 §8）。送らず、保存せず、文を作るだけ。
import { describe, expect, it } from "vitest";
import {
  buildSelfCheckReport,
  buildWeeklyDeathReport,
  checksToCsv,
  DISINFECTION_LABELS,
  deathsToCsv,
  SELF_CHECK_ITEMS,
  SELF_CHECK_SOURCE_NOTE,
} from "../src/reports";
import type { CheckRecord, DeathRecord, House, SelfCheckItemNo } from "../src/types";
import { findForbiddenPhrases } from "../src/wording";

type H = House & { id: string };
const house = (id: string, name: string, birdType: string, flockSize: number, empty = false): H => ({
  id,
  name,
  birdType,
  flockSize,
  empty,
});
const death = (date: string, houseId: string, deaths: number, over: Partial<DeathRecord> = {}): DeathRecord => ({
  date,
  houseId,
  deaths,
  flockSizeAt: 100,
  exclusion: null,
  ...over,
});

const ALL_OK: Record<SelfCheckItemNo, "ok" | "ng" | null> = {
  "17": "ok",
  "18": "ok",
  "19": "ok",
  "22": "ok",
  "23": "ok",
  "25": "ok",
  "27": "ok",
};

describe("自己点検の項目", () => {
  it("7 項目で、番号は基準の 17、18、19、22、23、25、27", () => {
    expect(SELF_CHECK_ITEMS.map((i) => i.no)).toEqual(["17", "18", "19", "22", "23", "25", "27"]);
  });
  it("出典の注意書きは索引 Q12 の既定のまま", () => {
    expect(SELF_CHECK_SOURCE_NOTE).toBe("ある家畜保健衛生所の様式の例です。項目と期限は県や家畜保健衛生所で違います");
  });
});

describe("buildSelfCheckReport", () => {
  it("19 が ng、27 が null の報告文は決められた行のまま", () => {
    const text = buildSelfCheckReport({
      farmName: "見本農場",
      month: "2026-11",
      answers: { ...ALL_OK, "19": "ng", "27": null },
    });
    expect(text.split("\n")).toEqual([
      "自己点検の報告",
      "農場名: 見本農場",
      "対象の月: 2026年11月",
      "17 衛生管理区域に立ち入る者の手指消毒等: ○",
      "18 衛生管理区域専用の衣服及び靴の設置並びに使用: ○",
      "19 衛生管理区域に立ち入る車両の消毒等: ×",
      "22 家きん舎に立ち入る者の手指消毒等: ○",
      "23 家きん舎ごとの専用の靴の設置及び使用: ○",
      "25 野生動物の侵入防止のためのネット等の設置、点検及び修繕: ○",
      "27 ねずみ及び害虫の駆除: 未記入",
    ]);
  });

  it("農場名が空なら『農場名: 未記入』", () => {
    const text = buildSelfCheckReport({ farmName: "  ", month: "2026-01", answers: ALL_OK });
    expect(text.split("\n")[1]).toBe("農場名: 未記入");
    expect(text.split("\n")[2]).toBe("対象の月: 2026年1月");
  });

  it("答えのキーが欠けていても未記入になる（落ちない）", () => {
    const text = buildSelfCheckReport({
      farmName: "A",
      month: "2026-11",
      answers: {} as Record<SelfCheckItemNo, "ok" | "ng" | null>,
    });
    expect(text.split("\n").filter((l) => l.endsWith(": 未記入")).length).toBe(7);
  });

  it("禁止語を含まない", () => {
    expect(findForbiddenPhrases(buildSelfCheckReport({ farmName: "A", month: "2026-11", answers: ALL_OK }))).toEqual([]);
  });
});

describe("buildWeeklyDeathReport", () => {
  const houses: H[] = [
    house("h1", "1 号舎", "採卵", 1000),
    house("h2", "2 号舎", "採卵", 500),
    house("h3", "肉用舎", "肉用", 300),
    house("h4", "空き舎", "採卵", 900, true),
  ];
  const base = {
    farmName: "見本農場",
    weekStart: "2026-11-02",
    houses,
    extras: { culledShipped: null, introduced: null, healthNote: "", mortalityNote: "" },
  };

  it("採卵の飼養羽数は空舎を除いて 1500。同じ日の 1 羽と 2 羽は 3。記録のない日は未入力、合計は入力のある日だけ", () => {
    const text = buildWeeklyDeathReport({
      ...base,
      records: [death("2026-11-02", "h1", 1), death("2026-11-02", "h2", 2), death("2026-11-04", "h1", 0), death("2026-11-04", "h2", 0)],
    });
    const lines = text.split("\n");
    const at = lines.indexOf("鳥の種類: 採卵");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at, at + 12)).toEqual([
      "鳥の種類: 採卵",
      "飼養羽数: 1500",
      "日別の死亡羽数",
      "11月2日: 3",
      "11月3日: 未入力",
      "11月4日: 0",
      "11月5日: 未入力",
      "11月6日: 未入力",
      "11月7日: 未入力",
      "11月8日: 未入力",
      "合計: 3",
      "",
    ]);
  });

  it("肉用は別の節になり、記録が 1 日もなければ合計は 0 ではなく未入力", () => {
    const text = buildWeeklyDeathReport({ ...base, records: [death("2026-11-02", "h1", 1)] });
    const lines = text.split("\n");
    const at = lines.indexOf("鳥の種類: 肉用");
    expect(lines[at + 1]).toBe("飼養羽数: 300");
    expect(lines.slice(at + 3, at + 10).every((l) => l.endsWith(": 未入力"))).toBe(true);
    expect(lines[at + 10]).toBe("合計: 未入力");
  });

  it("週の外の日と、知らない鶏舎の記録は数えない", () => {
    const text = buildWeeklyDeathReport({
      ...base,
      records: [death("2026-11-01", "h1", 9), death("2026-11-09", "h1", 9), death("2026-11-03", "zzz", 9)],
    });
    expect(text).not.toContain(": 9");
    expect(text).toContain("合計: 未入力");
  });

  it("順は種類、飼養羽数、日別、合計、廃鶏出荷、導入、健康状態、死亡率の特記事項。null は未記入。入力者は出ない", () => {
    const text = buildWeeklyDeathReport({ ...base, records: [] });
    const labels = ["鳥の種類", "飼養羽数", "日別の死亡羽数", "合計", "廃鶏出荷羽数", "導入羽数", "健康状態の特記事項", "死亡率の変動や偏りの特記事項"];
    const idx = labels.map((l) => text.indexOf(l));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(text).toContain("廃鶏出荷羽数: 未記入");
    expect(text).toContain("導入羽数: 未記入");
    expect(text).toMatch(/健康状態の特記事項[^\n]*: 未記入/);
    expect(text).toContain("死亡率の変動や偏りの特記事項: 未記入");
    expect(text).not.toMatch(/入力者|createdBy|uid/);
    expect(text).toContain("農場名: 見本農場");
  });

  it("入れた値は写す。0 は『未記入』ではなく 0", () => {
    const text = buildWeeklyDeathReport({
      ...base,
      records: [],
      extras: { culledShipped: 0, introduced: 50, healthNote: "産卵率は横ばい", mortalityNote: "2 号舎にやや偏り" },
    });
    expect(text).toContain("廃鶏出荷羽数: 0");
    expect(text).toContain("導入羽数: 50");
    expect(text).toContain("産卵率は横ばい");
    expect(text).toContain("2 号舎にやや偏り");
  });

  it("鶏舎がないときも落ちず、禁止語を含まない", () => {
    const text = buildWeeklyDeathReport({ ...base, houses: [], records: [] });
    expect(text).toContain("農場名: 見本農場");
    expect(findForbiddenPhrases(text)).toEqual([]);
  });
});

describe("deathsToCsv", () => {
  const houses: H[] = [house("h1", "1 号舎", "採卵", 100)];
  it("BOM、CRLF、ヘッダー、除外の理由は言葉", () => {
    const csv = deathsToCsv([death("2026-11-02", "h1", 2, { exclusion: { kind: "equipment", note: "停電" } })], houses);
    expect(csv.startsWith("﻿日付,鶏舎,鳥の種類,飼養羽数,死亡羽数,除外の理由,メモ\r\n")).toBe(true);
    expect(csv).toContain("2026-11-02,1 号舎,採卵,100,2,設備の故障,停電");
    expect(csv.split("\r\n").length).toBe(3); // ヘッダー、1 行、末尾の空
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });
  it("除外がなければ理由とメモは空。知らない鶏舎は ID のまま", () => {
    const csv = deathsToCsv([death("2026-11-02", "gone", 0)], houses);
    expect(csv).toContain("2026-11-02,gone,,100,0,,");
  });
  it("= + - @ で始まる値の前に ' を足し、カンマ、引用符、改行は引用する", () => {
    const hs: H[] = [house("a", "=SUM(A1)", "+x", 1), house("b", "-1", "@y", 1), house("c", "a,b", "c\"d", 1)];
    const csv = deathsToCsv(
      [
        death("2026-11-02", "a", 0),
        death("2026-11-02", "b", 0),
        death("2026-11-02", "c", 0, { exclusion: { kind: "other", note: "1行目\n2行目" } }),
      ],
      hs,
    );
    expect(csv).toContain("'=SUM(A1),'+x");
    expect(csv).toContain("'-1,'@y");
    expect(csv).toContain('"a,b","c""d"');
    expect(csv).toContain('"1行目\n2行目"');
  });
  it("引用した値の先頭が = のときも ' が引用の中に入る", () => {
    const hs: H[] = [house("a", "=1,2", "採卵", 1)];
    expect(deathsToCsv([death("2026-11-02", "a", 0)], hs)).toContain(`"'=1,2"`);
  });
});

describe("checksToCsv", () => {
  it("ヘッダー、BOM、CRLF。消毒の項目は言葉にし、知らない id はそのまま", () => {
    const checks: CheckRecord[] = [
      { kind: "disinfection", date: "2026-11-02", itemId: "always-17" },
      { kind: "disinfection", date: "2026-11-02", itemId: "zone-lime" },
      { kind: "disinfection", date: "2026-11-03", itemId: "mystery-1" },
    ];
    const csv = checksToCsv(checks);
    expect(csv.startsWith("﻿日付,種類,項目,結果\r\n")).toBe(true);
    expect(csv).toContain("2026-11-02,消毒,入口の手指消毒,実施");
    expect(csv).toContain("2026-11-02,消毒,消石灰の消毒,実施");
    expect(csv).toContain("2026-11-03,消毒,mystery-1,実施");
  });
  it("DISINFECTION_LABELS は決められた 6 つ", () => {
    expect(DISINFECTION_LABELS).toEqual({
      "always-17": "入口の手指消毒",
      "always-19": "車両の消毒",
      "always-22": "鶏舎の手指消毒",
      "zone-entry": "入出場時の消毒",
      "zone-lime": "消石灰の消毒",
      "zone-inside": "鶏舎内の消毒",
    });
  });
  it("自己点検は 7 項目を 1 行ずつ。○ × 未記入", () => {
    const csv = checksToCsv([
      { kind: "self_inspection", date: "2026-11-05", month: "2026-11", answers: { ...ALL_OK, "19": "ng", "27": null } },
    ]);
    const rows = csv.split("\r\n").filter((l) => l.includes(",自己点検,"));
    expect(rows.length).toBe(7);
    expect(csv).toContain("2026-11-05,自己点検,19 衛生管理区域に立ち入る車両の消毒等（2026年11月分）,×");
    expect(csv).toContain("27 ねずみ及び害虫の駆除（2026年11月分）,未記入");
    expect(csv).toContain("17 衛生管理区域に立ち入る者の手指消毒等（2026年11月分）,○");
  });
});
