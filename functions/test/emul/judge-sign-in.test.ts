// 審査員用のリンクの連打の抑え（I-2）。handleJudgeSignIn と、Firestore の試行の記録（firestoreJudgeAttempt）を模擬環境（demo-hpai）でつなぐ。
// 農場の用意（ensure）とトークン（createToken）は偽物にして、数え方だけを確かめる。試験の文字列と IP はダミー。
import { createHash } from "node:crypto";
import { logger } from "firebase-functions";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/admin";
import { FAILURE_WINDOW_MS } from "../../src/farm/inviteCode";
import { firestoreJudgeAttempt, JUDGE_MAX_FAILURES_PER_HOUR, judgeAttemptsRef } from "../../src/farm/judgeAttempts";
import { handleJudgeSignIn, judgeIpKey, type JudgeSignInDeps } from "../../src/farm/judgeSignIn";

const PROJECT = "demo-hpai";
const SECRET = "test-judge-link-token-not-real";
const IP_A = "203.0.113.10";
const IP_B = "198.51.100.20";
const T0 = new Date("2026-11-08T10:00:00+09:00");

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let clock = T0;
function setup() {
  const ensure = vi.fn(async () => {});
  const createToken = vi.fn(async (uid: string) => `custom-token-for-${uid}`);
  const deps: JudgeSignInDeps = { secret: SECRET, attempt: firestoreJudgeAttempt(db, () => clock), ensure, createToken };
  return { deps, ensure, createToken };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}

/** 違う文字列で n 回失敗させる（どれも permission-denied のはず） */
async function failTimes(deps: JudgeSignInDeps, n: number, ip: string | undefined) {
  for (let i = 0; i < n; i++) expect(await codeOf(handleJudgeSignIn(deps, `wrong-${i}`, ip))).toBe("permission-denied");
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  clock = T0;
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});
afterEach(() => vi.restoreAllMocks());

describe("judgeSignIn の連打の抑え（IP ごと、1 時間に 20 回。正しい文字列は必ず通す）", () => {
  it("20 回間違えるまでは permission-denied。20 回に達した後の間違いは resource-exhausted で、数えない", async () => {
    expect(JUDGE_MAX_FAILURES_PER_HOUR).toBe(20);
    const t = setup();
    await failTimes(t.deps, 20, IP_A);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-again", IP_A))).toBe("resource-exhausted");
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-again-2", IP_A))).toBe("resource-exhausted");
    expect(t.ensure).not.toHaveBeenCalled();
    expect(t.createToken).not.toHaveBeenCalled();
    // 断った回は数えない（20 のまま）
    expect((await judgeAttemptsRef(db, judgeIpKey(IP_A)).get()).get("failures")).toBe(20);
  });

  it("上限に達した後も、正しい文字列は通る。失敗の数は数えも消しもしない", async () => {
    const t = setup();
    await failTimes(t.deps, 20, IP_A);
    const before = (await judgeAttemptsRef(db, judgeIpKey(IP_A)).get()).data();
    expect(await codeOf(handleJudgeSignIn(t.deps, SECRET, IP_A))).toBe("ok");
    expect(t.ensure).toHaveBeenCalledTimes(1);
    expect((await judgeAttemptsRef(db, judgeIpKey(IP_A)).get()).data()).toEqual(before);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-again", IP_A))).toBe("resource-exhausted");
  });

  it("文書は invites/_judgeAttempts/ips/{IP の sha256}。中身は失敗の数と窓の始まりだけで、IP を含まない", async () => {
    const t = setup();
    await failTimes(t.deps, 3, IP_A);
    const ref = judgeAttemptsRef(db, sha256hex(IP_A));
    expect(ref.path).toBe(`invites/_judgeAttempts/ips/${sha256hex(IP_A)}`);
    const data = (await ref.get()).data();
    expect(data).toEqual({ failures: 3, windowStart: "2026-11-08T10:00:00+09:00" });
    const all = await db.collection("invites").doc("_judgeAttempts").collection("ips").get();
    expect(all.docs.map((d) => d.id)).toEqual([sha256hex(IP_A)]);
    expect(JSON.stringify(all.docs.map((d) => [d.id, d.data()]))).not.toContain(IP_A);
  });

  it("正しい文字列で入っただけなら、記録を書かない", async () => {
    const t = setup();
    expect(await codeOf(handleJudgeSignIn(t.deps, SECRET, IP_A))).toBe("ok");
    expect((await judgeAttemptsRef(db, judgeIpKey(IP_A)).get()).exists).toBe(false);
  });

  it("IP が違えば別々に数える（A が上限でも B の間違いは permission-denied）", async () => {
    const t = setup();
    await failTimes(t.deps, 20, IP_A);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-x", IP_A))).toBe("resource-exhausted");
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-x", IP_B))).toBe("permission-denied");
  });

  it("IP が取れない人どうしは \"unknown\" の 1 つの鍵にまとまる（それでも正しい文字列は通る）", async () => {
    const t = setup();
    await failTimes(t.deps, 10, undefined);
    await failTimes(t.deps, 10, "");
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-x", undefined))).toBe("resource-exhausted");
    expect((await judgeAttemptsRef(db, sha256hex("unknown")).get()).get("failures")).toBe(20);
    expect(await codeOf(handleJudgeSignIn(t.deps, SECRET, undefined))).toBe("ok");
  });

  it("1 時間たつと窓が新しくなり、間違いはまた permission-denied（失敗の数は 1 から数え直す）", async () => {
    const t = setup();
    await failTimes(t.deps, 20, IP_A);
    clock = new Date(T0.getTime() + FAILURE_WINDOW_MS - 1000);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-x", IP_A))).toBe("resource-exhausted");
    clock = new Date(T0.getTime() + FAILURE_WINDOW_MS);
    await failTimes(t.deps, 1, IP_A);
    expect((await judgeAttemptsRef(db, judgeIpKey(IP_A)).get()).data()).toEqual({ failures: 1, windowStart: "2026-11-08T11:00:00+09:00" });
  });
});
