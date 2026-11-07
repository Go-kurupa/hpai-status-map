// 載せるかの判断を書き込みの計画にする純粋関数 planApply の試験（I-05）。Firestore も時計も使わない。
import { describe, expect, it } from "vitest";
import { applyRead, makeReviewingCase } from "@hpai/shared/cases";
import type { NormalizedRead, PublishDecision } from "@hpai/shared/read/types";
import type { Case, CaseStage, StageStamp } from "@hpai/shared/types";
import { planApply, wildBirdIdOf, type ApplyDoc } from "../src/read/apply";

const NOW = new Date("2025-12-22T03:00:00Z");
const doc = (o: Partial<ApplyDoc> = {}): ApplyDoc => ({ id: "d1", url: "https://example.test/a", title: "題", prefCode: "33", fetchedAt: "2025-12-22T12:00:00+09:00", ...o });
const PUBLISH: PublishDecision = { action: "publish", negationCandidate: false };

function norm(o: Partial<NormalizedRead> = {}): NormalizedRead {
  const stage: CaseStage | null = o.primaryStage === undefined ? "confirmed" : o.primaryStage;
  const stamp: StageStamp | null = o.primaryStamp === undefined ? { date: "2025-12-20", time: "09:00" } : o.primaryStamp;
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
    primaryStage: stage,
    primaryStamp: stamp,
    stages: stage !== null && stamp !== null ? { [stage]: stamp } : {},
    radiiKm: [],
    estimates: { shipment: null, movement: null, surveillance: null },
    negationBasis: null,
    yearCompleted: false,
    wildBirds: [],
    ...o,
  };
}

function existingCase(o: Partial<Case> = {}): Case {
  return {
    id: "33203-2025-12-20-1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.test/old"],
    updatedAt: "2025-12-21T12:00:00+09:00",
    ...o,
  };
}

describe("planApply: publish、新しい事例", () => {
  it("新しい確定は事例ができ、auto、published", () => {
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: norm({ headCount: 12000 }), existing: [], now: NOW });
    expect(p.readState).toBe("published");
    expect(p.caseId).toBe("33203-2025-12-20-1");
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0]).toMatchObject({ confirmState: "auto", muniCode: "33203", headCount: 12000, sourceUrls: ["https://example.test/a"], stages: { confirmed: { date: "2025-12-20", time: "09:00" } } });
    expect(p.reviews).toEqual([]);
    expect(p.reasons).toEqual([]);
  });

  it("新しい疑いも事例になる", () => {
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: norm({ kind: "suspected", primaryStage: "suspected", primaryStamp: { date: "2025-12-19", time: null } }), existing: [], now: NOW });
    expect(p.caseId).toBe("33203-2025-12-19-1");
    expect(p.cases[0]!.stages).toEqual({ suspected: { date: "2025-12-19", time: null } });
  });

  it("同じ市町村、同じ日に別の事例があれば連番 2（nextCaseId）。applyRead の連番 1 のままにしない", () => {
    // 15 日後の別の農場（N が違う）。N が違う事例は外れるので new になり、同じ日の連番が 2 になる
    const first = existingCase({ nationalNo: 8 });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: norm({ nationalNo: 9 }), existing: [first], now: NOW });
    expect(p.caseId).toBe("33203-2025-12-20-2");
    expect(p.cases[0]!.nationalNo).toBe(9);
  });

  it("id の日付は applyRead が返した stages のいちばん早い日付（stageEvents で前の段階が入っても）", () => {
    const n = norm({ stages: { suspected: { date: "2025-12-19", time: null }, confirmed: { date: "2025-12-20", time: "09:00" } } });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: n, existing: [], now: NOW });
    expect(p.caseId).toBe("33203-2025-12-19-1");
  });
});

describe("planApply: publish、同じ事例（§10.2 の図を 1 段ずつ）", () => {
  it("疑い → 確定 → 殺処分 → 完了 → 搬出解除 / 移動解除 → 監視強化解除", () => {
    const steps: Array<{ kind: NormalizedRead["kind"]; stage: CaseStage; date: string; extra?: Partial<NormalizedRead> }> = [
      { kind: "suspected", stage: "suspected", date: "2025-12-19" },
      { kind: "confirmed", stage: "confirmed", date: "2025-12-20", extra: { nationalNo: 8 } },
      { kind: "progress", stage: "culling_done", date: "2025-12-22" },
      { kind: "control_done", stage: "control_done", date: "2025-12-23" },
      { kind: "zone_lifted", stage: "shipment_lifted", date: "2026-01-03" },
      { kind: "zone_lifted", stage: "movement_lifted", date: "2026-01-10" },
      { kind: "zone_lifted", stage: "surveillance_lifted", date: "2026-01-28" },
    ];
    let cases: Case[] = [];
    for (const [i, s] of steps.entries()) {
      const n = norm({ kind: s.kind, primaryStage: s.stage, primaryStamp: { date: s.date, time: null }, ...s.extra });
      const p = planApply({ doc: doc({ id: `d${i}`, url: `https://example.test/${i}` }), decision: PUBLISH, normalized: n, existing: cases, now: NOW });
      expect(p.readState, s.stage).toBe("published");
      expect(p.cases, s.stage).toHaveLength(1);
      cases = [p.cases[0]!];
      expect(Object.keys(cases[0]!.stages).sort(), s.stage).toEqual(steps.slice(0, i + 1).map((x) => x.stage).sort());
      expect(cases[0]!.id).toBe("33203-2025-12-19-1");
    }
    expect(cases[0]!.sourceUrls).toHaveLength(steps.length);
  });
});

describe("planApply: publish でも載せないもの", () => {
  it("new かつ後の段階は事例を作らず review_private、no_case_for_stage", () => {
    const n = norm({ kind: "zone_lifted", primaryStage: "movement_lifted", primaryStamp: { date: "2026-01-10", time: null } });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: n, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["no_case_for_stage"]);
    expect(p.reviews).toMatchObject([{ id: "doc-d1", kind: "document", hasOutbreakWords: false, reasons: ["no_case_for_stage"] }]);
  });

  it("前シーズン末の事例への 6 月の解除は season が違い new になる。事例にしない", () => {
    const prev = existingCase({ stages: { confirmed: { date: "2026-05-20", time: null }, control_done: { date: "2026-05-25", time: null } }, season: 2025, id: "33203-2026-05-20-1" });
    const n = norm({ kind: "zone_lifted", primaryStage: "movement_lifted", primaryStamp: { date: "2026-06-02", time: null } });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: n, existing: [prev], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.reasons).toEqual(["no_case_for_stage"]);
    expect(p.readState).toBe("review_private");
  });

  it("進捗で段階がなく、一致する事例もなければ事例を作らない", () => {
    const n = norm({ kind: "progress", primaryStage: null, primaryStamp: { date: "2025-12-22", time: null }, stages: {} });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: n, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.reasons).toEqual(["no_case_for_stage"]);
  });

  it("ambiguous は別の事例にせず、rev の確認中で review_public", () => {
    const a = existingCase({ id: "33203-2025-12-20-1" });
    const b = existingCase({ id: "33203-2025-12-21-1", stages: { confirmed: { date: "2025-12-21", time: null } } });
    const n = norm({ kind: "zone_lifted", primaryStage: "movement_lifted", primaryStamp: { date: "2026-01-10", time: null } });
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: n, existing: [a, b], now: NOW });
    expect(p.readState).toBe("review_public");
    expect(p.cases).toEqual([makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "https://example.test/a" }, NOW)]);
    expect(p.reasons).toEqual(["ambiguous_case"]);
    expect(p.reviews).toMatchObject([{ id: "doc-d1", hasOutbreakWords: true }]);
    expect(p.caseId).toBeNull();
  });

  it("県の入口の文書で別の県の読み取りは載せない（岡山のページの姫路）: pref_mismatch、hasOutbreakWords:false", () => {
    const n = norm({ prefCode: "28", muniCode: "28201", muniName: "姫路市" });
    const p = planApply({ doc: doc({ prefCode: "33" }), decision: PUBLISH, normalized: n, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["pref_mismatch"]);
    expect(p.reviews).toMatchObject([{ prefCode: "33", hasOutbreakWords: false }]);
  });

  it("国の文書（取得元の県なし）は読み取りの県で載せる", () => {
    const n = norm({ prefCode: "28", muniCode: "28201", muniName: "姫路市" });
    const p = planApply({ doc: doc({ prefCode: null }), decision: PUBLISH, normalized: n, existing: [], now: NOW });
    expect(p.caseId).toBe("28201-2025-12-20-1");
  });

  it("normalized がない publish は載せない", () => {
    const p = planApply({ doc: doc(), decision: PUBLISH, normalized: null, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.reasons).toEqual(["normalized_missing"]);
  });
});

describe("planApply: 否定", () => {
  const negated = (o: Partial<NormalizedRead> = {}) => norm({ kind: "negated", primaryStage: null, primaryStamp: { date: "2025-12-21", time: null }, stages: {}, ...o });
  const NEG: PublishDecision = { action: "publish", negationCandidate: true };

  it("疑いの事例は段階をそのままに negation:candidate、negation_candidate の知らせ", () => {
    const sus = existingCase({ stages: { suspected: { date: "2025-12-19", time: null } }, id: "33203-2025-12-19-1" });
    const p = planApply({ doc: doc(), decision: NEG, normalized: negated(), existing: [sus], now: NOW });
    expect(p.readState).toBe("published");
    expect(p.cases[0]).toMatchObject({ id: sus.id, negation: "candidate", stages: sus.stages });
    expect(p.reviews).toHaveLength(1);
    expect(p.reviews[0]).toMatchObject({ kind: "alert", alert: "negation_candidate", caseId: sus.id, prefCode: "33" });
    expect(p.reviews[0]!.id).toMatch(/^alert-negation_candidate-/);
    expect(JSON.stringify(p.reviews[0])).not.toContain("陰性");
  });

  it("確定があれば退ける（negation_on_confirmed）。事例は変えない", () => {
    const p = planApply({ doc: doc(), decision: NEG, normalized: negated(), existing: [existingCase()], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["negation_on_confirmed"]);
  });

  it("事例がなければ review_private", () => {
    const p = planApply({ doc: doc(), decision: NEG, normalized: negated(), existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["no_case_for_negation"]);
  });

  it("否定済み（N なし）の事例しか候補にないときは ambiguous。生きている事例を candidate にしない", () => {
    const done = existingCase({ stages: { suspected: { date: "2025-12-19", time: null } }, negation: "negated", negatedAt: "2025-12-21T12:00:00+09:00" });
    const p = planApply({ doc: doc(), decision: NEG, normalized: negated(), existing: [done], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["ambiguous_case"]);
  });

  it("同じ市町村で 7 日内に否定済みと生きている疑いが並ぶと、生きている方が candidate になる。段階は動かさず、知らせが出る（隠れない）", () => {
    const done = existingCase({ id: "33203-2025-12-19-1", stages: { suspected: { date: "2025-12-19", time: null } }, negation: "negated", negatedAt: "2025-12-21T12:00:00+09:00" });
    const live = existingCase({ id: "33203-2025-12-20-1", stages: { suspected: { date: "2025-12-20", time: null } } });
    const p = planApply({ doc: doc(), decision: NEG, normalized: negated(), existing: [done, live], now: NOW });
    expect(p.cases[0]).toMatchObject({ id: live.id, negation: "candidate", stages: live.stages });
    expect(p.reviews[0]).toMatchObject({ alert: "negation_candidate", caseId: live.id });
  });
});

describe("planApply: 確認中と破棄", () => {
  it("review_public は makeReviewingCase と完全に同じで、読み取った値が入らない", () => {
    const p = planApply({ doc: doc(), decision: { action: "review_public", reasons: ["compare:municipality"] }, normalized: norm(), existing: [], now: NOW });
    expect(p.cases).toEqual([makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "https://example.test/a" }, NOW)]);
    expect(p.readState).toBe("review_public");
    expect(p.caseId).toBeNull();
    expect(p.reviews).toEqual([{ id: "doc-d1", kind: "document", documentId: "d1", url: "https://example.test/a", prefCode: "33", title: "題", reasons: ["compare:municipality"], hasOutbreakWords: true }]);
  });

  it("県が分からなければ review_private（国の文書で読み込めなかったとき）", () => {
    const p = planApply({ doc: doc({ prefCode: null }), decision: { action: "review_public", reasons: ["read_failed"] }, normalized: null, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["read_failed", "pref_unknown"]);
    expect(p.reviews[0]).toMatchObject({ hasOutbreakWords: false, prefCode: null });
  });

  it("進捗の題でも、同じ県に数える事例があっても rev を作る（§9.6、§21）", () => {
    const p = planApply({ doc: doc({ title: "防疫措置状況（第5報）" }), decision: { action: "review_public", reasons: ["auto_publish_off"] }, normalized: null, existing: [existingCase()], now: NOW });
    expect(p.cases.map((c) => c.id)).toEqual(["rev-d1"]);
    expect(p.readState).toBe("review_public");
  });

  it("review_public でも、取得元の県と読みの県が食い違えば公開しない（岡山に姫路の rev を出さない）", () => {
    const p = planApply({ doc: doc({ prefCode: "33" }), decision: { action: "review_public", reasons: ["compare:kind"] }, normalized: norm({ prefCode: "28" }), existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reasons).toEqual(["compare:kind", "pref_mismatch"]);
    expect(p.reviews[0]).toMatchObject({ hasOutbreakWords: false });
  });

  it("review_private は公開の事例を作らない", () => {
    const p = planApply({ doc: doc(), decision: { action: "review_private", reasons: ["auto_publish_off"] }, normalized: null, existing: [], now: NOW });
    expect(p.cases).toEqual([]);
    expect(p.wildBirds).toEqual([]);
    expect(p.readState).toBe("review_private");
    expect(p.reviews).toHaveLength(1);
  });

  it("予算で止めた理由なら readState は skipped_budget。確認中の rev と箱の項目は作る", () => {
    for (const reason of ["budget_stop", "budget_skip_progress"]) {
      const p = planApply({ doc: doc(), decision: { action: "review_public", reasons: [reason] }, normalized: null, existing: [], now: NOW });
      expect(p.readState).toBe("skipped_budget");
      expect(p.cases.map((c) => c.id)).toEqual(["rev-d1"]);
      expect(p.reviews).toHaveLength(1);
    }
    const q = planApply({ doc: doc(), decision: { action: "review_private", reasons: ["budget_stop"] }, normalized: null, existing: [], now: NOW });
    expect(q.readState).toBe("skipped_budget");
    expect(q.cases).toEqual([]);
  });

  it("discard は何も書かず、理由だけ返す", () => {
    const p = planApply({ doc: doc(), decision: { action: "discard", reasons: ["both_read:drill"] }, normalized: null, existing: [], now: NOW });
    expect(p).toEqual({ cases: [], wildBirds: [], reviews: [], readState: "discarded", caseId: null, reasons: ["both_read:drill"] });
    expect(planApply({ doc: doc(), decision: { action: "discard" }, normalized: null, existing: [], now: NOW }).reasons).toEqual([]);
  });
});

describe("planApply: 野鳥", () => {
  const bird = (o: Partial<NormalizedRead["wildBirds"][number]> = {}): NormalizedRead["wildBirds"][number] => ({
    date: "2025-12-01",
    prefCode: "04",
    muniCode: null,
    muniName: "栗原市",
    species: "コハクチョウ",
    test: "screening_positive",
    ...o,
  });
  const wild = (birds: NormalizedRead["wildBirds"]) => norm({ kind: "wild_bird", primaryStage: null, primaryStamp: null, stages: {}, prefCode: null, muniCode: null, muniName: null, wildBirds: birds });

  it("全行を書く。focusZone は null、出典は文書の URL、season は日付から", () => {
    const p = planApply({ doc: doc({ prefCode: null }), decision: PUBLISH, normalized: wild([bird(), bird({ date: "2025-12-02", species: null })]), existing: [], now: NOW });
    expect(p.readState).toBe("published");
    expect(p.cases).toEqual([]);
    expect(p.wildBirds).toHaveLength(2);
    expect(p.wildBirds[0]).toMatchObject({ season: 2025, focusZone: { from: null, to: null }, sourceUrl: "https://example.test/a", test: "screening_positive" });
    expect(p.wildBirds[0]!.id).toMatch(/^wb-[0-9a-f]{24}$/);
    expect(p.wildBirds[0]!.id).not.toBe(p.wildBirds[1]!.id);
  });

  it("陽性 → 陰性は同じ id（上書きできる）。種が null でも市町村が null でも鍵が決まる", () => {
    expect(wildBirdIdOf(bird())).toBe(wildBirdIdOf(bird({ test: "negative" })));
    expect(wildBirdIdOf(bird({ species: null }))).not.toBe(wildBirdIdOf(bird()));
    expect(wildBirdIdOf(bird({ muniName: null }))).toMatch(/^wb-/);
    expect(wildBirdIdOf(bird({ muniCode: "04202" }))).not.toBe(wildBirdIdOf(bird()));
  });

  it("行が 0 なら確認中", () => {
    const p = planApply({ doc: doc({ prefCode: null }), decision: PUBLISH, normalized: wild([]), existing: [], now: NOW });
    expect(p.wildBirds).toEqual([]);
    expect(p.readState).toBe("review_private");
  });
});

describe("planApply: 既存を壊さない", () => {
  it("existing を書き換えない", () => {
    const c = existingCase();
    const snapshot = structuredClone(c);
    planApply({ doc: doc(), decision: PUBLISH, normalized: norm({ headCount: 5 }), existing: [c], now: NOW });
    expect(c).toEqual(snapshot);
    expect(applyRead(c, norm(), "https://x", "auto", NOW).id).toBe(c.id); // 参照: applyRead は既存の id を保つ
  });
});
