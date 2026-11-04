// 本番の動作確認と、公開前の確認。
//   runSmoke: 本番の画面、公開 API、公開 MCP、内部用 MCP に、読むだけの要求を出して確かめる。
//   runPrePublishChecks: 作業ツリーのファイルを読み、公開の前に人が入れるべき値が入っているかを確かめる。
// どちらも、結果の文に応答の本文や設定の値を写さない（状態、件数、有無だけ）。Authorization は一切送らない。
import fs from "node:fs";
import path from "node:path";

export interface SmokeResult {
  name: string;
  pass: boolean;
  detail: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 20_000;
const PUBLIC_MCP_TOOLS = ["get_area_status", "get_official_guidance", "get_watch_status", "list_cases"];
const SEASON_2025_CASES = 24;
const PAGES = ["/", "/replay", "/sample", "/results", "/public", "/privacy"] as const;

/** 1 件の確認。投げても止めず、落ちた 1 件として返す。 */
async function check(name: string, run: () => Promise<{ pass: boolean; detail: string }>): Promise<SmokeResult> {
  try {
    const r = await run();
    return { name, ...r };
  } catch (e) {
    // 応答の本文は写さない。エラーの種類の名前だけ
    return { name, pass: false, detail: `つながりませんでした（${e instanceof Error ? e.name : "error"}）` };
  }
}

const statusDetail = (status: number): string => `HTTP ${status}`;

/** JSON-RPC の応答を読む。JSON でも、event-stream（data: 行）でも。 */
async function readRpc(res: Response): Promise<unknown> {
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
    }
    throw new Error("no data");
  }
  return JSON.parse(text);
}

export async function runSmoke(baseUrl: string, internalMcpUrl: string, fetchImpl: FetchLike): Promise<SmokeResult[]> {
  const base = baseUrl.replace(/\/+$/u, "");
  const get = (url: string) => fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const results: SmokeResult[] = [];

  for (const p of PAGES) {
    results.push(
      await check(`GET ${p} が 200`, async () => {
        const res = await get(`${base}${p}`);
        return { pass: res.status === 200, detail: statusDetail(res.status) };
      }),
    );
  }

  // Hosting は存在しないファイルにも画面の HTML を 200 で返すので、形のデータであることまで見る
  results.push(
    await check("GET /geo/japan.topo.json が 200 で、形のデータ", async () => {
      const res = await get(`${base}/geo/japan.topo.json`);
      if (res.status !== 200) return { pass: false, detail: statusDetail(res.status) };
      const body = (await res.json().catch(() => null)) as { type?: unknown } | null;
      const ok = body !== null && typeof body === "object" && body.type === "Topology";
      return { pass: ok, detail: ok ? "HTTP 200、Topology" : "HTTP 200 だが形のデータではありません" };
    }),
  );

  results.push(
    await check("GET /api/v1/cases?season=2025 が 24 件", async () => {
      const res = await get(`${base}/api/v1/cases?season=2025`);
      if (res.status !== 200) return { pass: false, detail: statusDetail(res.status) };
      const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
      if (body === null || !Array.isArray(body.data)) return { pass: false, detail: "HTTP 200 だが data の配列がありません" };
      return { pass: body.data.length === SEASON_2025_CASES, detail: `${body.data.length} 件（期待 ${SEASON_2025_CASES} 件）` };
    }),
  );

  results.push(
    await check("POST /mcp の tools/list が 4 つの道具", async () => {
      const res = await fetchImpl(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) return { pass: false, detail: statusDetail(res.status) };
      const body = (await readRpc(res)) as { result?: { tools?: Array<{ name?: unknown }> } };
      const names = (body.result?.tools ?? []).map((t) => (typeof t.name === "string" ? t.name : "")).sort();
      const ok = names.length === PUBLIC_MCP_TOOLS.length && names.every((n, i) => n === PUBLIC_MCP_TOOLS[i]);
      return { pass: ok, detail: ok ? "4 つ" : `${names.length} つ（期待する 4 つと一致しません）` };
    }),
  );

  // Authorization を付けない。付けなければ 401 のはず。道具の中身には触れない
  results.push(
    await check("POST mcpInternal は Bearer なしで 401", async () => {
      const res = await fetchImpl(internalMcpUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { pass: res.status === 401, detail: `${statusDetail(res.status)}（期待 401）` };
    }),
  );

  return results;
}

// ── 公開前の確認 ──

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** `export const NAME: ... = null | "YYYY-MM-DD";` の値。読めない、形が違うときは undefined。 */
function reviewedOn(text: string | null, name: string): string | null | undefined {
  if (text === null) return undefined;
  const m = new RegExp(`export const ${name}\\b[^=]*=\\s*(null|"([^"]*)")\\s*;`, "u").exec(text);
  if (!m) return undefined;
  if (m[1] === "null") return null;
  return ISO_DATE.test(m[2] ?? "") ? m[2]! : undefined;
}

/**
 * .env の行から値（引用符を外したもの）。KEY の行でなければ undefined。
 * 引用符のない値は、行末のコメント（空白の後の # 以降）を値に入れない。引用符のある値は、閉じ引用符までが値。
 */
function envValue(text: string, key: string): string | undefined {
  let found: string | undefined;
  for (const raw of text.split(/\r?\n/u)) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "u").exec(raw);
    if (!m) continue;
    const v = m[1]!.trim();
    const quote = v[0];
    if ((quote === '"' || quote === "'") && v.indexOf(quote, 1) > 0) {
      found = v.slice(1, v.indexOf(quote, 1)).trim();
    } else if (v.startsWith("#")) {
      found = "";
    } else {
      found = v.replace(/\s+#.*$/u, "").trim();
    }
  }
  return found;
}

const OPERATOR_BEGIN = "<!-- 運営者と地域: ここから -->";
const OPERATOR_END = "<!-- 運営者と地域: ここまで -->";
const URL_PLACEHOLDERS = ["<本番の URL>", "<サイトの URL>"] as const;

/** README の運営者と地域の囲みの中に、空でも、コメントだけでもない行があるか。 */
function operatorLineFilled(readme: string | null): boolean | undefined {
  if (readme === null) return undefined;
  const from = readme.indexOf(OPERATOR_BEGIN);
  const to = readme.indexOf(OPERATOR_END);
  if (from < 0 || to < 0 || to < from) return false;
  return readme
    .slice(from + OPERATOR_BEGIN.length, to)
    .split(/\r?\n/u)
    .some((l) => l.trim() !== "" && !l.trim().startsWith("<!--"));
}

/**
 * 公開の前に、人が入れるべき値が入っているか。ファイルとシェルの環境変数（env。既定は process.env）を読む。
 * 値は表示しない（有無と、ファイル名だけ）。
 */
export function runPrePublishChecks(root: string, env: Record<string, string | undefined> = process.env): SmokeResult[] {
  const rel = (...p: string[]) => path.join(root, ...p);
  const guideOn = reviewedOn(readIfExists(rel("shared", "src", "guidance", "official.ts")), "OFFICIAL_GUIDANCE_REVIEWED_ON");
  const privacyOn = reviewedOn(readIfExists(rel("web", "src", "pages", "privacy", "privacyNotice.ts")), "PRIVACY_REVIEWED_ON");
  const out: SmokeResult[] = [];

  out.push({
    name: "OFFICIAL_GUIDANCE_REVIEWED_ON に確認日が入っている",
    pass: typeof guideOn === "string",
    detail: guideOn === undefined ? "読めないか、形が違います" : guideOn === null ? "null のままです（作者と共同経営者の確認の後に入れる）" : "確認日あり",
  });

  // 同じ確認日は、OFFICIAL_GUIDANCE_REVIEWED_ON を含む行の中だけで探す（ほかの行の日付では照らさない）
  const review = readIfExists(rel("docs", "official-text-review.md"));
  const reviewDated = typeof guideOn === "string" && review !== null && review.split(/\r?\n/u).some((l) => l.includes("OFFICIAL_GUIDANCE_REVIEWED_ON") && l.includes(guideOn));
  out.push({
    name: "docs/official-text-review.md の OFFICIAL_GUIDANCE_REVIEWED_ON の行に、同じ確認日がある",
    pass: reviewDated,
    detail:
      typeof guideOn !== "string"
        ? "照らす確認日がありません"
        : review === null
          ? "文書を読めません"
          : reviewDated
            ? "同じ日付あり"
            : "その行に同じ日付がありません",
  });

  out.push({
    name: "PRIVACY_REVIEWED_ON に確認日が入っている",
    pass: typeof privacyOn === "string",
    detail: privacyOn === undefined ? "読めないか、形が違います" : privacyOn === null ? "null のままです" : "確認日あり",
  });

  // Vite の読み込みの順（後ろが強い）。空の値で上書きされていれば、空として扱う
  let operator: string | undefined;
  for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const text = readIfExists(rel("web", f));
    const v = text === null ? undefined : envValue(text, "VITE_OPERATOR_NAME");
    if (v !== undefined) operator = v;
  }
  // シェルに export された値は、ファイルより強い（空でも上書きする）
  if (env.VITE_OPERATOR_NAME !== undefined) operator = env.VITE_OPERATOR_NAME.trim();
  out.push({
    name: "VITE_OPERATOR_NAME に値がある",
    pass: operator !== undefined && operator !== "",
    detail: operator === undefined ? "web/.env.production にも、シェルの環境変数にもありません" : operator === "" ? "空です" : "値あり（値は表示しません）",
  });

  // 本番の deploy に載る設定: functions/.env と functions/.env.<project>。模擬環境（demo-）、.env.local、見本は載らない
  const hiding: string[] = [];
  let envFiles: string[] = [];
  try {
    envFiles = fs.readdirSync(rel("functions")).filter((n) => n === ".env" || (n.startsWith(".env.") && n !== ".env.local" && n !== ".env.example" && !n.startsWith(".env.demo-") && !n.endsWith(".local")));
  } catch {
    envFiles = [];
  }
  for (const f of envFiles) {
    const text = readIfExists(rel("functions", f));
    const v = text === null ? undefined : envValue(text, "AGENT_EVAL_HIDE_PREFS");
    if (v !== undefined && v !== "") hiding.push(f);
  }
  if ((env.AGENT_EVAL_HIDE_PREFS ?? "").trim() !== "") hiding.push("シェルの環境変数");
  out.push({
    name: "AGENT_EVAL_HIDE_PREFS に値がない（本番の設定）",
    pass: hiding.length === 0,
    detail: hiding.length === 0 ? "値なし" : `値があります: ${hiding.join("、")}（値は表示しません）`,
  });

  const readme = readIfExists(rel("README.md"));
  const filled = operatorLineFilled(readme);
  out.push({
    name: "README の運営者と地域の囲みに 1 行がある",
    pass: filled === true,
    detail: filled === undefined ? "README を読めません" : filled ? "1 行あり（内容は表示しません）" : "囲みがないか、囲みの中が空です（農場名と地域の 1 行を入れる）",
  });

  const left: string[] = [];
  for (const f of ["README.md", path.join("docs", "mcp-usage.md")]) {
    const text = readIfExists(rel(f));
    if (text === null) left.push(`${f}（読めません）`);
    else if (URL_PLACEHOLDERS.some((p) => text.includes(p))) left.push(f.split(path.sep).join("/"));
  }
  out.push({
    name: "README と docs/mcp-usage.md に <本番の URL>、<サイトの URL> が残っていない",
    pass: left.length === 0,
    detail: left.length === 0 ? "残っていません" : `残っています: ${left.join("、")}`,
  });

  return out;
}

/** すべて通ったか。結果が空なら通ったとは数えない。 */
export const allPassed = (results: readonly SmokeResult[]): boolean => results.length > 0 && results.every((r) => r.pass);
