import { describe, expect, it } from "vitest";
import { isReviewStatus, REVIEW_NOTE_MAX, REVIEW_STATUS_LABEL, REVIEW_STATUSES, reviewNoteProblem, reviewStatusRank } from "../src/consult/review";

describe("相談から足した対策の実施の記録", () => {
  it("状態は pending・later・done の 3 つで、画面の名前は「まだ」「後でやる」「やった」", () => {
    expect(REVIEW_STATUSES).toEqual(["pending", "later", "done"]);
    expect(REVIEW_STATUS_LABEL).toEqual({ pending: "まだ", later: "後でやる", done: "やった" });
    for (const s of REVIEW_STATUSES) expect(isReviewStatus(s)).toBe(true);
    for (const bad of ["finished", "", null, undefined, 1, true]) expect(isReviewStatus(bad)).toBe(false);
  });

  it("メモは 40 まで（規則の size() と同じ UTF-16 の単位）。改行は不可。空は可", () => {
    expect(REVIEW_NOTE_MAX).toBe(40);
    expect(reviewNoteProblem("")).toBeNull();
    expect(reviewNoteProblem("資材を用意してから再確認")).toBeNull();
    expect(reviewNoteProblem("あ".repeat(40))).toBeNull();
    expect(reviewNoteProblem("あ".repeat(41))).toBe("too_long");
    // 絵文字は 2 と数える（規則が 21 個を拒むのと同じ）
    expect(reviewNoteProblem("🐔".repeat(20))).toBeNull();
    expect(reviewNoteProblem("🐔".repeat(21))).toBe("too_long");
    expect(reviewNoteProblem("資材\n再確認")).toBe("newline");
    expect(reviewNoteProblem("資材\r再確認")).toBe("newline");
  });

  it("並びの重みは「後でやる」→「まだ」（記録なしを含む）→「やった」", () => {
    expect(reviewStatusRank("later")).toBeLessThan(reviewStatusRank("pending"));
    expect(reviewStatusRank(null)).toBe(reviewStatusRank("pending"));
    expect(reviewStatusRank("pending")).toBeLessThan(reviewStatusRank("done"));
  });
});
