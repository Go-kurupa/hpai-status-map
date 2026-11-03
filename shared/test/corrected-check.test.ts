import { describe, expect, it } from "vitest";
import { checkCorrectedStage } from "../src/read/correctedCheck";

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
