import type { Case, WildBird } from "@hpai/shared/types";
import { displayStage } from "@hpai/shared/cases";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { describe, expect, it } from "vitest";
import { DETECTION_LIMIT_NOTE, listRows, WILD_ZONE_NOTE, wildBirdRows } from "./listRows";

const NOW = new Date("2026-11-20T09:00:00+09:00");

function mk(o: Partial<Case> & { id: string }): Case {
  return {
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: "採卵鶏",
    housing: "ウインドレス",
    headCount: 430000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/a"],
    updatedAt: "2026-11-02T12:00:00+09:00",
    ...o,
  };
}
const reviewing = (id: string, updatedAt = "2026-11-19T10:00:00+09:00"): Case => ({
  ...mk({ id }),
  id: `rev-${id}`,
  prefCode: "31",
  muniCode: null,
  muniName: null,
  birdUse: null,
  housing: null,
  headCount: null,
  stages: {},
  confirmState: "reviewing",
  sourceUrls: ["https://example.invalid/rev"],
  updatedAt,
});

const KEYS = ["date", "headCount", "id", "label", "muniName", "prefName", "reviewing", "sourceUrls"];

describe("listRows（新しい順、label は displayStage）", () => {
  it("新しい順（発生の日の降順）。label は displayStage(c, now).label", () => {
    const a = mk({ id: "a", stages: { confirmed: { date: "2026-11-02", time: null } } });
    const b = mk({ id: "b", stages: { confirmed: { date: "2026-11-10", time: null }, culling_done: { date: "2026-11-12", time: null } } });
    const c = mk({ id: "c", stages: { suspected: { date: "2026-11-17", time: null } } });
    const rows = listRows([a, b, c], NOW);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    for (const r of rows) {
      const src = [a, b, c].find((x) => x.id === r.id)!;
      expect(r.label).toBe(displayStage(src, NOW).label);
    }
    expect(rows[1]!.date).toBe("2026-11-10"); // 確定の日（段階が進んでも発生の日）
    expect(rows[0]!.label).toBe("続報を確認中（3 日経過）");
  });

  it("確認中は、県名、確認中、リンクだけ。市町村、日付、羽数は出さない", () => {
    const [r] = listRows([reviewing("x")], NOW);
    expect(r).toEqual({
      id: "rev-x",
      prefName: "鳥取県",
      muniName: null,
      label: "確認中",
      date: null,
      headCount: null,
      reviewing: true,
      sourceUrls: ["https://example.invalid/rev"],
    });
  });

  it("確認中は、日付がなくても並ぶ。更新の日で新しい順に混ぜる", () => {
    const a = mk({ id: "a", stages: { confirmed: { date: "2026-11-10", time: null } } });
    const rows = listRows([a, reviewing("x", "2026-11-19T10:00:00+09:00"), reviewing("y", "2026-11-05T10:00:00+09:00")], NOW);
    expect(rows.map((r) => r.id)).toEqual(["rev-x", "a", "rev-y"]);
  });

  it("どの行も同じキーだけを持つ。農場の特徴（用途、鶏舎）や不備の項目は持たない（§12）", () => {
    const rows = listRows([mk({ id: "a" }), reviewing("x")], NOW);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(KEYS);
    expect(JSON.stringify(rows)).not.toMatch(/採卵鶏|ウインドレス|birdUse|housing/);
  });

  it("否定は 7 日残り、8 日目に消える（negatedAt の JST の日で数える）", () => {
    const negated = (at: string) => mk({ id: "n", negation: "negated", negatedAt: at });
    // 11-13 に否定 → 11-20 は 7 日目（残る）、11-21 は 8 日目（消える）
    expect(listRows([negated("2026-11-13T23:50:00+09:00")], new Date("2026-11-20T00:10:00+09:00"))).toHaveLength(1);
    expect(listRows([negated("2026-11-13T23:50:00+09:00")], new Date("2026-11-20T23:59:00+09:00"))).toHaveLength(1);
    expect(listRows([negated("2026-11-13T23:50:00+09:00")], new Date("2026-11-21T00:00:00+09:00"))).toHaveLength(0);
    expect(listRows([negated("2026-11-13T09:00:00+09:00")], NOW)[0]!.label).toBe("否定されました");
  });

  it("negatedAt が読めないときは消さない（隠すより残す）", () => {
    expect(listRows([mk({ id: "n", negation: "negated", negatedAt: null })], NOW)).toHaveLength(1);
    expect(listRows([mk({ id: "n", negation: "negated", negatedAt: "xx" })], NOW)).toHaveLength(1);
  });

  it("否定の候補は残り、『否定の発表があるようです（確認中）』", () => {
    const [r] = listRows([mk({ id: "c", negation: "candidate" })], NOW);
    expect(r!.label).toBe("否定の発表があるようです（確認中）");
  });

  it("県名と市町村名。禁止語がない", () => {
    const rows = listRows([mk({ id: "a" }), reviewing("x")], NOW);
    expect(rows[1]).toMatchObject({ prefName: "岡山県", muniName: "津山市", headCount: 430000 });
    expect(findForbiddenPhrases(JSON.stringify(rows))).toEqual([]);
  });

  it("空なら空", () => {
    expect(listRows([], NOW)).toEqual([]);
  });
});

const bird = (o: Partial<WildBird> & { id: string }): WildBird => ({
  season: 2026,
  date: "2026-11-10",
  prefCode: "01",
  muniCode: "01100",
  muniName: "札幌市",
  species: "オオハクチョウ",
  test: "screening_positive",
  focusZone: { from: null, to: null },
  sourceUrl: "https://example.invalid/b",
  ...o,
});

describe("wildBirdRows", () => {
  it("否定を除き、簡易検査の陽性は『検査中』、確定は『高病原性の確定』。新しい順", () => {
    const rows = wildBirdRows([
      bird({ id: "a", date: "2026-11-01", test: "hpai_confirmed" }),
      bird({ id: "b", date: "2026-11-05", test: "negative" }),
      bird({ id: "c", date: "2026-11-09", test: "screening_positive" }),
    ]);
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ["c", "検査中"],
      ["a", "高病原性の確定"],
    ]);
    expect(rows[0]).toMatchObject({ prefName: "北海道", muniName: "札幌市", date: "2026-11-09", sourceUrl: "https://example.invalid/b" });
    expect(findForbiddenPhrases(JSON.stringify(rows))).toEqual([]);
  });
});

describe("注記", () => {
  it("定数は契約のとおり", () => {
    expect(DETECTION_LIMIT_NOTE).toBe("疑いは、県の発表を見つけられた県だけ出ます。見つけられないと、国の発表（約 1 日後）で初めて確定として載ります");
    expect(WILD_ZONE_NOTE).toBe("環境省の野鳥監視重点区域は、防疫指針の区域とは別のものです");
    expect(findForbiddenPhrases(DETECTION_LIMIT_NOTE + WILD_ZONE_NOTE)).toEqual([]);
  });
});
