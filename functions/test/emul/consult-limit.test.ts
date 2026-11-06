// 対策の相談の 1 日の回数（reserveConsultCall / reserveJudgeCall）を、模擬環境の Firestore で確かめる。
// 上限ちょうどで false、同時に呼んでも上限を超えない、日本時間の 0 時で切り替わる、会員どうしは別の数。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/admin";
import { consultCallPath, consultJudgePath, reserveConsultCall, reserveJudgeCall } from "../../src/consult/limit";

const PROJECT = "demo-hpai";
const LIMIT = 10;
// 日本時間 2026-11-07 23:59:59 と、その 1 秒後（日本時間 11-08 00:00:00）
const BEFORE_MIDNIGHT = new Date("2026-11-07T14:59:59Z");
const AFTER_MIDNIGHT = new Date("2026-11-07T15:00:00Z");

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const countOf = async (path: string): Promise<number | undefined> => (await db.doc(path).get()).get("count") as number | undefined;

describe("会員の 1 日の回数（reserveConsultCall）", () => {
  it("上限ちょうどまでは true、次は false。false のとき数は増えない", async () => {
    for (let i = 1; i <= LIMIT; i++) expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT), `${i} 回目`).toBe(true);
    expect(await countOf(consultCallPath("u1", BEFORE_MIDNIGHT))).toBe(LIMIT);
    expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)).toBe(false);
    expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)).toBe(false);
    expect(await countOf(consultCallPath("u1", BEFORE_MIDNIGHT))).toBe(LIMIT);
  });

  it("同時に 25 回呼んでも、true は上限の 10 回だけ。数は 10", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)));
    expect(results.filter(Boolean)).toHaveLength(LIMIT);
    expect(await countOf(consultCallPath("u1", BEFORE_MIDNIGHT))).toBe(LIMIT);
  });

  it("日本時間の 0 時で切り替わる（前日に使い切っても、0 時を過ぎれば新しい日の分）", async () => {
    for (let i = 0; i < LIMIT; i++) await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT);
    expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)).toBe(false);
    expect(consultCallPath("u1", AFTER_MIDNIGHT)).not.toBe(consultCallPath("u1", BEFORE_MIDNIGHT));
    expect(consultCallPath("u1", AFTER_MIDNIGHT)).toBe("usage/consult-calls-2026-11-08-u1");
    expect(await reserveConsultCall("u1", AFTER_MIDNIGHT, LIMIT)).toBe(true);
    expect(await countOf(consultCallPath("u1", AFTER_MIDNIGHT))).toBe(1);
    // 前日の数はそのまま
    expect(await countOf(consultCallPath("u1", BEFORE_MIDNIGHT))).toBe(LIMIT);
  });

  it("会員ごとに別の数。文書には回数と日付と uid だけが入る", async () => {
    for (let i = 0; i < LIMIT; i++) await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT);
    expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)).toBe(false);
    expect(await reserveConsultCall("u2", BEFORE_MIDNIGHT, LIMIT)).toBe(true);
    expect((await db.doc(consultCallPath("u2", BEFORE_MIDNIGHT)).get()).data()).toEqual({ count: 1, date: "2026-11-07", uid: "u2" });
  });

  it("uid が空、または / を含むなら RangeError（文書の path を作らない）", async () => {
    await expect(reserveConsultCall("", BEFORE_MIDNIGHT, LIMIT)).rejects.toThrow(RangeError);
    await expect(reserveConsultCall("a/b", BEFORE_MIDNIGHT, LIMIT)).rejects.toThrow(RangeError);
  });
});

describe("審査員の入口の全体の回数（reserveJudgeCall）", () => {
  const JUDGE_LIMIT = 30;

  it("上限ちょうどまでは true、次は false", async () => {
    for (let i = 1; i <= JUDGE_LIMIT; i++) expect(await reserveJudgeCall(BEFORE_MIDNIGHT, JUDGE_LIMIT), `${i} 回目`).toBe(true);
    expect(await reserveJudgeCall(BEFORE_MIDNIGHT, JUDGE_LIMIT)).toBe(false);
    expect(await countOf(consultJudgePath(BEFORE_MIDNIGHT))).toBe(JUDGE_LIMIT);
  });

  it("同時に 45 回呼んでも、true は 30 回だけ", async () => {
    const results = await Promise.all(Array.from({ length: 45 }, () => reserveJudgeCall(BEFORE_MIDNIGHT, JUDGE_LIMIT)));
    expect(results.filter(Boolean)).toHaveLength(JUDGE_LIMIT);
    expect(await countOf(consultJudgePath(BEFORE_MIDNIGHT))).toBe(JUDGE_LIMIT);
  });

  it("日本時間の 0 時で切り替わる。会員の回数とは別の文書", async () => {
    for (let i = 0; i < JUDGE_LIMIT; i++) await reserveJudgeCall(BEFORE_MIDNIGHT, JUDGE_LIMIT);
    expect(await reserveJudgeCall(BEFORE_MIDNIGHT, JUDGE_LIMIT)).toBe(false);
    expect(consultJudgePath(AFTER_MIDNIGHT)).toBe("usage/consult-judge-2026-11-08");
    expect(await reserveJudgeCall(AFTER_MIDNIGHT, JUDGE_LIMIT)).toBe(true);
    expect(await reserveConsultCall("u1", BEFORE_MIDNIGHT, LIMIT)).toBe(true);
  });
});
