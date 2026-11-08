// 審査員用のリンク（/judge#<秘密の文字列>）の入口。文字列を Secret（JUDGE_LINK_TOKEN）と照らし、
// 合えば審査員の会員と農場をそろえて（ensureJudgeFarm）、その会員のカスタムトークンを返す。
// 合わなければ permission-denied で、会員も農場も作らない。文字列・Secret・IP はログにもエラーの文にも出さない。
// 連打の抑え: 接続元の IP（sha256 にした値）ごとに、1 時間の窓で間違いが 20 回に達したら、その後の間違いは resource-exhausted。
// 正しい文字列は回数にかかわらず必ず通す（IP が 1 つにまとまっても審査員を締め出さない。抑えは費用とログの量のため）。
import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { JUDGE_UID } from "@hpai/shared/judge";
import type { JudgeAttempt } from "./judgeAttempts";

/** リンクの文字列の長さの上限（これを超えたら照らさずに断る） */
export const JUDGE_TOKEN_MAX_LENGTH = 200;

/** IP が取れないときの鍵（取れない人どうしは 1 つにまとめて数える） */
export const UNKNOWN_IP = "unknown";

export interface JudgeSignInDeps {
  /** Secret の値。前後の空白と改行は除いて使う。除いて空なら誰も入れない */
  secret: string;
  /** 照らした結果を IP ごとに記録し、断るべきかを返す（judgeAttempts.ts） */
  attempt: JudgeAttempt;
  /** 審査員の会員と農場をそろえる */
  ensure: () => Promise<void>;
  /** その uid のカスタムトークンを作る */
  createToken: (uid: string) => Promise<string>;
}

const sha256 = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

/** 接続元の IP を、保存してよい形（sha256 の 16 進）にする。取れなければ "unknown" を同じように */
export function judgeIpKey(ip: string | null | undefined): string {
  return sha256(typeof ip === "string" && ip !== "" ? ip : UNKNOWN_IP).toString("hex");
}

/** 長さの違いを漏らさないよう、両方を sha256 にしてから時間の一定な比べ方で比べる */
function matches(token: string, secret: string): boolean {
  return timingSafeEqual(sha256(token), sha256(secret));
}

/** 例外の code だけを取り出す（文字列か数のときだけ。メッセージは出さない） */
function codeOf(e: unknown): string | number | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/** 段階の名前と code だけをログに残し、internal にする */
async function step<T>(stage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    logger.error("審査員のログインの途中で失敗しました", { stage, code: codeOf(e) });
    throw new HttpsError("internal", "うまくいきませんでした。少したってからもう一度開いてください");
  }
}

/**
 * `{token}` の token を受けて `{customToken}` を返す。
 * - Secret が（前後の空白を除いて）空: permission-denied（記録に触らない）
 * - 文字列でない・空・長すぎる: permission-denied（形の誤りは失敗に数えない。redeemInvite と同じ）
 * - 合う: 回数にかかわらず必ず通す（試行の記録を読みも書きもしない。2026-11-08 PM の決定）
 * - 合わない: IP ごとの間違いが窓の中で 20 回に達していれば、数えずログも出さずに resource-exhausted。
 *   達していなければ 1 足して permission-denied（ちょうど 20 回に達した 1 回だけ、要約のログ limit_reached を出す）
 * リンクの側の文字列は加工しない（前後に空白があれば合わない）。
 */
export async function handleJudgeSignIn(
  deps: JudgeSignInDeps,
  token: unknown,
  ip?: string | null,
): Promise<{ customToken: string }> {
  const ipKnown = typeof ip === "string" && ip !== "";
  const denied = (reason: string): HttpsError => {
    // 理由の種類だけを残す（文字列そのもの・長さ・IP は残さない）
    logger.warn("審査員のログインを断りました", { reason, ipKnown });
    return new HttpsError("permission-denied", "このリンクは使えません");
  };
  const secret = deps.secret.trim();
  if (secret === "") throw denied("no_secret");
  if (typeof token !== "string" || token === "" || token.length > JUDGE_TOKEN_MAX_LENGTH) throw denied("bad_input");

  if (!matches(token, secret)) {
    const { blocked, reachedLimit } = await step("attempts", () => deps.attempt(judgeIpKey(ip)));
    // 上限に達した後の間違いは、ログを出さずに断る（ログの量を抑える）
    if (blocked) throw new HttpsError("resource-exhausted", "試した回数が多すぎます。1 時間ほどたってからもう一度開いてください");
    throw denied(reachedLimit ? "limit_reached" : "mismatch");
  }

  await step("ensure", () => deps.ensure());
  return { customToken: await step("createToken", () => deps.createToken(JUDGE_UID)) };
}
