// 審査員用のリンクの入口（judgeSignIn の中身）。文字列を Secret と照らす。ネットワークも模擬環境も使わない。
// 試験の文字列はダミーで、本番の値ではない。
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "firebase-functions";
import { JUDGE_UID } from "@hpai/shared/judge";
import { computeMortality, toMortalityDays } from "@hpai/shared/mortality";
import { addDays } from "@hpai/shared/dates";
import type { DeathRecord } from "@hpai/shared/types";
import { createHash } from "node:crypto";
import { handleJudgeSignIn, judgeIpKey, JUDGE_TOKEN_MAX_LENGTH, type JudgeSignInDeps } from "../src/farm/judgeSignIn";
import { judgeDeathsOn, judgeDisinfectedOn } from "../src/farm/judgeFarm";
import { judgeSignIn } from "../src/farm";

const SECRET = "test-judge-link-token-not-real";
/** 試験用の接続元（文書の例示用の範囲の IP） */
const IP = "203.0.113.7";

function setup(secret = SECRET, blocked = false, reachedLimit = false) {
  const attempt = vi.fn(async (_ipHash: string) => ({ blocked, reachedLimit }));
  const ensure = vi.fn(async () => {});
  const createToken = vi.fn(async (uid: string) => `custom-token-for-${uid}`);
  const deps: JudgeSignInDeps = { secret, attempt, ensure, createToken };
  return { deps, attempt, ensure, createToken };
}

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}

afterEach(() => vi.restoreAllMocks());

describe("handleJudgeSignIn", () => {
  it("一致すれば ensure を 1 回呼び、createToken(JUDGE_UID) の値を返す", async () => {
    const t = setup();
    expect(await handleJudgeSignIn(t.deps, SECRET)).toEqual({ customToken: `custom-token-for-${JUDGE_UID}` });
    expect(JUDGE_UID).toBe("judge-demo");
    expect(t.ensure).toHaveBeenCalledTimes(1);
    expect(t.createToken).toHaveBeenCalledTimes(1);
    expect(t.createToken).toHaveBeenCalledWith("judge-demo");
    // 農場をそろえてからトークンを作る
    expect(t.ensure.mock.invocationCallOrder[0]!).toBeLessThan(t.createToken.mock.invocationCallOrder[0]!);
  });

  it("不一致・空・数字・null・200 字超・前後の空白つきは permission-denied で、ensure も createToken も呼ばない", async () => {
    const bad: unknown[] = [
      "wrong-token",
      SECRET.slice(0, -1),
      `${SECRET}x`,
      ` ${SECRET}`,
      "",
      12345,
      null,
      undefined,
      { token: SECRET },
      "a".repeat(JUDGE_TOKEN_MAX_LENGTH + 1),
    ];
    for (const token of bad) {
      const t = setup();
      vi.spyOn(logger, "warn").mockImplementation(() => {});
      expect(await codeOf(handleJudgeSignIn(t.deps, token)), JSON.stringify(token)).toBe("permission-denied");
      expect(t.ensure).not.toHaveBeenCalled();
      expect(t.createToken).not.toHaveBeenCalled();
    }
  });

  it("200 字ちょうどの文字列は照らす（Secret が 200 字なら通る）", async () => {
    const long = "b".repeat(JUDGE_TOKEN_MAX_LENGTH);
    const t = setup(long);
    expect(await handleJudgeSignIn(t.deps, long)).toEqual({ customToken: `custom-token-for-${JUDGE_UID}` });
  });

  it("Secret が空なら、空の文字列でも何でも permission-denied", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const token of ["", SECRET, "x"]) {
      const t = setup("");
      expect(await codeOf(handleJudgeSignIn(t.deps, token))).toBe("permission-denied");
      expect(t.ensure).not.toHaveBeenCalled();
      expect(t.createToken).not.toHaveBeenCalled();
    }
  });

  it("ログとエラーの文に、送られた文字列も Secret も出さない", async () => {
    const lines: string[] = [];
    for (const k of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(logger, k).mockImplementation((...a: unknown[]) => void lines.push(JSON.stringify(a)));
    }
    const sent = "guess-token-from-outside";
    const t = setup();
    const err = await handleJudgeSignIn(t.deps, sent).catch((e: unknown) => e);
    await handleJudgeSignIn(t.deps, SECRET);
    const text = lines.join("\n") + JSON.stringify(err) + String((err as Error).message);
    expect(text).not.toContain(sent);
    expect(text).not.toContain(SECRET);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("比べ方は sha256 の timingSafeEqual（長さの違う文字列でも例外にならない）", async () => {
    const t = setup();
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await codeOf(handleJudgeSignIn(t.deps, "x"))).toBe("permission-denied");
    expect(await codeOf(handleJudgeSignIn(t.deps, "x".repeat(150)))).toBe("permission-denied");
  });
});

describe("Secret の前後の空白と改行（I-1）", () => {
  it("Secret の末尾に改行や前後の空白があっても、改行のないリンクの文字列で通る", async () => {
    for (const secret of [`${SECRET}\n`, `${SECRET}\r\n`, `  ${SECRET} \n`, `\t${SECRET}`]) {
      const t = setup(secret);
      expect(await handleJudgeSignIn(t.deps, SECRET, IP), JSON.stringify(secret)).toEqual({ customToken: `custom-token-for-${JUDGE_UID}` });
      expect(t.attempt).not.toHaveBeenCalled();
    }
  });

  it("リンクの側に空白や改行があれば、今までどおり拒否する（リンクの側は加工しない）", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const token of [` ${SECRET}`, `${SECRET} `, `${SECRET}\n`, `\n${SECRET}`]) {
      for (const secret of [SECRET, `${SECRET}\n`]) {
        const t = setup(secret);
        expect(await codeOf(handleJudgeSignIn(t.deps, token, IP)), JSON.stringify([token, secret])).toBe("permission-denied");
        expect(t.attempt).toHaveBeenCalledWith(judgeIpKey(IP));
        expect(t.ensure).not.toHaveBeenCalled();
      }
    }
  });

  it("空白と改行だけの Secret は空と同じ（誰も入れず、試行の記録にも触らない）", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const token of ["", " \n", "x", SECRET]) {
      const t = setup(" \n");
      expect(await codeOf(handleJudgeSignIn(t.deps, token, IP))).toBe("permission-denied");
      expect(t.attempt).not.toHaveBeenCalled();
      expect(t.ensure).not.toHaveBeenCalled();
    }
  });
});

describe("連打の抑え（I-2）", () => {
  it("上限に達した後の間違いは resource-exhausted で、ログを出さない。ensure も createToken も呼ばない", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const t = setup(SECRET, true);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-token", IP))).toBe("resource-exhausted");
    expect(t.ensure).not.toHaveBeenCalled();
    expect(t.createToken).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("上限に達した後も、正しい文字列は通る（試行の記録を読みも書きもしない）", async () => {
    const t = setup(SECRET, true);
    expect(await handleJudgeSignIn(t.deps, SECRET, IP)).toEqual({ customToken: `custom-token-for-${JUDGE_UID}` });
    expect(t.attempt).not.toHaveBeenCalled();
    expect(t.ensure).toHaveBeenCalledTimes(1);
  });

  it("ちょうど上限に達した 1 回だけ、要約のログ（limit_reached）を出して permission-denied", async () => {
    const lines: unknown[] = [];
    vi.spyOn(logger, "warn").mockImplementation((...a: unknown[]) => void lines.push(a[1]));
    const t = setup(SECRET, false, true);
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-token", IP))).toBe("permission-denied");
    expect(lines).toEqual([{ reason: "limit_reached", ipKnown: true }]);
    const t2 = setup();
    lines.length = 0;
    expect(await codeOf(handleJudgeSignIn(t2.deps, "wrong-token", IP))).toBe("permission-denied");
    expect(lines).toEqual([{ reason: "mismatch", ipKnown: true }]);
  });

  it("記録に渡す鍵は IP の sha256（16 進）で、IP そのものではない。間違いのときだけ記録する", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const t = setup();
    await handleJudgeSignIn(t.deps, "wrong-token", IP).catch(() => {});
    await handleJudgeSignIn(t.deps, SECRET, IP);
    expect(t.attempt.mock.calls).toEqual([[sha256hex(IP)]]);
    expect(sha256hex(IP)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t.attempt.mock.calls)).not.toContain(IP);
  });

  it("IP が取れないとき（undefined・null・空）は \"unknown\" を 1 つの鍵として数える", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const ip of [undefined, null, ""]) {
      const t = setup();
      await handleJudgeSignIn(t.deps, "wrong-token", ip).catch(() => {});
      expect(t.attempt).toHaveBeenCalledWith(sha256hex("unknown"));
    }
    expect(judgeIpKey(undefined)).toBe(judgeIpKey(null));
    expect(judgeIpKey("203.0.113.8")).not.toBe(judgeIpKey(IP));
  });

  it("形の誤り（空・文字列でない・長すぎる）は失敗に数えない（記録に触らない）", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const token of ["", 12345, null, undefined, "a".repeat(JUDGE_TOKEN_MAX_LENGTH + 1)]) {
      const t = setup();
      expect(await codeOf(handleJudgeSignIn(t.deps, token, IP))).toBe("permission-denied");
      expect(t.attempt).not.toHaveBeenCalled();
    }
  });
});

describe("途中の失敗のログ（I-5）", () => {
  type Line = [string, Record<string, unknown>];
  function captureErrors(): Line[] {
    const lines: Line[] = [];
    vi.spyOn(logger, "error").mockImplementation(((msg: string, data: Record<string, unknown>) => void lines.push([msg, data])) as never);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    return lines;
  }
  // 例外の文に Secret と IP が混ざっていても、ログとエラーには出さない
  const leaky = (code: unknown) => Object.assign(new Error(`failed for ${SECRET} from ${IP}`), { code });

  it("ensure が例外を投げたら internal。ログは段階の名前と code だけ。createToken は呼ばない", async () => {
    const lines = captureErrors();
    const t = setup();
    t.ensure.mockRejectedValueOnce(leaky(7));
    const err = await handleJudgeSignIn(t.deps, SECRET, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("internal");
    expect(t.createToken).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toEqual({ stage: "ensure", code: 7 });
    const text = JSON.stringify(lines) + JSON.stringify(err) + String((err as Error).message);
    for (const s of [SECRET, IP, "failed for"]) expect(text).not.toContain(s);
  });

  it("createToken が例外を投げたら（署名の権限不足など）internal。ログは段階の名前と code だけ", async () => {
    const lines = captureErrors();
    const t = setup();
    t.createToken.mockRejectedValueOnce(leaky("auth/insufficient-permission"));
    const err = await handleJudgeSignIn(t.deps, SECRET, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("internal");
    expect(lines.map((l) => l[1])).toEqual([{ stage: "createToken", code: "auth/insufficient-permission" }]);
    const text = JSON.stringify(lines) + JSON.stringify(err) + String((err as Error).message);
    for (const s of [SECRET, IP, "failed for"]) expect(text).not.toContain(s);
  });

  it("試行の記録が例外を投げたら internal（段階は attempts）。code のない例外は code を残さない", async () => {
    const lines = captureErrors();
    const t = setup();
    t.attempt.mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    expect(await codeOf(handleJudgeSignIn(t.deps, "wrong-token", undefined))).toBe("internal");
    expect(lines.map((l) => l[1])).toEqual([{ stage: "attempts", code: undefined }]);
    expect(t.ensure).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });
});

describe("judgeSignIn の定義", () => {
  it("Secret は JUDGE_LINK_TOKEN だけ、タイムアウトは 120 秒（最初のログインは農場の用意がある）、同時に動くのは 5 つまで", () => {
    const ep = (judgeSignIn as unknown as { __endpoint: { secretEnvironmentVariables?: Array<{ key: string }>; timeoutSeconds?: number; maxInstances?: number } }).__endpoint;
    expect((ep.secretEnvironmentVariables ?? []).map((s) => s.key)).toEqual(["JUDGE_LINK_TOKEN"]);
    expect(ep.timeoutSeconds).toBe(120);
    expect(ep.maxInstances).toBe(5);
  });
});

describe("見本の農場の作り物の記録", () => {
  it("死亡数は 0〜3 羽。1 年あまり毎日記録しても、届け出の基準（平均の 2 倍）に当たる日がない", () => {
    const from = "2026-06-01";
    for (const offset of [0, 3]) {
      const recs: DeathRecord[] = [];
      for (let i = 0; i < 400; i++) {
        const date = addDays(from, i);
        const deaths = judgeDeathsOn(date, offset);
        expect(deaths).toBeGreaterThanOrEqual(0);
        expect(deaths).toBeLessThanOrEqual(3);
        recs.push({ date, houseId: "h", deaths, flockSizeAt: offset === 0 ? 1200 : 800, exclusion: null });
        const r = computeMortality(toMortalityDays(recs), date);
        if (r.status === "evaluated") expect(r.hit, date).toBe(false);
      }
    }
  });

  it("記録に抜けがあって 21 日が 2 つの続きに分かれても、基準に当たらない", () => {
    const from = "2026-06-01";
    for (let gap = 1; gap <= 40; gap += 3) {
      for (let cut = 1; cut <= 21; cut++) {
        const recs: DeathRecord[] = [];
        for (let i = 0; i < 21 + cut + gap; i++) {
          if (i >= 21 && i < 21 + gap) continue; // 抜けた日
          const date = addDays(from, i);
          recs.push({ date, houseId: "h", deaths: judgeDeathsOn(date, 0), flockSizeAt: 1200, exclusion: null });
        }
        const today = recs[recs.length - 1]!.date;
        const r = computeMortality(toMortalityDays(recs), today);
        if (r.status === "evaluated") expect(r.hit, `${gap}/${cut}`).toBe(false);
      }
    }
  });

  it("消毒は、どの 14 日を取っても 10 日", () => {
    for (let s = 0; s < 30; s++) {
      let n = 0;
      for (let i = 0; i < 14; i++) if (judgeDisinfectedOn(addDays("2026-10-01", s + i))) n++;
      expect(n).toBe(10);
    }
  });
});
