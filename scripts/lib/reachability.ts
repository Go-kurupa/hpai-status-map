// ops.ts probe の中身（F-03）。対象を組み、probeEntrances を呼び、NDJSON を残し、docs/reachability.md を作る。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { toJstIso } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import type { IsoDateTime, SourceSeed } from "@hpai/shared/types";
import type { ProbeRow, ProbeVerdict } from "../../functions/src/probe/run";
import { isAllowedOpsUrl, urlRefused } from "./opsUrl";
import { buildProbeTargets, targetsFromSources } from "./probe-targets";

const EXPECTED_NATIONAL_TITLES = 24;
const ARC_PAGES = 7;

const cell = (s: string | number | null | undefined) => String(s ?? "-").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const table = (head: string[], body: Array<Array<string | number | null>>) =>
  body.length === 0
    ? "なし\n"
    : `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${body.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")}\n`;

const prefName = (code: string | null) => PREFS.find((p) => p.code === code)?.name ?? "国など";

const CLOUD_FAILURES: ReadonlySet<ProbeVerdict> = new Set(["http_error", "network_error", "tls_error"]);

/** docs/reachability.md の本文。TSV の note は持ち込まない（ProbeRow にない）。 */
export function renderReachability(rows: readonly ProbeRow[], measuredAt: IsoDateTime): string {
  const ok = (r: ProbeRow) => r.verdict === "ok";
  const arc = rows.filter((r) => r.target.kind === "maff_arc");
  const titleSum = arc.reduce((n, r) => n + r.outbreakTitleCount, 0);
  const arcMissing = arc.filter((r) => !ok(r)).length;
  const prefRows = rows.filter((r) => r.target.prefCode !== null);

  const never: string[] = [];
  const partial: string[] = [];
  const perPref = PREFS.map(({ code, name }) => {
    const mine = prefRows.filter((r) => r.target.prefCode === code);
    const reached = mine.filter(ok).length;
    let result: string;
    if (mine.length === 0) result = "入口なし";
    else if (reached === mine.length) result = "全部届いた";
    else if (reached === 0) {
      result = "届かなかった";
      never.push(name);
    } else {
      result = "一部届かなかった";
      partial.push(name);
    }
    return [name, mine.length, reached, result];
  });

  const tls = rows.filter((r) => r.verdict === "tls_error");
  const devOk = rows.filter((r) => r.target.dev?.ok === true && !ok(r));
  const cloudFailed = devOk.filter((r) => CLOUD_FAILURES.has(r.verdict));
  const otherwise = devOk.filter((r) => !CLOUD_FAILURES.has(r.verdict));
  const noContent = rows.filter((r) => r.verdict === "reached_no_content").length;

  const sumMatch =
    titleSum === EXPECTED_NATIONAL_TITLES ? `期待値 ${EXPECTED_NATIONAL_TITLES} と一致` : `期待値 ${EXPECTED_NATIONAL_TITLES} と一致しません`;
  const lines: string[] = [
    "# 到達試験の結果",
    "",
    `測った日時: ${measuredAt}`,
    "",
    "この文書は `scripts/ops.ts probe` が作る。手で直さない。Cloud Functions から各入口へ届くかを、1 件ずつ分類した結果である。",
    "",
    "## 要約",
    "",
    `- 国の月別一覧（${ARC_PAGES} ページ）の題の合計: **${titleSum}**（${sumMatch}）`,
    ...(arc.length < ARC_PAGES || arcMissing > 0
      ? [`- 国の月別一覧は ${ARC_PAGES - arc.length + arcMissing} ページが届いていません。国は主の入口なので、ここで止めて知らせる。`]
      : []),
    `- 届いた入口: ${rows.filter(ok).length} / ${rows.length}（県の入口は ${prefRows.filter(ok).length} / ${prefRows.length}。届いたが内容が違うものが ${noContent} 件）`,
    `- 1 件も届かなかった県（${never.length}）: ${never.length > 0 ? never.join("、") : "なし"}`,
    `- 一部の入口が届かなかった県（${partial.length}）: ${partial.length > 0 ? partial.join("、") : "なし"}`,
    `- 古い TLS などで握手に失敗した入口（tls_error）: ${tls.length} 件`,
    `- 開発機で届き、この実行で届かなかった入口: ${cloudFailed.length} 件（届いたが内容が違う、または方針で取らなかった入口は ${otherwise.length} 件）`,
    "",
    "## 古い TLS（tls_error）",
    "",
    "握手の段階で失敗した入口。設定は変えない。入口ごとに扱いを決める。",
    "",
    table(
      ["県", "種類", "URL", "errorCode"],
      tls.map((r) => [prefName(r.target.prefCode), r.target.kind, r.target.url, r.errorCode]),
    ),
    "## 開発機で届き、クラウドで届かなかった入口",
    "",
    "### クラウドで届かなかった",
    "",
    table(
      ["県", "種類", "URL", "結果", "status", "errorCode"],
      cloudFailed.map((r) => [prefName(r.target.prefCode), r.target.kind, r.target.url, r.verdict, r.status, r.errorCode]),
    ),
    "### 届いたが内容が違う、または方針で取らなかった",
    "",
    table(
      ["県", "種類", "URL", "結果"],
      otherwise.map((r) => [prefName(r.target.prefCode), r.target.kind, r.target.url, r.verdict]),
    ),
    "## 都道府県ごと",
    "",
    table(["県", "入口", "届いた", "結果"], perPref),
    "## 全入口",
    "",
    table(
      ["県", "種類", "URL", "結果", "status", "errorCode", "bytes", "ms", "語", "項目", "題"],
      rows.map((r) => [
        prefName(r.target.prefCode),
        r.target.kind,
        r.target.url,
        r.verdict,
        r.status,
        r.errorCode,
        r.bytes,
        r.ms,
        r.hasWord ? "あり" : "なし",
        r.itemCount,
        r.outbreakTitleCount,
      ]),
    ),
  ];
  return lines.join("\n");
}

/** 1 行 1 件。空行と壊れた行（または形の違う行）は飛ばす。 */
export function parseNdjson(text: string): ProbeRow[] {
  const rows: ProbeRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v = JSON.parse(line) as ProbeRow;
      if (v && typeof v === "object" && typeof v.verdict === "string" && v.target && typeof v.target.url === "string") rows.push(v);
    } catch {
      // 壊れた行
    }
  }
  return rows;
}

// ── コマンド ──

export interface ProbeIo {
  env: Record<string, string | undefined>;
  readToken: () => string | null;
  fetch: typeof fetch;
  write: (s: string) => void;
  /** リポジトリの根。data/private/reach/ と docs/ をここから見る。 */
  repoRoot: string;
  now: () => Date;
}

const USAGE = `使い方:
  ops.ts probe --permanent <tsv> --entrances <tsv>
  ops.ts probe --from-sources`;

const reachDir = (root: string) => path.join(root, "data", "private", "reach");

/** probe-<YYYYMMDD>.ndjson は 1 回目、probe-<YYYYMMDD>-<n>.ndjson は n 回目。(日付, 回) の数値の順に並べる。 */
function ndjsonOrder(name: string): [number, number] | null {
  const m = /^probe-(\d{8})(?:-(\d+))?\.ndjson$/.exec(name);
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : 1] : null;
}

/** 古い順に並べた全 NDJSON の行。後の行が新しい。 */
export function loadReachRows(root: string): ProbeRow[] {
  const dir = reachDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((name) => {
      const order = ndjsonOrder(name);
      return order ? [{ name, order }] : [];
    })
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .flatMap(({ name }) => parseNdjson(fs.readFileSync(path.join(dir, name), "utf8")));
}

/** 同じ日の 2 回目以降は -2、-3 を付け、前の結果を上書きしない。 */
function nextNdjsonPath(root: string, now: Date): string {
  const dir = reachDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const day = toJstIso(now).slice(0, 10).replace(/-/g, "");
  for (let n = 1; ; n++) {
    const file = path.join(dir, `probe-${day}${n === 1 ? "" : `-${n}`}.ndjson`);
    if (!fs.existsSync(file)) return file;
  }
}

export async function runProbe(argv: string[], io: ProbeIo): Promise<number> {
  let values: { permanent?: string; entrances?: string; "from-sources"?: boolean };
  try {
    values = parseArgs({
      args: argv,
      options: { permanent: { type: "string" }, entrances: { type: "string" }, "from-sources": { type: "boolean" } },
      strict: true,
    }).values;
  } catch (e) {
    io.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const fromSources = values["from-sources"] === true;
  const hasTsv = values.permanent !== undefined && values.entrances !== undefined;
  if (fromSources === hasTsv || (!fromSources && (values.permanent === undefined) !== (values.entrances === undefined))) {
    io.write(`${USAGE}\n`);
    return 2;
  }

  const url =
    io.env.PROBE_URL ??
    (io.env.FIREBASE_PROJECT ? `https://asia-northeast1-${io.env.FIREBASE_PROJECT}.cloudfunctions.net/probeEntrances` : null);
  if (!url) {
    io.write("FIREBASE_PROJECT（または PROBE_URL）を設定してください\n");
    return 2;
  }
  const token = io.readToken();
  if (!token) {
    io.write("~/.config/hpai/ops-token がありません。bash scripts/set-ops-token.sh を先に実行してください\n");
    return 2;
  }
  // Bearer を付けて送る前の検査（S-11）。https だけ許す。値は出さない。
  if (!isAllowedOpsUrl(url)) {
    io.write(`${urlRefused("PROBE_URL")}\n`);
    return 2;
  }

  let targets;
  try {
    if (fromSources) {
      const seeds = JSON.parse(fs.readFileSync(path.join(io.repoRoot, "data", "sources.json"), "utf8")) as SourceSeed[];
      const probed = new Set(loadReachRows(io.repoRoot).map((r) => r.target.url));
      targets = targetsFromSources(seeds, probed);
    } else {
      targets = buildProbeTargets(fs.readFileSync(values.permanent!, "utf8"), fs.readFileSync(values.entrances!, "utf8"));
    }
  } catch (e) {
    io.write(`対象を読めません: ${(e as Error).message}\n`);
    return 2;
  }
  if (targets.length === 0) {
    io.write("試す入口がありません（すべて試験済みです）\n");
    return 0;
  }
  io.write(`${targets.length} 件を試します（同じホストへは 1.2 秒以上あけるので数分かかります）\n`);

  let res: Response;
  try {
    res = await io.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ targets }),
    });
  } catch {
    io.write("probeEntrances に届きませんでした\n");
    return 1;
  }
  if (!res.ok || !res.body) {
    io.write(`失敗しました（HTTP ${res.status}）\n`);
    return 1;
  }

  const file = nextNdjsonPath(io.repoRoot, io.now());
  let received = 0;
  let complete = true;
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const keep = (text: string) => {
      const rows = parseNdjson(text);
      if (rows.length > 0) fs.appendFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
      received += rows.length;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = pending.lastIndexOf("\n");
      if (cut >= 0) {
        keep(pending.slice(0, cut));
        pending = pending.slice(cut + 1);
      }
    }
    keep(pending + decoder.decode());
  } catch {
    complete = false;
  }

  if (!complete || received < targets.length) {
    io.write(`応答が途中で切れました（${received} / ${targets.length} 件）。届いた分は ${path.relative(io.repoRoot, file)} に残しました。docs は書き換えません\n`);
    return 1;
  }

  // 前の日の結果も含め、URL ごとに新しい行を採って文書にする
  const latest = new Map<string, ProbeRow>();
  for (const r of loadReachRows(io.repoRoot)) latest.set(r.target.url, r);
  const docsFile = path.join(io.repoRoot, "docs", "reachability.md");
  fs.mkdirSync(path.dirname(docsFile), { recursive: true });
  fs.writeFileSync(docsFile, renderReachability([...latest.values()], toJstIso(io.now())));
  io.write(`${received} 件の結果を ${path.relative(io.repoRoot, file)} に、まとめを docs/reachability.md に書きました\n`);
  return 0;
}
