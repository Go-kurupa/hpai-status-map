import { describe, expect, it } from "vitest";
import { checkCorrectedStage, checkStageDateFix } from "../src/read/correctedCheck";
import { findForbiddenPhrases } from "../src/wording";

const ctx = (over: Partial<Parameters<typeof checkCorrectedStage>[1]> = {}) => ({ today: "2025-12-22", season: 2025, previousStages: null, ...over });

describe("checkCorrectedStage（運営者が直した日付を、読み手の経路と同じ決まりで検査する）", () => {
  it("今日までの、そのシーズンの日付は通る", () => {
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-12-22" }, ctx())).toEqual({ ok: true });
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-06-01" }, ctx())).toEqual({ ok: true });
  });
  it("未来の日付は拒む（invalid-argument）", () => {
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-12-23" }, ctx())).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(checkCorrectedStage({ stage: "suspected", date: "2052-12-20" }, ctx())).toMatchObject({ ok: false, code: "invalid-argument" });
  });
  it("シーズンの外の日付は拒む（年の打ち間違い）", () => {
    expect(checkCorrectedStage({ stage: "suspected", date: "2024-12-20" }, ctx())).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-05-31" }, ctx())).toMatchObject({ ok: false, code: "invalid-argument" });
  });
  it("既にある段階の日付と違えば拒む（上書きしない）", () => {
    const previousStages = { suspected: { date: "2025-12-20", time: null } };
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-12-19" }, ctx({ previousStages }))).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-12-20" }, ctx({ previousStages }))).toEqual({ ok: true });
  });
  it("段階の順序が逆になる日付は拒む（before_previous_stage）", () => {
    const previousStages = { confirmed: { date: "2025-12-21", time: null } };
    expect(checkCorrectedStage({ stage: "suspected", date: "2025-12-22" }, ctx({ previousStages }))).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkCorrectedStage({ stage: "culling_done", date: "2025-12-20" }, ctx({ previousStages }))).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkCorrectedStage({ stage: "culling_done", date: "2025-12-22" }, ctx({ previousStages }))).toEqual({ ok: true });
  });
  it("理由の文を返す", () => {
    const r = checkCorrectedStage({ stage: "suspected", date: "2025-12-23" }, ctx());
    expect(r.ok === false && r.message).toMatch(/未来/);
  });
});

describe("checkStageDateFix（すでにある段階の日付を直す。直す段階そのものは比べない）", () => {
  const stages = {
    suspected: { date: "2025-12-18", time: null },
    confirmed: { date: "2025-12-19", time: null },
    control_done: { date: "2025-12-21", time: null },
  };
  const fix = (o: Partial<Parameters<typeof checkStageDateFix>[0]> = {}, c: Partial<Parameters<typeof checkStageDateFix>[1]> = {}) =>
    checkStageDateFix({ stage: "confirmed", expectedDate: "2025-12-19", newDate: "2025-12-20", ...o }, { today: "2025-12-22", season: 2025, stages, ...c });

  it("前後の段階の間なら通る（同じ段階の元の日付とは比べない）", () => {
    expect(fix()).toEqual({ ok: true });
    expect(fix({ newDate: "2025-12-18" })).toEqual({ ok: true }); // 疑いと同じ日まで
  });
  it("元と同じ、未来、シーズンの外は invalid-argument", () => {
    expect(fix({ newDate: "2025-12-19" })).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(fix({ stage: "control_done", expectedDate: "2025-12-21", newDate: "2025-12-23" })).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(fix({ newDate: "2024-12-20" })).toMatchObject({ ok: false, code: "invalid-argument" });
  });
  it("順序が崩れる日付は failed-precondition で、どの段階と合わないかを言う", () => {
    const r = fix({ newDate: "2025-12-17" }); // 疑い（12/18）より前の確定
    expect(r).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(r.ok === false && r.message).toContain("疑い");
    expect(fix({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-20" })).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(fix({ newDate: "2025-12-22" })).toMatchObject({ ok: false, code: "failed-precondition" }); // 防疫措置の完了より後の確定
  });
  it("文言に禁句がない", () => {
    const msgs = [fix({ newDate: "2025-12-19" }), fix({ newDate: "2025-12-23" }), fix({ newDate: "2024-12-20" }), fix({ newDate: "2025-12-17" })].map((r) => (r.ok ? "" : r.message));
    for (const m of msgs) expect(findForbiddenPhrases(m)).toEqual([]);
  });
});
