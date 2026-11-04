// 舞台裏（X-07）。去年 12 月の再現に出てくる文書を事前に Claude で読み、照合と二重読みの結果と、実際にかかった使用量を
// data/replay/ に置く。ここはその実行の本体で、scripts/build-backstage.ts は入口だけ。
//
// **有料の Claude API を呼ぶのは `--yes` が付いたときだけ。** それ以外では client（makeClient）を作らない。
// 控え（原本）は data/private/replay-cache/（公開しない）。読みの結果も同じ所に残し、再実行で二度と支払わない。
// 本文や引用は公開のファイルに置かない（BackstageEntry は短い語と値だけ。shared/src/replay.ts）。
import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { toJstIso } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { compareReads } from "@hpai/shared/read/compare";
import { muniCoreName } from "@hpai/shared/read/names";
import type { DocumentKind, ReadResult, SecondReadResult, VerifyReport } from "@hpai/shared/read/types";
import { verifyRead } from "@hpai/shared/read/verify";
import {
  REPLAY_SEASON,
  tamperRadius,
  tamperSecondMuni,
  toBackstageEntry,
  UNMEASURED_BACKSTAGE,
  UNMEASURED_USAGE,
  type BackstageEntry,
  type BackstageFile,
  type MeasuredUsage,
  type ModelTokens,
  type ReplayScenario,
} from "@hpai/shared/replay";
import type { Case, CaseStage, IsoDate, PrefCode, RuntimeSettings } from "@hpai/shared/types";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { readPrimary, readSecond, type ReadAttempt, type ReadInput } from "../../functions/src/read/claude";
import { decodeBody, extractHtml, extractPdfText } from "../../functions/src/watch/extract";

export { UNMEASURED_BACKSTAGE, UNMEASURED_USAGE };

// ── 文書の一覧（data/replay/docs.json）──
export interface BackstageDoc {
  id: string;
  /** 文書の題（公開されている見出し。読み手に渡す） */
  title: string;
  url: string;
  contentType: "html" | "pdf";
  /** 県のサイトの文書なら、その県。国と市のページは null（引用に県名が要る） */
  sourcePrefCode: PrefCode | null;
  /** 文書の発表日（文書に書かれた日。『本日』だけの引用の日付を決める） */
  announcedOn: IsoDate | null;
  /** scenario の出来事（出典がこの文書そのもの）。結びつかなければ null */
  eventOrder: number | null;
  /** scenario と食い違えば止めるための期待値。キーがなければ見ない。null は『読み取りも null であること』 */
  expect: { kind?: DocumentKind; muniCode?: string; primaryStage?: CaseStage | null; primaryDate?: IsoDate | null };
}
export interface DocsFile {
  docs: BackstageDoc[];
}

export interface BackstageArgs {
  yes: boolean;
  fetch: boolean;
  remeasure: boolean;
}

/** 知らない引数は throw する（綴り違いで有料の実行にならないように、--yes は完全一致だけ） */
export function parseBackstageArgs(argv: string[]): BackstageArgs {
  const { values } = parseArgs({
    args: argv,
    options: { yes: { type: "boolean" }, fetch: { type: "boolean" }, remeasure: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  return { yes: values.yes === true, fetch: values.fetch === true, remeasure: values.remeasure === true };
}

export interface BackstageDeps {
  files: { docs: string; backstage: string; usage: string; scenario: string };
  /** 原本の控えと読みの結果の置き場所（公開しない） */
  cacheDir: string;
  log: (line: string) => void;
  /** 有料の client。`--yes` が付き、読みの結果の控えがない文書があるときだけ、1 回呼ぶ */
  makeClient: () => Anthropic;
  loadGeo: () => Promise<GeoStore>;
  now: () => Date;
  /** `--fetch` のときだけ使う。取れなければ null（再試行しない） */
  fetchOne?: (doc: BackstageDoc) => Promise<Buffer | null>;
  extractPdf?: (body: Buffer) => Promise<{ text: string; pages: number; hasTextLayer: boolean }>;
  settings?: RuntimeSettings;
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const writeJson = (file: string, v: unknown): void => fs.writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);

export const cacheFileName = (doc: Pick<BackstageDoc, "id" | "contentType">): string => `${doc.id}.${doc.contentType}`;
const readsFileName = (doc: Pick<BackstageDoc, "id">): string => `${doc.id}.reads.json`;

// ── 読みの結果の控え ──
interface SavedUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
interface SavedReads {
  primary?: { value: ReadResult; usage: SavedUsage };
  second?: { value: SecondReadResult; usage: SavedUsage };
}
function savedUsage(model: string, u: Anthropic.Usage): SavedUsage {
  return { model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
}
function loadReads(file: string): SavedReads {
  try {
    return fs.existsSync(file) ? readJson<SavedReads>(file) : {};
  } catch {
    return {};
  }
}

// ── 入力（本番の pipeline.judge と同じ作り）──
interface LoadedDoc {
  input: ReadInput;
  /** 照合に渡す本文（題を含まない） */
  text: string;
  /** 題と本文（20 字の写しの確認と、語の検索に使う） */
  docText: string;
  hasTextLayer: boolean;
}
async function loadDoc(doc: BackstageDoc, body: Buffer, extractPdf: NonNullable<BackstageDeps["extractPdf"]>): Promise<LoadedDoc> {
  if (doc.contentType === "pdf") {
    const ex = await extractPdf(body);
    // PDF と本文が両方あるときは PDF だけを送る（claude.ts）
    return { input: { title: doc.title, url: doc.url, text: null, pdfBase64: body.toString("base64") }, text: ex.text, docText: `${doc.title}\n${ex.text}`, hasTextLayer: ex.hasTextLayer };
  }
  const text = extractHtml(decodeBody(body, "text/html"), doc.url).text;
  return { input: { title: doc.title, url: doc.url, text, pdfBase64: null }, text, docText: `${doc.title}\n${text}`, hasTextLayer: text.trim() !== "" };
}

/** 出来事の直前の同じ事例（verifyRead の chronology に渡す） */
function previousCase(scenario: ReplayScenario, eventOrder: number | null): Case | null {
  if (eventOrder === null) return null;
  const e = scenario.events.find((x) => x.order === eventOrder);
  if (!e) return null;
  const earlier = scenario.events.filter((x) => x.order < eventOrder && x.caseAfter.id === e.caseAfter.id);
  return earlier.length > 0 ? earlier[earlier.length - 1]!.caseAfter : null;
}

/** 別の町の名前（別の読み手の市町村の入れ替え先）。scenario にある、この市町村と違う町 */
function otherMuniName(scenario: ReplayScenario, muni: string): string | null {
  const core = muniCoreName(muni);
  const other = scenario.events.map((e) => e.caseAfter.muniName).find((n): n is string => n !== null && muniCoreName(n) !== core);
  return other ?? null;
}

function expectMismatches(doc: BackstageDoc, read: ReadResult, verify: VerifyReport): string[] {
  const out: string[] = [];
  const e = doc.expect;
  if (e.kind !== undefined && read.kind !== e.kind) out.push("kind");
  if (e.muniCode !== undefined && verify.normalized?.muniCode !== e.muniCode) out.push("muniCode");
  if (e.primaryStage !== undefined && read.primaryStage !== e.primaryStage) out.push("primaryStage");
  if (e.primaryDate !== undefined && (verify.normalized?.primaryStamp?.date ?? null) !== e.primaryDate) out.push("primaryDate");
  return out;
}

/** scenario の出来事に backstageId を入れる（文書が出典そのものの出来事だけ）。元を書き換えない */
export function assignBackstageIds(scenario: ReplayScenario, docs: readonly BackstageDoc[]): ReplayScenario {
  const byOrder = new Map(docs.flatMap((d) => (d.eventOrder === null ? [] : [[d.eventOrder, d.id] as const])));
  return { ...scenario, events: scenario.events.map((e) => ({ ...e, backstageId: byOrder.get(e.order) ?? e.backstageId })) };
}

// ── データの検査（測っていない状態と、測った後の規則）──
export function checkBackstageData(i: { docs: DocsFile; backstage: BackstageFile; usage: MeasuredUsage; scenario: ReplayScenario }): string[] {
  const p: string[] = [];
  const { backstage: b, usage: u, scenario: s, docs } = i;
  if (b.status !== u.status) p.push(`状態が揃っていません: backstage.json は ${b.status}、measured-usage.json は ${u.status}（使用量の状態）`);

  if (b.status === "unmeasured") {
    if (b.entries.length !== 0) p.push("測っていないのに entries がある");
    if (b.measuredAt !== null) p.push("測っていないのに backstage.json の measuredAt がある");
    if (u.documents !== 0 || Object.keys(u.byModel).length !== 0) p.push("測っていないのに使用量がある（documents / byModel）");
    if (u.measuredAt !== null) p.push("測っていないのに measured-usage.json の measuredAt がある");
    if (s.events.some((e) => e.backstageId !== null)) p.push("測っていないのに scenario の backstageId がある（指す先がありません）");
    return p;
  }

  // 測った後
  if (b.measuredAt === null) p.push("測ったのに backstage.json の measuredAt がない");
  if (u.status !== "measured") p.push("測ったのに使用量が未計測のまま（measured-usage.json）");
  else {
    if (u.measuredAt === null) p.push("測ったのに measured-usage.json の measuredAt がない");
    if (Object.keys(u.byModel).length === 0) p.push("測ったのに使用量の byModel が空");
    if (u.documents !== docs.docs.length) p.push(`使用量の documents ${u.documents} が文書の数 ${docs.docs.length} と違う`);
  }
  const byId = new Map(b.entries.map((e) => [e.id, e]));
  for (const d of docs.docs) if (!byId.has(d.id)) p.push(`文書 ${d.id} の項目がない`);
  for (const e of s.events) if (e.backstageId !== null && !byId.has(e.backstageId)) p.push(`order ${e.order} の backstageId ${e.backstageId} の項目がない`);

  for (const d of docs.docs) {
    if (d.eventOrder === null) continue;
    const ev = s.events.find((x) => x.order === d.eventOrder);
    if (!ev) {
      p.push(`文書 ${d.id} の eventOrder ${d.eventOrder} が scenario にない`);
      continue;
    }
    if (ev.backstageId !== d.id) p.push(`order ${ev.order} の backstageId が ${d.id} ではない`);
    const entry = byId.get(d.id);
    if (!entry) continue;
    const muni = entry.primary.find((r) => r.field === "municipality")?.value ?? null;
    if (muni === null || muniCoreName(muni) !== muniCoreName(ev.caseAfter.muniName ?? "")) p.push(`文書 ${d.id} の municipality が scenario と一致しない`);
    const date = entry.primary.find((r) => r.field === "primaryDate")?.value ?? null;
    if (date === null || !date.startsWith(ev.date)) p.push(`文書 ${d.id} の primaryDate が scenario の ${ev.date} と一致しない`);
  }

  const demos = b.entries.flatMap((e) => (e.tamperedDemo === null ? [] : [e.tamperedDemo]));
  if (demos.length < 2) p.push(`tamperedDemo が ${demos.length} 行しかない（2 行以上が要る）`);
  for (const need of ["radius_sentence", "compare"] as const) if (!demos.some((x) => x.rejectedBy === need)) p.push(`tamperedDemo に ${need} がない`);
  return p;
}

// ── 実行 ──
const sum = (a: ModelTokens | undefined, u: SavedUsage): ModelTokens => ({
  inputTokens: (a?.inputTokens ?? 0) + u.input,
  outputTokens: (a?.outputTokens ?? 0) + u.output,
  cacheReadTokens: (a?.cacheReadTokens ?? 0) + u.cacheRead,
  cacheWriteTokens: (a?.cacheWriteTokens ?? 0) + u.cacheWrite,
});

function failLine(doc: BackstageDoc, role: string, a: Extract<ReadAttempt<unknown>, { ok: false }>): string {
  const u = a.usage ? ` usage(input=${a.usage.input_tokens}, output=${a.usage.output_tokens})` : "";
  return `読めませんでした: ${doc.id} ${role} ${a.reason}:${a.detail}${u}`; // 本文と引用は出さない
}

/** 戻り値は終了コード: 0 成功、1 失敗（止めた）、2 実行しなかった（--yes がない、または測り済み） */
export async function runBackstage(argv: string[], deps: BackstageDeps): Promise<number> {
  const args = parseBackstageArgs(argv);
  const s = deps.settings ?? DEFAULT_RUNTIME_SETTINGS;
  const extractPdf = deps.extractPdf ?? extractPdfText;
  const { docs } = readJson<DocsFile>(deps.files.docs);
  const scenario = readJson<ReplayScenario>(deps.files.scenario);
  const current = readJson<BackstageFile>(deps.files.backstage);
  const cachePath = (d: BackstageDoc) => path.join(deps.cacheDir, cacheFileName(d));

  // 原本を取る（無料。--fetch のときだけ。置いてあるものは取り直さない）
  if (args.fetch) {
    if (!deps.fetchOne) {
      deps.log("--fetch は、この入口では使えません");
      return 1;
    }
    fs.mkdirSync(deps.cacheDir, { recursive: true });
    for (const d of docs.filter((x) => !fs.existsSync(cachePath(x)))) {
      const body = await deps.fetchOne(d);
      if (body === null) deps.log(`取れませんでした: ${d.id}（再試行しません。原本を data/private/replay-cache/${cacheFileName(d)} に置いてください）`);
      else fs.writeFileSync(cachePath(d), body);
    }
  }

  const missing = docs.filter((d) => !fs.existsSync(cachePath(d)));
  const unread = docs.filter((d) => loadReads(path.join(deps.cacheDir, readsFileName(d))).second === undefined);

  if (!args.yes) {
    deps.log(`有料の呼び出しをする計画です: 文書 ${docs.length} 本 × 主と別の読み手の 2 つ = 最大 ${docs.length * 2} 回（モデル ${s.primaryModel} と ${s.secondModel}）。`);
    deps.log(`控え（原本）: ${docs.length - missing.length} 本がある、${missing.length} 本がない${missing.length > 0 ? `（${missing.map((d) => d.id).join("、")}）` : ""}。読みの結果の控え: ${docs.length - unread.length} 本。`);
    deps.log("まだ何も呼んでいません。人が支払いの上限を置いた後に、--yes を付けて実行してください。");
    return 2;
  }
  if (current.status === "measured" && !args.remeasure) {
    deps.log("測り済みです。上書きするには --remeasure を付けてください（読みの結果の控えは使うので、支払いは増えません）。");
    return 2;
  }
  const needBody = docs.filter((d) => missing.includes(d));
  if (needBody.length > 0) {
    deps.log(`原本の控えがありません: ${needBody.map((d) => d.id).join("、")}（data/private/replay-cache/ に置くか、--fetch を付けてください）`);
    return 1;
  }

  const geo = await deps.loadGeo();
  await geo.ensurePrefs([...new Set(docs.flatMap((d) => (d.expect.muniCode ? [d.expect.muniCode.slice(0, 2)] : [])))]);

  let client: Anthropic | null = null;
  const usageByModel: Record<string, ModelTokens> = {};
  const entries: BackstageEntry[] = [];
  const mismatches: string[] = [];
  const notes: string[] = [];
  let radiusDemo = false;
  let compareDemo = false;

  for (const doc of docs) {
    const loaded = await loadDoc(doc, fs.readFileSync(cachePath(doc)), extractPdf);
    const readsFile = path.join(deps.cacheDir, readsFileName(doc));
    const saved = loadReads(readsFile);
    if (saved.primary === undefined) {
      client ??= deps.makeClient();
      const a = await readPrimary(client, loaded.input, s);
      if (!a.ok) {
        deps.log(failLine(doc, "primary", a));
        return 1; // 同じ呼び出しを繰り返さない。原因を見てから
      }
      saved.primary = { value: a.value, usage: savedUsage(s.primaryModel, a.usage) };
      writeJson(readsFile, saved);
    }
    if (saved.second === undefined) {
      client ??= deps.makeClient();
      const a = await readSecond(client, loaded.input, s);
      if (!a.ok) {
        deps.log(failLine(doc, "second", a));
        return 1;
      }
      saved.second = { value: a.value, usage: savedUsage(s.secondModel, a.usage) };
      writeJson(readsFile, saved);
    }
    const read = saved.primary.value;
    const second = saved.second.value;
    for (const u of [saved.primary.usage, saved.second.usage]) usageByModel[u.model] = sum(usageByModel[u.model], u);

    const previous = previousCase(scenario, doc.eventOrder);
    const vdoc = { text: loaded.text, hasTextLayer: loaded.hasTextLayer, season: REPLAY_SEASON };
    const opts = { sourcePrefCode: doc.sourcePrefCode, announcedOn: doc.announcedOn, title: doc.title };
    const verify = verifyRead(read, vdoc, geo, previous, opts);
    const compare = compareReads(read, second, verify);

    // scenario の出来事に結びつく文書だけが、scenario と食い違えば止める。出来事のない文書（進捗報、市のページ）は、
    // 食い違いを記録して続ける（読み切れなかったことも、舞台裏に正直に出す）
    const bad = expectMismatches(doc, read, verify);
    if (bad.length > 0) (doc.eventOrder !== null ? mismatches : notes).push(`${doc.id}: ${bad.join("、")}`);

    let entry = toBackstageEntry({ id: doc.id, url: doc.url, read, second, verify, compare, docText: loaded.docText, hadPrevious: previous !== null });

    // 値を入れ替えて、本当に落ちたものだけを記録する（最初の半径のある文書に半径、次に二重読みの文書に市町村）
    if (!radiusDemo) {
      const t = tamperRadius(read);
      if (t !== null) {
        const v = verifyRead(t, vdoc, geo, previous, opts);
        const was = verify.issues.some((x) => x.check === "radius_sentence");
        if (!was && v.issues.some((x) => x.check === "radius_sentence")) {
          entry = { ...entry, tamperedDemo: { field: "radiiKm", before: `${read.radiiKm[0]!.km}km`, after: `${t.radiiKm[0]!.km}km`, rejectedBy: "radius_sentence" } };
          radiusDemo = true;
        }
      }
    }
    if (entry.tamperedDemo === null && !compareDemo && compare.match && read.municipality.value !== null) {
      const other = otherMuniName(scenario, read.municipality.value);
      if (other !== null) {
        const c = compareReads(read, tamperSecondMuni(second, other), verify);
        if (!c.match && c.mismatches.includes("municipality")) {
          entry = { ...entry, tamperedDemo: { field: "municipality", before: second.municipality ?? read.municipality.value, after: other, rejectedBy: "compare" } };
          compareDemo = true;
        }
      }
    }
    entries.push(entry);
  }

  if (mismatches.length > 0) {
    // 項目名だけを出す。原本を開いて、どちらが正しいかを利用者に報告する
    deps.log("scenario と違います（項目名だけ）:");
    for (const m of mismatches) deps.log(`  ${m}`);
    deps.log("何も書いていません。原本を開いて確かめてください（読みの結果の控えは残してあるので、直した後の再実行は支払いません）。");
    return 1;
  }

  const measuredAt = toJstIso(deps.now());
  const backstage: BackstageFile = { status: "measured", measuredAt, entries };
  const usage: MeasuredUsage = { status: "measured", documents: docs.length, byModel: usageByModel, measuredAt };
  const next = assignBackstageIds(scenario, docs);
  const problems = checkBackstageData({ docs: { docs }, backstage, usage, scenario: next });
  if (problems.length > 0) {
    deps.log("測った結果がデータの規則を満たしません。何も書いていません:");
    for (const x of problems) deps.log(`  ${x}`);
    return 1;
  }
  writeJson(deps.files.usage, usage);
  writeJson(deps.files.backstage, backstage);
  writeJson(deps.files.scenario, next);
  for (const n of notes) deps.log(`出来事に結びつかない文書で、期待と違う項目（止めずに書きました。項目名だけ）: ${n}`);
  deps.log(`書きました: 文書 ${docs.length} 本、tamperedDemo ${entries.filter((e) => e.tamperedDemo !== null).length} 行。使用量は measured-usage.json にあります（請求画面の実測と照らしてください）。`);
  return 0;
}
