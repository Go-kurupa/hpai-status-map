// opsAdmin と probeEntrances へ Bearer を付けて送る URL の検査（S-11）。
// Bearer を付けて送る経路（scripts/ops.ts の runOps と fetchUsageStatus、scripts/lib/reachability.ts の probe）は、
// URL を組む前に FIREBASE_PROJECT の形を検査し、送る前に URL の検査を通す。
// 許すのは、https で、ホスト名が .cloudfunctions.net か .run.app で終わるものだけ。
// 例外は、ローカルの模擬環境の http://localhost と http://127.0.0.1。
// リダイレクトでの転送は、呼ぶ側が fetch の redirect: "error" で止める（検査を通ったホストから別のホストへ Bearer を渡さない）。

/** Firebase のプロジェクト ID の形。scripts/lib/agent-config.ts の mcpInternalUrl と同じ。 */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Bearer の送り先として許すホスト名の末尾。 */
const ALLOWED_HOST_SUFFIXES = [".cloudfunctions.net", ".run.app"] as const;

/** 比べる前に、大文字と末尾のドットを正規化する。 */
const normalizeHost = (hostname: string): string => hostname.toLowerCase().replace(/\.+$/, "");

export function isAllowedOpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = normalizeHost(u.hostname);
  if (u.protocol === "https:") return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
  return u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
}

/** 断るときの文。値は出さない（URL に何が入っているか分からない）。 */
export const urlRefused = (name: string): string =>
  `${name} は https:// で始まる関数の URL（.cloudfunctions.net か .run.app）にしてください（模擬環境は http://localhost か http://127.0.0.1 だけ許します）`;

export type FunctionUrl = { ok: true; url: string } | { ok: false; reason: "missing" | "bad_project" };

/**
 * 呼ぶ関数の URL。override（OPS_URL、PROBE_URL）があればそれ、なければ FIREBASE_PROJECT から組む。
 * 組むときは、プロジェクト ID の形を先に検査する（"x@evil.example#" のような値でホストが変わるのを防ぐ）。
 * override の scheme とホストの検査は isAllowedOpsUrl で、呼ぶ側が行う。
 */
export function functionUrl(override: string | undefined, project: string | undefined, functionName: string): FunctionUrl {
  if (override !== undefined) return override === "" ? { ok: false, reason: "missing" } : { ok: true, url: override };
  if (!project) return { ok: false, reason: "missing" };
  if (!PROJECT_ID_PATTERN.test(project)) return { ok: false, reason: "bad_project" };
  return { ok: true, url: `https://asia-northeast1-${project}.cloudfunctions.net/${functionName}` };
}

export const PROJECT_REFUSED = "FIREBASE_PROJECT の形が正しくありません（小文字の英数字とハイフンだけ）";
