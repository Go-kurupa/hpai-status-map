// X-20: ソースと同梱データの文言の総点検。画面、メール、API の文面のもとになる文字に、禁句と過去の発生の NG の語がないこと。
//   ソース: web/src、shared/src、functions/src/{notify,api,mcp,drafts}（wording.ts と試験を除く）、data/replay/*.json、data/trends/*.json、README.md。
//   公式の文: OFFICIAL_GUIDANCE の各文に sourceUrl と checkedOn。
//   確認リスト: always に「義務ではない」がなく、good_to_check の見出しにある。level 2〜4 に if_in_zone の節がない。
// ソースの注釈（// と /* */）は画面にも文面にも出ないので、esbuild で取り除いてから調べる（「安全と書かない」という注意書きに当たらないため）。
// 文字列、JSX の文字は残る。禁句を検出する正規表現のような、コードの中の語は取り除かない。
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildChecklist } from "@hpai/shared/checklist";
import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import type { ChecklistClass, FarmHousing, Level, Production } from "@hpai/shared/types";
import { normalizeForMatch } from "@hpai/shared/text";
import { findForbiddenPhrases } from "@hpai/shared/wording";

/**
 * 過去の発生について言わないこと（設計書 §11 の表の「言わないこと」）。web/e2e/wording.helper.ts の PAST_NG_PATTERNS と同じ内容。
 * （helper は DOM の型を使う画面の試験の部品で、DOM の型のない tsconfig からは import できないので、写している）
 */
const PAST_NG: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "また発生しやすい", re: /また発生しやすい/u },
  { label: "この町も危ない", re: /この町も危ない/u },
  { label: "隣町からうつる", re: /隣町からうつる/u },
  { label: "危険地帯", re: /危険地帯/u },
  { label: "ホットスポット", re: /ホットスポット/u },
  { label: "X km 以内なら感染確率は Y%", re: /\d+(?:\.\d+)?km以内なら|感染確率は?\d+(?:\.\d+)?%/u },
  { label: "発生の N 割は農場間", re: /発生の\d+割は農場間/u },
];

/** 禁句と過去の発生の NG の語。見つかった語の一覧 */
function findWordingViolations(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return [...findForbiddenPhrases(text), ...PAST_NG.filter((p) => p.re.test(normalized)).map((p) => p.label)];
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

/** 親の下の全ファイル（絶対パス） */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const isTest = (f: string) => /\.test\.(ts|tsx)$/u.test(f) || f.includes(`${path.sep}test${path.sep}`);
const sourceFiles = (dir: string, exts: readonly string[]) => walk(path.join(ROOT, dir)).filter((f) => exts.some((x) => f.endsWith(x)) && !isTest(f));

/** 注釈を取り除いた、画面や文面に出うる文字。ts と tsx は esbuild、css は /* *\/ を取る */
function strippedText(file: string): string {
  const src = fs.readFileSync(file, "utf8");
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    return transformSync(src, { loader: file.endsWith(".tsx") ? "tsx" : "ts", charset: "utf8", legalComments: "none" }).code;
  }
  if (file.endsWith(".css")) return src.replace(/\/\*[\s\S]*?\*\//gu, "");
  return src;
}

interface Hit {
  file: string;
  line: number | null;
  word: string;
}

/** 見つかった語ごとに、元の行を示す（注釈でない行だけ）。分からなければ line:null */
function hitsIn(file: string): Hit[] {
  const words = findWordingViolations(strippedText(file));
  if (words.length === 0) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const code = (l: string) => !/^\s*(\/\/|\/\*|\*)/u.test(l);
  return words.map((word) => {
    const key = normalizeForMatch(word.split(" ")[0] ?? word);
    const idx = lines.findIndex((l) => code(l) && normalizeForMatch(l).includes(key));
    return { file: rel(file), line: idx >= 0 ? idx + 1 : null, word };
  });
}

const show = (hits: Hit[]) => hits.map((h) => `${h.file}${h.line ? `:${h.line}` : ""}「${h.word}」`);

const groups: ReadonlyArray<{ name: string; files: string[] }> = [
  { name: "web/src", files: sourceFiles("web/src", [".ts", ".tsx", ".css"]) },
  { name: "shared/src（wording.ts を除く）", files: sourceFiles("shared/src", [".ts"]).filter((f) => rel(f) !== "shared/src/wording.ts") },
  ...["notify", "api", "mcp", "drafts"].map((d) => ({ name: `functions/src/${d}`, files: sourceFiles(`functions/src/${d}`, [".ts"]) })),
];

describe("ソースに禁句と過去の発生の NG の語がない", () => {
  it("対象のファイルを集められている（空の走査で通らない）", () => {
    for (const g of groups) expect(g.files.length, g.name).toBeGreaterThan(0);
    expect(groups.find((g) => g.name === "web/src")!.files.length).toBeGreaterThan(50);
  });

  it.each(groups.map((g) => [g.name, g.files] as const))("%s", (_name, files) => {
    const hits = files.flatMap(hitsIn);
    expect(show(hits)).toEqual([]);
  });
});

describe("同梱データと README に禁句と過去の発生の NG の語がない", () => {
  const replayJson = walk(path.join(ROOT, "data", "replay")).filter((f) => f.endsWith(".json"));
  const trendsJson = walk(path.join(ROOT, "data", "trends")).filter((f) => f.endsWith(".json"));
  const readme = path.join(ROOT, "README.md");

  it("data/replay/*.json（空の走査で通らない）", () => {
    expect(replayJson.length).toBeGreaterThan(0);
    expect(show(replayJson.flatMap(hitsIn))).toEqual([]);
  });
  // data/trends は X-27（落とす単位）の成果物。作られていなければ試験は飛ばす（作られたら自動で効く）
  it.skipIf(trendsJson.length === 0)("data/trends/*.json（無ければ飛ばす。X-27 の後に効く）", () => {
    expect(show(trendsJson.flatMap(hitsIn))).toEqual([]);
  });
  // README は X-26 で作る。無ければ飛ばす（作られたら自動で効く）
  it.skipIf(!fs.existsSync(readme))("README.md（無ければ飛ばす。X-26 の後に効く）", () => {
    expect(show(hitsIn(readme))).toEqual([]);
  });
});

describe("OFFICIAL_GUIDANCE の各文に出典の URL と確認日がある", () => {
  const rows = OFFICIAL_GUIDANCE.flatMap((g) => g.statements.map((s, i) => ({ topic: g.topic, i, s })));

  it("文がある（空の走査で通らない）", () => {
    expect(rows.length).toBeGreaterThan(10);
  });
  it.each(rows.map((r) => [`${r.topic}[${r.i}]`, r.s] as const))("%s", (_id, s) => {
    expect(s.text.trim()).not.toBe("");
    expect(s.sourceUrl).toMatch(/^https:\/\/\S+$/u);
    expect(s.sourceTitle.trim()).not.toBe("");
    expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
  it("文そのものに、禁句と過去の発生の NG の語がない", () => {
    const text = OFFICIAL_GUIDANCE.flatMap((g) => [g.heading, ...g.statements.map((s) => s.text)]).join("\n");
    expect(findWordingViolations(text)).toEqual([]);
  });
});

describe("確認リスト: 義務と見直しの推奨を混ぜない", () => {
  const OBLIGATION_NOT = /義務では(ない|ありません)/u;
  const levels: Level[] = [1, 2, 3, 4];
  const productions: Array<Production | null> = [null, "layer", "broiler"];
  const housings: Array<FarmHousing | null> = [null, "windowless", "open", "free_range"];
  const combos = levels.flatMap((level) => productions.flatMap((production) => housings.map((housing) => ({ level, production, housing }))));

  it("組み合わせを網羅している", () => {
    expect(combos).toHaveLength(4 * 3 * 4);
  });

  it.each(combos.map((c) => [`level ${c.level} / ${c.production ?? "未設定"} / ${c.housing ?? "未設定"}`, c] as const))("%s", (_id, c) => {
    const sections = buildChecklist(c);
    const by = (cls: ChecklistClass) => sections.find((s) => s.class === cls);

    // always: 見出しにも項目にも「義務ではない」がない（いつも求められていることは義務）
    const always = by("always");
    expect(always, "always の節").toBeDefined();
    expect(OBLIGATION_NOT.test(always!.heading)).toBe(false);
    for (const item of always!.items) expect(OBLIGATION_NOT.test(item.text), item.id).toBe(false);

    // good_to_check: level 1〜3 に出る。見出しに「義務ではない」を書く
    const good = by("good_to_check");
    if (c.level <= 3) {
      expect(good, "good_to_check の節").toBeDefined();
      expect(OBLIGATION_NOT.test(good!.heading)).toBe(true);
    } else {
      expect(good).toBeUndefined();
    }

    // if_in_zone: level 1 だけ。2、3、4 に節がない
    if (c.level === 1) expect(by("if_in_zone")).toBeDefined();
    else expect(by("if_in_zone")).toBeUndefined();

    // 禁句と過去の発生の NG の語がない（見出しと項目）
    const text = sections.flatMap((s) => [s.heading, ...s.items.flatMap((it) => [it.text, it.source.title, it.source.note ?? ""])]).join("\n");
    expect(findWordingViolations(text)).toEqual([]);
  });
});
