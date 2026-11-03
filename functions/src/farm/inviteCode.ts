import { createHash, randomBytes } from "node:crypto";

/** invites/{指紋}。平文は保存しない。opsAdmin の create-invite と同じ決まり（契約 1.7）。 */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** 農場の招待の平文。128 ビットの乱数【計】。作った 1 度だけ呼び出し元へ返す。 */
export function generateInviteCode(): string {
  return randomBytes(16).toString("base64url");
}

/** 招待コードの失敗は 1 時間に 10 回まで（契約 8）。超えると、正しいコードも断る。 */
export const MAX_FAILURES_PER_HOUR = 10;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

/** 農場の招待の有効期間（7 日）。 */
export const FARM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** コードの長さの上限。これを超える入力は試行に数えず、入力の誤りとして断る。 */
export const MAX_CODE_LENGTH = 256;
