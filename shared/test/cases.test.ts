import { describe, expect, it } from "vitest";
import {
  applyRead,
  caseIdOf,
  displayStage,
  isStalledSuspect,
  latestStage,
  makeReviewingCase,
  matchCase,
  nextCaseId,
} from "../src/cases";
import type { NormalizedRead } from "../src/read/types";
import type { Case, StageDates } from "../src/types";

function mk(id: string, o: Partial<Case> = {}): Case {
  return {
    id,
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: {},
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2025-12-20T10:00:00+09:00",
    ...o,
  };
}
const st = (date: string, time: string | null = null) => ({ date, time });

function nr(o: Partial<NormalizedRead> = {}): NormalizedRead {
  return {
    kind: "confirmed",
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    nationalNo: null,
    prefNo: null,
    birdUse: null,
    housing: null,
    headCount: null,
    primaryStage: null,
    primaryStamp: null,
    stages: {},
    radiiKm: [],
    estimates: { shipment: null, movement: null, surveillance: null },
    negationBasis: null,
    yearCompleted: false,
    wildBirds: [],
    ...o,
  };
}

const NOW = new Date("2025-12-22T03:00:00Z"); // 12/22 12:00 JST

describe("caseIdOf / nextCaseId", () => {
  it("caseIdOf は muniCode-firstDate-seq", () => {
    expect(caseIdOf("33203", "2025-12-20", 1)).toBe("33203-2025-12-20-1");
  });

  it("既存がなければ連番 1", () => {
    expect(nextCaseId("33203", "2025-12-20", [])).toBe("33203-2025-12-20-1");
  });

  it("同じ市町村、同じ日の 2 件目は -2", () => {
    const existing = [mk("33203-2025-12-20-1")];
    expect(nextCaseId("33203", "2025-12-20", existing)).toBe("33203-2025-12-20-2");
  });

  it("別の日、別の市町村、過去の事例の id は数えない。欠番があっても最大の次", () => {
    const existing = [mk("33203-2025-12-19-1"), mk("33202-2025-12-20-1"), mk("h2025-1"), mk("33203-2025-12-20-3")];
    expect(nextCaseId("33203", "2025-12-20", existing)).toBe("33203-2025-12-20-4");
  });
});

describe("makeReviewingCase", () => {
  it("決められた欄以外は null か空", () => {
    const c = makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "https://example.test/a" }, NOW);
    expect(c).toEqual({
      id: "rev-d1",
      season: 2025,
      nationalNo: null,
      prefNo: null,
      prefCode: "33",
      muniCode: null,
      muniName: null,
      birdUse: null,
      housing: null,
      headCount: null,
      stages: {},
      radiiKm: [],
      prefEstimates: { shipment: null, movement: null, surveillance: null },
      negation: "none",
      negatedAt: null,
      confirmState: "reviewing",
      sourceUrls: ["https://example.test/a"],
      updatedAt: "2025-12-22T12:00:00+09:00",
    });
  });
});

describe("latestStage", () => {
  it("段階がなければ null", () => {
    expect(latestStage(mk("a"))).toBeNull();
  });
  it("疑い、確定、殺処分、完了の順に進む", () => {
    expect(latestStage(mk("a", { stages: { suspected: st("2025-12-19") } }))).toBe("suspected");
    expect(latestStage(mk("a", { stages: { suspected: st("2025-12-19"), confirmed: st("2025-12-20") } }))).toBe("confirmed");
    expect(latestStage(mk("a", { stages: { confirmed: st("2025-12-20"), culling_done: st("2025-12-21") } }))).toBe("culling_done");
    expect(latestStage(mk("a", { stages: { culling_done: st("2025-12-21"), control_done: st("2025-12-22") } }))).toBe("control_done");
  });
  it("搬出と移動の両方で movement_lifted、監視強化があれば surveillance_lifted", () => {
    const base: StageDates = { confirmed: st("2025-12-20"), control_done: st("2025-12-30") };
    expect(latestStage(mk("a", { stages: { ...base, shipment_lifted: st("2026-01-05") } }))).toBe("shipment_lifted");
    expect(latestStage(mk("a", { stages: { ...base, shipment_lifted: st("2026-01-05"), movement_lifted: st("2026-01-10") } }))).toBe("movement_lifted");
    expect(
      latestStage(mk("a", { stages: { ...base, shipment_lifted: st("2026-01-05"), movement_lifted: st("2026-01-10"), surveillance_lifted: st("2026-01-28") } })),
    ).toBe("surveillance_lifted");
  });
});

describe("isStalledSuspect", () => {
  const c = mk("a", { stages: { suspected: st("2025-12-19") } });
  it("疑い 12/19 は 12/21 false、12/22 true", () => {
    expect(isStalledSuspect(c, new Date("2025-12-21T03:00:00Z"))).toBe(false);
    expect(isStalledSuspect(c, new Date("2025-12-22T03:00:00Z"))).toBe(true);
  });
  it("日本時間の暦日で数える（UTC 12/21 20:00 は JST 12/22 05:00）", () => {
    expect(isStalledSuspect(c, new Date("2025-12-21T20:00:00Z"))).toBe(true);
  });
  it("確定があれば false。疑いがなければ false。否定が確定していれば false", () => {
    expect(isStalledSuspect(mk("a", { stages: { suspected: st("2025-12-19"), confirmed: st("2025-12-20") } }), NOW)).toBe(false);
    expect(isStalledSuspect(mk("a", { stages: { confirmed: st("2025-12-20") } }), NOW)).toBe(false);
    expect(isStalledSuspect(mk("a", { stages: { suspected: st("2025-12-19") }, negation: "negated" }), NOW)).toBe(false);
  });
});

describe("displayStage", () => {
  it("12/19 の疑いを 12/22 に見ると続報を確認中（3 日経過）", () => {
    const c = mk("a", { stages: { suspected: st("2025-12-19") } });
    expect(displayStage(c, NOW)).toEqual({ label: "続報を確認中（3 日経過）", stalledDays: 3 });
  });
  it("12/21 なら疑い。stalledDays は null", () => {
    const c = mk("a", { stages: { suspected: st("2025-12-19") } });
    expect(displayStage(c, new Date("2025-12-21T03:00:00Z"))).toEqual({ label: "疑い", stalledDays: null });
  });
  it("否定の候補、否定、確認中", () => {
    const stages = { suspected: st("2025-12-19") };
    expect(displayStage(mk("a", { stages, negation: "candidate" }), NOW)).toEqual({
      label: "否定の発表があるようです（確認中）",
      stalledDays: null,
    });
    expect(displayStage(mk("a", { stages, negation: "negated" }), NOW)).toEqual({ label: "否定されました", stalledDays: null });
    expect(displayStage(makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "u" }, NOW), NOW)).toEqual({
      label: "確認中",
      stalledDays: null,
    });
  });
  it("段階ごとの言葉。最新の段階を出す", () => {
    const labelOf = (stages: StageDates) => displayStage(mk("a", { stages }), NOW).label;
    expect(labelOf({ suspected: st("2025-12-19"), confirmed: st("2025-12-20") })).toBe("確定");
    expect(labelOf({ confirmed: st("2025-12-20"), culling_done: st("2025-12-21") })).toBe("殺処分の完了");
    expect(labelOf({ confirmed: st("2025-12-20"), control_done: st("2025-12-22") })).toBe("防疫措置の完了");
    expect(labelOf({ confirmed: st("2025-12-20"), shipment_lifted: st("2025-12-30") })).toBe("搬出制限の解除");
    expect(labelOf({ confirmed: st("2025-12-20"), movement_lifted: st("2026-01-05") })).toBe("移動制限の解除");
    expect(labelOf({ confirmed: st("2025-12-20"), surveillance_lifted: st("2026-01-28") })).toBe("監視強化の解除");
  });
  it("段階が空の確認済み以外の事例は確認中", () => {
    expect(displayStage(mk("a"), NOW).label).toBe("確認中");
  });
});

describe("matchCase", () => {
  describe("胎内（15227）", () => {
    const taina3 = mk("15227-2025-11-04-1", { prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 3, stages: { confirmed: st("2025-11-04") } });
    it("N=3（確定 11/4）に N=4（11/9）は new", () => {
      expect(matchCase({ prefCode: "15", muniCode: "15227", date: "2025-11-09", nationalNo: 4, stage: "confirmed" }, [taina3])).toEqual({ kind: "new" });
    });
    it("N 不明で 7 日以内に 2 件なら ambiguous。candidateIds は入力の順", () => {
      const a = mk("15227-2025-11-04-1", { prefCode: "15", muniCode: "15227", stages: { confirmed: st("2025-11-04") } });
      const b = mk("15227-2025-11-08-1", { prefCode: "15", muniCode: "15227", stages: { suspected: st("2025-11-08") } });
      const incoming = { prefCode: "15", muniCode: "15227", date: "2025-11-10", nationalNo: null, stage: "suspected" as const };
      expect(matchCase(incoming, [a, b])).toEqual({ kind: "ambiguous", candidateIds: [a.id, b.id] });
      expect(matchCase(incoming, [b, a])).toEqual({ kind: "ambiguous", candidateIds: [b.id, a.id] });
    });
    it("胎内の進行中の 2 事例に搬出解除は ambiguous", () => {
      const a = mk("15227-2025-11-04-1", { prefCode: "15", muniCode: "15227", nationalNo: 3, stages: { confirmed: st("2025-11-04"), control_done: st("2025-11-06") } });
      const b = mk("15227-2025-11-08-1", { prefCode: "15", muniCode: "15227", nationalNo: 4, stages: { confirmed: st("2025-11-08") } });
      expect(matchCase({ prefCode: "15", muniCode: "15227", date: "2025-12-05", nationalNo: null, stage: "shipment_lifted" }, [a, b])).toEqual({
        kind: "ambiguous",
        candidateIds: [a.id, b.id],
      });
    });
  });

  describe("津山（33203）", () => {
    const suspected = mk("33203-2025-12-19-1", { stages: { suspected: st("2025-12-19") } });
    const inc = (o: Partial<Parameters<typeof matchCase>[0]> = {}) => ({
      prefCode: "33",
      muniCode: "33203",
      date: "2025-12-20",
      nationalNo: null as number | null,
      ...o,
    });
    it("県の疑い 12/19（N なし）に翌日の国の N=8 は same", () => {
      expect(matchCase(inc({ nationalNo: 8, stage: "confirmed" }), [suspected])).toEqual({ kind: "same", caseId: suspected.id });
    });
    it("疑いと確定は最初の日付から 7 日差 same、8 日差 new", () => {
      expect(matchCase(inc({ date: "2025-12-26", stage: "confirmed" }), [suspected])).toEqual({ kind: "same", caseId: suspected.id });
      expect(matchCase(inc({ date: "2025-12-27", stage: "confirmed" }), [suspected])).toEqual({ kind: "new" });
    });
    it("stage を渡さなければ疑い、確定と同じ扱い", () => {
      expect(matchCase(inc({ date: "2025-12-26" }), [suspected])).toEqual({ kind: "same", caseId: suspected.id });
      expect(matchCase(inc({ date: "2025-12-26", stage: null }), [suspected])).toEqual({ kind: "same", caseId: suspected.id });
    });
    it("最初の日付より前の日付でも 7 日以内なら same", () => {
      expect(matchCase(inc({ date: "2025-12-14", stage: "suspected" }), [suspected])).toEqual({ kind: "same", caseId: suspected.id });
      expect(matchCase(inc({ date: "2025-12-11", stage: "suspected" }), [suspected])).toEqual({ kind: "new" });
    });
    it("確定 12/20、完了 12/30 の事例に搬出解除 1/10（11 日後）は same", () => {
      const c = mk("33203-2025-12-20-1", { stages: { confirmed: st("2025-12-20"), control_done: st("2025-12-30") } });
      expect(matchCase(inc({ date: "2026-01-10", stage: "shipment_lifted" }), [c])).toEqual({ kind: "same", caseId: c.id });
    });
    it("movement_lifted のある事例に監視強化の解除 1/28 は same", () => {
      const c = mk("33203-2025-12-20-1", { stages: { confirmed: st("2025-12-20"), movement_lifted: st("2026-01-10") } });
      expect(matchCase(inc({ date: "2026-01-28", stage: "surveillance_lifted" }), [c])).toEqual({ kind: "same", caseId: c.id });
    });
    it("移動制限の解除の後に搬出制限の解除は同じ事例にしない（ゾーンが終わっている）", () => {
      const c = mk("33203-2025-12-20-1", { stages: { confirmed: st("2025-12-20"), movement_lifted: st("2026-01-10") } });
      expect(matchCase(inc({ date: "2026-01-11", stage: "shipment_lifted" }), [c])).toEqual({ kind: "new" });
    });
    it("候補がなければ new（後の段階の事例がない）", () => {
      expect(matchCase(inc({ date: "2026-01-10", stage: "shipment_lifted" }), [])).toEqual({ kind: "new" });
    });
    it("同じ段階を別の日付で持つ事例は候補にしない。同じ日付なら候補", () => {
      const c = mk("33203-2025-12-20-1", { stages: { confirmed: st("2025-12-20"), shipment_lifted: st("2026-01-05") } });
      expect(matchCase(inc({ date: "2026-01-06", stage: "shipment_lifted" }), [c])).toEqual({ kind: "new" });
      expect(matchCase(inc({ date: "2026-01-05", stage: "shipment_lifted" }), [c])).toEqual({ kind: "same", caseId: c.id });
    });
    it("同じ移動制限の解除（同じ日付）の再読み取りも同じ事例", () => {
      const c = mk("33203-2025-12-20-1", { stages: { confirmed: st("2025-12-20"), movement_lifted: st("2026-01-10") } });
      expect(matchCase(inc({ date: "2026-01-10", stage: "movement_lifted" }), [c])).toEqual({ kind: "same", caseId: c.id });
      expect(matchCase(inc({ date: "2026-01-12", stage: "movement_lifted" }), [c])).toEqual({ kind: "new" });
    });
    it("後の段階は同じシーズンの事例だけ", () => {
      const old = mk("33203-2024-12-20-1", { season: 2024, stages: { confirmed: st("2024-12-20") } });
      expect(matchCase(inc({ date: "2026-01-10", stage: "shipment_lifted" }), [old])).toEqual({ kind: "new" });
    });
    it("否定済みの事例は別の農場の疑いを吸収しない: 数えられる候補があればそちら", () => {
      const negated = mk("33203-2025-12-19-1", { negation: "negated", stages: { suspected: st("2025-12-19") } });
      const live = mk("33203-2025-12-21-1", { stages: { suspected: st("2025-12-21") } });
      expect(matchCase(inc({ date: "2025-12-22", stage: "suspected" }), [negated, live])).toEqual({ kind: "same", caseId: live.id });
    });
    it("否定済みの事例しか候補がなければ same にせず ambiguous（確認に回す）。8 日以上離れれば new", () => {
      const negated = mk("33203-2025-12-19-1", { negation: "negated", stages: { suspected: st("2025-12-19") } });
      expect(matchCase(inc({ date: "2025-12-23", stage: "suspected" }), [negated])).toEqual({ kind: "ambiguous", candidateIds: [negated.id] });
      expect(matchCase(inc({ date: "2025-12-23", stage: "confirmed" }), [negated])).toEqual({ kind: "ambiguous", candidateIds: [negated.id] });
      expect(matchCase(inc({ date: "2025-12-27", stage: "suspected" }), [negated])).toEqual({ kind: "new" });
    });
    it("否定済みの事例でも N が一致すれば same", () => {
      const negated = mk("33203-2025-12-19-1", { nationalNo: 8, negation: "negated", stages: { suspected: st("2025-12-19") } });
      expect(matchCase(inc({ date: "2025-12-23", nationalNo: 8, stage: "confirmed" }), [negated])).toEqual({ kind: "same", caseId: negated.id });
    });
    it("否定が確定した事例は後の段階の候補にしない", () => {
      const c = mk("33203-2025-12-20-1", { negation: "negated", stages: { suspected: st("2025-12-20") } });
      expect(matchCase(inc({ date: "2026-01-10", stage: "shipment_lifted" }), [c])).toEqual({ kind: "new" });
    });
  });

  describe("姫路（28201）", () => {
    it("確定 12/16、搬出解除 1/1 の事例に、2 例目の疑い 1/7 は new", () => {
      const c = mk("28201-2025-12-16-1", {
        prefCode: "28",
        muniCode: "28201",
        muniName: "姫路市",
        stages: { confirmed: st("2025-12-16"), shipment_lifted: st("2026-01-01") },
      });
      expect(matchCase({ prefCode: "28", muniCode: "28201", date: "2026-01-07", nationalNo: null, stage: "suspected" }, [c])).toEqual({ kind: "new" });
    });
  });

  describe("N と絞り込み", () => {
    const c = mk("33203-2025-12-20-1", { nationalNo: 8, stages: { confirmed: st("2025-12-20") } });
    it("N が一致すれば日付が離れていても same", () => {
      expect(matchCase({ prefCode: "33", muniCode: "33203", date: "2026-02-20", nationalNo: 8, stage: "confirmed" }, [c])).toEqual({ kind: "same", caseId: c.id });
    });
    it("別のシーズンの同じ N は別", () => {
      const prev = mk("33203-2024-12-20-1", { season: 2024, nationalNo: 8, stages: { confirmed: st("2024-12-20") } });
      expect(matchCase({ prefCode: "33", muniCode: "33203", date: "2025-12-20", nationalNo: 8, stage: "confirmed" }, [prev])).toEqual({ kind: "new" });
    });
    it("N が違う事例は日付が近くても外す", () => {
      expect(matchCase({ prefCode: "33", muniCode: "33203", date: "2025-12-21", nationalNo: 9, stage: "confirmed" }, [c])).toEqual({ kind: "new" });
    });
    it("reviewing を候補にしない", () => {
      const r = makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "u" }, NOW);
      expect(matchCase({ prefCode: "33", muniCode: "33203", date: "2025-12-20", nationalNo: null, stage: "suspected" }, [r])).toEqual({ kind: "new" });
    });
    it("別の市町村、別の県は候補にしない", () => {
      expect(matchCase({ prefCode: "33", muniCode: "33202", date: "2025-12-20", nationalNo: null, stage: "confirmed" }, [c])).toEqual({ kind: "new" });
      expect(matchCase({ prefCode: "34", muniCode: "33203", date: "2025-12-20", nationalNo: null, stage: "confirmed" }, [c])).toEqual({ kind: "new" });
    });
  });
});

describe("applyRead", () => {
  const URL1 = "https://example.test/a.pdf";
  const URL2 = "https://example.test/b.html";

  it("existing が null なら新しい事例。id は連番 1、season は最初の日付から", () => {
    const c = applyRead(
      null,
      nr({ primaryStage: "suspected", primaryStamp: { date: "2025-12-19", time: "09:00" }, headCount: 12000, birdUse: "採卵鶏", prefNo: 2 }),
      URL1,
      "auto",
      NOW,
    );
    expect(c).toEqual({
      id: "33203-2025-12-19-1",
      season: 2025,
      nationalNo: null,
      prefNo: 2,
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      birdUse: "採卵鶏",
      housing: null,
      headCount: 12000,
      stages: { suspected: { date: "2025-12-19", time: "09:00" } },
      radiiKm: [],
      prefEstimates: { shipment: null, movement: null, surveillance: null },
      negation: "none",
      negatedAt: null,
      confirmState: "auto",
      sourceUrls: [URL1],
      updatedAt: "2025-12-22T12:00:00+09:00",
    });
  });

  it("season は年をまたぐ冬でも最初の日付のシーズン", () => {
    const c = applyRead(null, nr({ primaryStage: "confirmed", primaryStamp: { date: "2026-02-01", time: null } }), URL1, "national", NOW);
    expect(c.season).toBe(2025);
    const d = applyRead(null, nr({ primaryStage: "confirmed", primaryStamp: { date: "2026-06-02", time: null } }), URL1, "national", NOW);
    expect(d.season).toBe(2026);
  });

  it("stages の中の最も早い日付が id になる（stages だけの読み取り）", () => {
    const c = applyRead(
      null,
      nr({ kind: "zone_lifted", stages: { shipment_lifted: st("2026-01-05"), control_done: st("2025-12-30") } }),
      URL1,
      "auto",
      NOW,
    );
    expect(c.id).toBe("33203-2025-12-30-1");
  });

  it("primaryStamp は primaryStage の段階に入る", () => {
    const c = applyRead(null, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20", "10:00") }), URL1, "auto", NOW);
    expect(c.stages).toEqual({ confirmed: { date: "2025-12-20", time: "10:00" } });
  });

  it("muniCode が null なら throw", () => {
    expect(() => applyRead(null, nr({ muniCode: null, muniName: null, primaryStage: "suspected", primaryStamp: st("2025-12-19") }), URL1, "auto", NOW)).toThrow();
  });

  it("日付がどこにもなければ throw", () => {
    expect(() => applyRead(null, nr({ kind: "progress" }), URL1, "auto", NOW)).toThrow();
  });

  it("既存を null で消さない。id と season は既存のまま", () => {
    const existing = mk("33203-2025-12-19-1", {
      nationalNo: 8,
      prefNo: 2,
      birdUse: "採卵鶏",
      housing: "ウインドレス",
      headCount: 12000,
      stages: { suspected: st("2025-12-19", "09:00") },
      sourceUrls: [URL1],
    });
    const c = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20", null) }), URL2, "auto", NOW);
    expect(c).toMatchObject({
      id: "33203-2025-12-19-1",
      season: 2025,
      nationalNo: 8,
      prefNo: 2,
      birdUse: "採卵鶏",
      housing: "ウインドレス",
      headCount: 12000,
    });
    expect(c.stages).toEqual({ suspected: st("2025-12-19", "09:00"), confirmed: st("2025-12-20") });
  });

  it("既存が null の欄は読み取りで埋める。非 null の欄は（operator でなければ）既存を保つ", () => {
    const existing = mk("33203-2025-12-19-1", { headCount: 12000, stages: { suspected: st("2025-12-19") } });
    const c = applyRead(existing, nr({ headCount: 99999, nationalNo: 8, birdUse: "採卵鶏", prefNo: 2, housing: "開放" }), URL2, "auto", NOW);
    expect(c).toMatchObject({ headCount: 12000, nationalNo: 8, birdUse: "採卵鶏", prefNo: 2, housing: "開放" });
  });

  it("半径は和集合（重複なし、小さい順）", () => {
    const existing = mk("a", { radiiKm: [10, 3], stages: { confirmed: st("2025-12-20") } });
    const c = applyRead(existing, nr({ radiiKm: [3, 20] }), URL2, "auto", NOW);
    expect(c.radiiKm).toEqual([3, 10, 20]);
  });

  it("出典は重複なく足す", () => {
    const existing = mk("a", { sourceUrls: [URL1], stages: { confirmed: st("2025-12-20") } });
    expect(applyRead(existing, nr(), URL1, "auto", NOW).sourceUrls).toEqual([URL1]);
    expect(applyRead(existing, nr(), URL2, "auto", NOW).sourceUrls).toEqual([URL1, URL2]);
  });

  it("国（時刻なし）の後の県の 09:00 は同じ日付の時刻を埋める", () => {
    const existing = mk("a", { stages: { confirmed: st("2025-12-20", null) } });
    const c = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20", "09:00") }), URL2, "auto", NOW);
    expect(c.stages.confirmed).toEqual({ date: "2025-12-20", time: "09:00" });
  });

  it("日付の違う値は既存を保つ。既存の時刻は消さない", () => {
    const existing = mk("a", { stages: { confirmed: st("2025-12-20", "09:00") } });
    const diffDate = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-21", "10:00") }), URL2, "auto", NOW);
    expect(diffDate.stages.confirmed).toEqual({ date: "2025-12-20", time: "09:00" });
    const noTime = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20", null) }), URL2, "auto", NOW);
    expect(noTime.stages.confirmed).toEqual({ date: "2025-12-20", time: "09:00" });
  });

  it("confirmState は reviewing < auto < national < operator の高い方", () => {
    const base = (cs: Case["confirmState"]) => mk("a", { confirmState: cs, stages: { confirmed: st("2025-12-20") } });
    expect(applyRead(base("auto"), nr(), URL2, "national", NOW).confirmState).toBe("national");
    expect(applyRead(base("national"), nr(), URL2, "auto", NOW).confirmState).toBe("national");
    expect(applyRead(base("operator"), nr(), URL2, "national", NOW).confirmState).toBe("operator");
    expect(applyRead(base("auto"), nr(), URL2, "operator", NOW).confirmState).toBe("operator");
  });

  it("operator は非 null で上書きする。null では消さない", () => {
    const existing = mk("a", {
      headCount: 12000,
      birdUse: "採卵鶏",
      radiiKm: [3],
      stages: { confirmed: st("2025-12-20", "09:00") },
    });
    const c = applyRead(existing, nr({ headCount: 15000, birdUse: null, radiiKm: [5], primaryStage: "confirmed", primaryStamp: st("2025-12-21", null) }), URL2, "operator", NOW);
    expect(c).toMatchObject({ headCount: 15000, birdUse: "採卵鶏", radiiKm: [5], confirmState: "operator" });
    expect(c.stages.confirmed).toEqual({ date: "2025-12-21", time: null });
  });

  it("estimates の非 null は常に上書き。null は消さない", () => {
    const existing = mk("a", {
      prefEstimates: { shipment: "2026-01-05", movement: "2026-01-10", surveillance: null },
      stages: { confirmed: st("2025-12-20") },
    });
    const c = applyRead(existing, nr({ estimates: { shipment: "2026-01-07", movement: null, surveillance: "2026-01-30" } }), URL2, "auto", NOW);
    expect(c.prefEstimates).toEqual({ shipment: "2026-01-07", movement: "2026-01-10", surveillance: "2026-01-30" });
  });

  describe("否定", () => {
    it("否定は candidate。段階はそのまま", () => {
      const existing = mk("a", { stages: { suspected: st("2025-12-19") } });
      const c = applyRead(existing, nr({ kind: "negated", negationBasis: "遺伝子検査で陰性" }), URL2, "auto", NOW);
      expect(c.negation).toBe("candidate");
      expect(c.stages).toEqual({ suspected: st("2025-12-19") });
    });
    it("confirmed があれば none（否定の候補を退ける）", () => {
      const existing = mk("a", { stages: { suspected: st("2025-12-19"), confirmed: st("2025-12-20") } });
      expect(applyRead(existing, nr({ kind: "negated" }), URL2, "auto", NOW).negation).toBe("none");
    });
    it("否定の候補があっても、後から確定が来れば none に戻る", () => {
      const existing = mk("a", { negation: "candidate", stages: { suspected: st("2025-12-19") } });
      const c = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20") }), URL2, "national", NOW);
      expect(c.negation).toBe("none");
    });
    it("人が確定した否定（negated）でも、確定が来れば none に戻る（見逃さない）", () => {
      const existing = mk("a", { negation: "negated", negatedAt: "2025-12-21T10:00:00+09:00", stages: { suspected: st("2025-12-19") } });
      const c = applyRead(existing, nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20") }), URL2, "national", NOW);
      expect(c.negation).toBe("none");
      expect(c.negatedAt).toBeNull();
    });
    it("確定済みで運営者が negated にした事例は、進捗や再読み取りで none に戻さない", () => {
      const existing = mk("a", { negation: "negated", negatedAt: "2025-12-21T10:00:00+09:00", confirmState: "operator", stages: { confirmed: st("2025-12-20") } });
      for (const read of [nr({ kind: "progress", primaryStage: "culling_done", primaryStamp: st("2025-12-21") }), nr({ primaryStage: "confirmed", primaryStamp: st("2025-12-20", "09:00") }), nr({ kind: "negated" })]) {
        const c = applyRead(existing, read, URL2, "auto", NOW);
        expect(c.negation).toBe("negated");
        expect(c.negatedAt).toBe("2025-12-21T10:00:00+09:00");
      }
    });
    it("確定済みの事例に否定の文書が来ても candidate にしない", () => {
      const existing = mk("a", { stages: { confirmed: st("2025-12-20") } });
      expect(applyRead(existing, nr({ kind: "negated" }), URL2, "auto", NOW).negation).toBe("none");
    });
    it("negated の事例に否定の文書を読み直しても negated のまま", () => {
      const existing = mk("a", { negation: "negated", negatedAt: "2025-12-21T10:00:00+09:00", stages: { suspected: st("2025-12-19") } });
      const c = applyRead(existing, nr({ kind: "negated" }), URL2, "auto", NOW);
      expect(c.negation).toBe("negated");
      expect(c.negatedAt).toBe("2025-12-21T10:00:00+09:00");
    });
    it("否定でない読み取りは negation を変えない", () => {
      const existing = mk("a", { negation: "candidate", stages: { suspected: st("2025-12-19") } });
      expect(applyRead(existing, nr({ kind: "progress" }), URL2, "auto", NOW).negation).toBe("candidate");
    });
  });

  it("existing を書き換えない", () => {
    const existing = mk("a", { radiiKm: [3], sourceUrls: [URL1], stages: { confirmed: st("2025-12-20") } });
    const snapshot = structuredClone(existing);
    applyRead(existing, nr({ radiiKm: [5], primaryStage: "culling_done", primaryStamp: st("2025-12-21") }), URL2, "auto", NOW);
    expect(existing).toEqual(snapshot);
  });

  it("undefined の欄を作らない（Firestore に書ける形）", () => {
    const c = applyRead(null, nr({ primaryStage: "suspected", primaryStamp: st("2025-12-19") }), URL1, "auto", NOW);
    expect(JSON.stringify(c)).not.toContain("undefined");
    for (const v of Object.values(c.stages)) expect(v).toBeDefined();
  });
});
