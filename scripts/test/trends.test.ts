// X-27 全国の傾向。現地調査の概要の集め方、抽出のスキーマ、Batch の依頼、集計、口（--dry-run / --yes / --resume / --aggregate）。
// data/private/ は .gitignore 済みなので読まない。原本の形は作った HTML と作った応答で調べる（実在の発表の文ではない）。
// Claude の API は呼ばない。--yes と --resume は作った client で調べる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWordingViolations } from "@hpai/shared/wording";
import {
  SEASON_CASE_COUNTS,
  SEASON_PAGES,
  SURVEY_EXTRACT_JSON_SCHEMA,
  SurveyExtractSchema,
  TREND_MAX_TOKENS,
  TREND_MODEL,
  aggregateTrends,
  buildSurveyParams,
  buildSurveyRequests,
  checkTrendSummary,
  parseSurveyLinks,
  runTrends,
  surveyCustomId,
  type SurveyDoc,
  type SurveyExtract,
  type SurveyExtractRow,
  type TrendsDeps,
} from "../lib/trends";
import { TREND_KEYS, TREND_LABELS, type TrendSummary } from "../../web/src/pages/trends/types";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// ── 見本 ──

const item = (status: "issue" | "no_issue" | "not_mentioned", quote: string | null = null) => ({ status, quote });
const EXTRACT: SurveyExtract = {
  external_clothing: item("issue", "外部事業者用の専用の衣服及び靴が用意されていなかった。"),
  rodent_signs: item("not_mentioned"),
  wall_net_damage: item("no_issue", "鶏舎の壁及び防鳥ネットに破損は認められなかった。"),
};
const row = (season: number, no: number, extract: SurveyExtract | null = EXTRACT): SurveyExtractRow => ({ season, no, extract });

// ── 集め方 ──

describe("現地調査の概要の集め方（parseSurveyLinks）", () => {
  const PAGE = "https://www.maff.go.jp/j/syouan/douei/tori/r9_hpai_kokunai.html";

  it("題が <a> の中にある形（2025 の形）と、<a> の直前にある形（2020 の形）の両方を拾う", () => {
    const html = `<div>
      <p><a href="./attach/pdf/a-1.pdf">試験県試験町（国内2例目）の発生農場に係る疫学調査チームの現地調査概要（令和9年1月2日実施）(PDF : 100KB)</a></p>
      <p>試験県試験市の発生農場（国内1例目）に係る疫学調査チームの現地調査報告概要（令和9年1月1日）<a href="./attach/pdf/a-2.pdf">(PDF : 90KB)</a></p>
      <p>2025年～2026年シーズンの疫学調査報告書<a href="./attach/pdf/a-3.pdf">(PDF : 2,000KB)</a></p>
      <p><a href="./attach/pdf/a-4.pdf">対策のポイント(PDF : 300KB)</a></p>
    </div>`;
    const got = parseSurveyLinks(html, PAGE);
    expect(got.map((g) => [g.no, g.url, g.form])).toEqual([
      [2, "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/a-1.pdf", "概要"],
      [1, "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/a-2.pdf", "報告概要"],
    ]);
  });

  it("国の外の PDF、例目の番号がない題、同じ番号の重なりは拾わない", () => {
    const html = `
      <a href="https://example.com/x.pdf">試験町（国内3例目）の現地調査概要</a>
      <a href="./b.pdf">現地調査概要（番号なし）</a>
      <a href="./c.pdf">試験町（国内4例目）の現地調査概要</a>
      <a href="./d.pdf">試験町（国内4例目）の現地調査概要（再掲）</a>`;
    const got = parseSurveyLinks(html, PAGE);
    expect(got.map((g) => g.no)).toEqual([4]);
  });

  it("6 シーズンの入口は国のサイトだけで、2022 は 220929.html（r4_hpai_kokunai.html は 403 だった）", () => {
    expect(Object.keys(SEASON_PAGES).map(Number)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    for (const u of Object.values(SEASON_PAGES)) expect(new URL(u).hostname).toBe("www.maff.go.jp");
    expect(SEASON_PAGES[2022]).toBe("https://www.maff.go.jp/j/syouan/douei/tori/220929.html");
    expect(SEASON_CASE_COUNTS).toEqual({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51, 2025: 24 });
  });
});

// ── 抽出のスキーマ ──

type Json = { [key: string]: any };
function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((x) => walk(x, visit));
  if (typeof node !== "object" || node === null) return;
  visit(node as Json);
  for (const v of Object.values(node)) walk(v, visit);
}

/** 構造化出力の型と enum と anyOf だけを見る小さな検査器 */
function valid(schema: Json, v: unknown): boolean {
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((s: Json) => valid(s, v));
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeOk = types.some((t) => (t === "null" ? v === null : t === "string" ? typeof v === "string" : t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v) : false));
  if (!typeOk) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) return false;
  if (schema.type === "object") {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).some((k) => !(k in schema.properties))) return false;
    return (schema.required as string[]).every((k) => k in o && valid(schema.properties[k], o[k]));
  }
  return true;
}

describe("抽出のスキーマ（SurveyExtractSchema と JSON Schema）", () => {
  const schema = SURVEY_EXTRACT_JSON_SCHEMA as Json;

  it("3 つの項目だけを持つ", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...TREND_KEYS].sort());
  });

  it("enum を持つ項目は type が文字列 1 つだけ（type 配列と enum を並べると API が 400 を返す。e25e461）", () => {
    let enums = 0;
    walk(schema, (o) => {
      if (Array.isArray(o.enum)) {
        enums += 1;
        expect(o.type).toBe("string");
        expect(o.enum).not.toContain(null);
      }
    });
    expect(enums).toBe(3);
  });

  it("全 object が additionalProperties:false で、全項目が required", () => {
    let objects = 0;
    walk(schema, (o) => {
      if (o.type === "object" || o.properties) {
        objects += 1;
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties).sort());
      }
    });
    expect(objects).toBe(4);
  });

  it("数値と長さの制約、$ref を持たず、anyOf と type 配列の合計が 16 以下", () => {
    const banned = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];
    let unions = 0;
    walk(schema, (o) => {
      for (const k of banned) expect(Object.keys(o)).not.toContain(k);
      if (Array.isArray(o.anyOf)) unions += 1;
      if (Array.isArray(o.type)) unions += 1;
    });
    expect(unions).toBeLessThanOrEqual(16);
    expect(JSON.stringify(schema)).not.toMatch(/\$ref|\$defs|definitions/);
  });

  it("同じ見本を JSON Schema と zod が通し、同じく拒む", () => {
    expect(valid(schema, EXTRACT)).toBe(true);
    expect(SurveyExtractSchema.safeParse(EXTRACT).success).toBe(true);
    const bads: unknown[] = [
      { ...EXTRACT, rodent_signs: { status: "unknown", quote: null } },
      { ...EXTRACT, extra: 1 },
      { external_clothing: EXTRACT.external_clothing, rodent_signs: EXTRACT.rodent_signs },
      { ...EXTRACT, wall_net_damage: { status: null, quote: null } },
    ];
    for (const b of bads) {
      expect(valid(schema, b)).toBe(false);
      expect(SurveyExtractSchema.safeParse(b).success).toBe(false);
    }
  });
});

// ── Batch の依頼 ──

const DOC: SurveyDoc = { season: 2025, no: 7, pdfBase64: Buffer.from("%PDF-1.4 作った中身").toString("base64"), pages: 2 };

describe("Batch の依頼（buildSurveyParams、buildSurveyRequests）", () => {
  it("モデルは claude-sonnet-5-5、output_config.format は json_schema、custom_id は ${season}-${no}", () => {
    const p = buildSurveyParams(DOC);
    expect(TREND_MODEL).toBe("claude-sonnet-5-5");
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.max_tokens).toBe(TREND_MAX_TOKENS);
    expect(p.output_config?.format).toEqual({ type: "json_schema", schema: SURVEY_EXTRACT_JSON_SCHEMA });
    expect(surveyCustomId(2025, 7)).toBe("2025-7");
    const [r] = buildSurveyRequests([DOC]);
    expect(r!.custom_id).toBe("2025-7");
    expect(r!.custom_id).toMatch(/^\d{4}-\d+$/);
  });

  it("citations、tool_choice、temperature、effort、道具を入れない", () => {
    const s = JSON.stringify(buildSurveyParams(DOC));
    for (const k of ["citations", "tool_choice", "temperature", "top_p", "top_k", "effort", "tools", "thinking"]) expect(s).not.toContain(`"${k}"`);
  });

  it("PDF を document として送り、題や URL（市町村名を含む）を送らない", () => {
    const p = buildSurveyParams(DOC);
    const content = p.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: DOC.pdfBase64 } });
    expect(JSON.stringify(p.messages)).not.toMatch(/https?:|例目/);
  });
});

// ── 集計 ──

/** 値の中の全キー（入れ子も） */
function* keys(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keys(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keys(x);
    }
}
const FORBIDDEN_KEYS = ["muniCode", "muniName", "prefCode", "caseId", "no", "sourceUrl", "quote"];
const muniNames = (): string[] => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "geo", "muni-index.json"), "utf8")) as Record<string, { name: string }>;
  return [...new Set(Object.values(idx).map((m) => m.name))];
};

function expectNoLeak(summary: TrendSummary): void {
  const ks = [...keys(summary)];
  for (const k of FORBIDDEN_KEYS) expect(ks, k).not.toContain(k);
  const text = JSON.stringify(summary);
  const hit = muniNames().filter((n) => text.includes(n));
  expect(hit).toEqual([]);
  expect(text).not.toContain("外部事業者用の専用の衣服及び靴が用意されていなかった"); // quote を出さない
  expect(checkTrendSummary(summary)).toEqual([]);
}

function expectBounds(summary: TrendSummary): void {
  for (const s of summary.seasons) {
    expect(s.surveyed).toBeLessThanOrEqual(SEASON_CASE_COUNTS[s.season]!);
    expect(s.items.map((i) => i.key)).toEqual([...TREND_KEYS]);
    for (const i of s.items) {
      expect(i.issueCount).toBeGreaterThanOrEqual(0);
      expect(i.notMentionedCount).toBeGreaterThanOrEqual(0);
      expect(i.issueCount + i.notMentionedCount).toBeLessThanOrEqual(s.surveyed);
      expect(i.label).toBe(TREND_LABELS[i.key]);
    }
  }
}

describe("集計（aggregateTrends）", () => {
  const AT = "2026-11-08T10:00:00+09:00";

  it("シーズンごとに、読めた件数と、項目ごとの「書かれていた」「触れていない」を数える。読めなかった行は数えない", () => {
    const rows = [
      row(2025, 1),
      row(2025, 2, { ...EXTRACT, rodent_signs: item("issue", "ねずみのふんが見られた。") }),
      row(2025, 3, null),
      row(2024, 1, { external_clothing: item("not_mentioned"), rodent_signs: item("not_mentioned"), wall_net_damage: item("issue", "ネットに穴があった。") }),
    ];
    const s = aggregateTrends(rows, AT);
    expect(s.generatedAt).toBe(AT);
    expect(s.seasons.map((x) => [x.season, x.surveyed])).toEqual([
      [2025, 2],
      [2024, 1],
    ]);
    const s25 = s.seasons[0]!;
    expect(s25.items).toEqual([
      { key: "external_clothing", label: "外部事業者の専用の衣服や靴", issueCount: 2, notMentionedCount: 0 },
      { key: "rodent_signs", label: "ねずみの痕跡", issueCount: 1, notMentionedCount: 1 },
      { key: "wall_net_damage", label: "壁やネットの破損", issueCount: 0, notMentionedCount: 0 },
    ]);
    expect(s.sourceUrls).toEqual([SEASON_PAGES[2025], SEASON_PAGES[2024]]);
    expectBounds(s);
    expectNoLeak(s);
  });

  it("出典はシーズンの入口だけで、事例ごとの PDF を出さない", () => {
    const s = aggregateTrends([row(2020, 1), row(2023, 2)], AT);
    for (const u of s.sourceUrls) expect(Object.values(SEASON_PAGES)).toContain(u);
  });

  it("同じ事例が 2 度ある、シーズンの件数を超える、知らないシーズンは throw", () => {
    expect(() => aggregateTrends([row(2025, 1), row(2025, 1)], AT)).toThrow();
    expect(() => aggregateTrends(Array.from({ length: 12 }, (_, i) => row(2023, i + 1)), AT)).toThrow();
    expect(() => aggregateTrends([row(2019, 1)], AT)).toThrow();
  });

  it("checkTrendSummary は、市町村や事例の手がかりと、上限を超える数を拾う", () => {
    const s = aggregateTrends([row(2025, 1)], AT);
    const leaked = { ...s, seasons: [{ ...s.seasons[0]!, sourceUrl: "x", muniName: "試験町" }] } as unknown as TrendSummary;
    expect(checkTrendSummary(leaked).length).toBeGreaterThan(0);
    const over = { ...s, seasons: [{ ...s.seasons[0]!, items: s.seasons[0]!.items.map((i) => ({ ...i, issueCount: 5 })) }] };
    expect(checkTrendSummary(over).length).toBeGreaterThan(0);
  });

  it("ラベルは報告書の言い方のままで、禁句がない", () => {
    expect(TREND_LABELS).toEqual({ external_clothing: "外部事業者の専用の衣服や靴", rodent_signs: "ねずみの痕跡", wall_net_damage: "壁やネットの破損" });
    expect(findWordingViolations(Object.values(TREND_LABELS).join("\n"))).toEqual([]);
  });
});

describe("公開する集計（data/trends/summary.json）", () => {
  const file = path.join(ROOT, "data", "trends", "summary.json");
  it.runIf(fs.existsSync(file))("置いてあれば、市町村や事例の手がかりがなく、数が上限の内にあり、禁句がない", () => {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as TrendSummary;
    expectBounds(s);
    expectNoLeak(s);
    expect(findWordingViolations(JSON.stringify(s))).toEqual([]);
  });
  it("1 事例ごとの結果は data/private/ にだけ置く（.gitignore 済み）", () => {
    const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignore).toContain("data/private/");
    expect(fs.existsSync(path.join(ROOT, "data", "trends", "survey-extract.json"))).toBe(false);
  });
});

// ── 口 ──

const SEASON_HTML = (season: number, n: number) =>
  Array.from({ length: n }, (_, i) => `<p><a href="./attach/pdf/s${season}-${i + 1}.pdf">試験町（国内${i + 1}例目）の発生農場に係る疫学調査チームの現地調査概要(PDF : 10KB)</a></p>`).join("\n");

/** 作った client。messages.batches の create、retrieve、results だけ */
function fakeClient(reply: (customId: string) => Anthropic.Messages.MessageBatchResult) {
  const created: Array<{ custom_id: string; params: unknown }[]> = [];
  const client = {
    messages: {
      batches: {
        create: async (body: { requests: Array<{ custom_id: string; params: unknown }> }) => {
          created.push(body.requests);
          return { id: `msgbatch_test${created.length}` };
        },
        retrieve: async (id: string) => ({ id, processing_status: "ended", request_counts: { processing: 0, succeeded: 1, errored: 0, expired: 0, canceled: 0 } }),
        results: async (id: string) => {
          const reqs = created[Number(id.replace("msgbatch_test", "")) - 1] ?? [];
          return (async function* () {
            for (const r of reqs) yield { custom_id: r.custom_id, result: reply(r.custom_id) };
          })();
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, created };
}

const okMessage = (value: unknown): Anthropic.Messages.MessageBatchResult =>
  ({
    type: "succeeded",
    message: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 3000, output_tokens: 200 } },
  }) as unknown as Anthropic.Messages.MessageBatchResult;

describe("口（runTrends）", () => {
  let dir: string;
  let out: string[];
  let fetched: string[];
  let clients: number;

  const deps = (over: Partial<TrendsDeps> = {}): TrendsDeps => ({
    surveyDir: path.join(dir, "survey"),
    extractFile: path.join(dir, "survey-extract.json"),
    summaryFile: path.join(dir, "trends", "summary.json"),
    log: (l) => out.push(l),
    now: () => new Date("2026-11-08T01:00:00Z"),
    fetchOne: async (url) => {
      fetched.push(url);
      return Buffer.from(`%PDF ${url}`);
    },
    pageCount: async () => 2,
    makeClient: () => {
      clients += 1;
      throw new Error("この試験では client を作らない");
    },
    sleep: async () => undefined,
    ...over,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "trends-"));
    out = [];
    fetched = [];
    clients = 0;
    // 入口の控え: 2025 に 2 件、2023 に 1 件だけ（他のシーズンは控えがない）
    fs.mkdirSync(path.join(dir, "survey", "index"), { recursive: true });
    fs.writeFileSync(path.join(dir, "survey", "index", "2025.html"), SEASON_HTML(2025, 2));
    fs.writeFileSync(path.join(dir, "survey", "index", "2023.html"), SEASON_HTML(2023, 1));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** 入口の控えがない 4 シーズンのページは取れない（null）。PDF は取れる */
  const pdfOnly = (failing: ReadonlySet<string> = new Set()) => async (url: string) => {
    fetched.push(url);
    if (url.endsWith(".html") || failing.has(url)) return null;
    return Buffer.from("%PDF-1.4");
  };

  it("--fetch は入口の控えから PDF を 1 本ずつ取り、置いてあるもの、前に取れなかったものは取り直さない", async () => {
    const d = deps({ fetchOne: pdfOnly(new Set(["https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/s2025-2.pdf"])) });
    expect(await runTrends(["--fetch"], d)).toBe(1); // 取れないものがある
    // 控えのない 4 シーズンの入口（各 1 回）と、PDF 3 本（各 1 回）
    expect(fetched.filter((u) => u.endsWith(".html")).sort()).toEqual([SEASON_PAGES[2020], SEASON_PAGES[2021], SEASON_PAGES[2022], SEASON_PAGES[2024]].sort());
    expect(fetched.filter((u) => u.endsWith(".pdf"))).toHaveLength(3);
    expect(fs.existsSync(path.join(dir, "survey", "2025-1.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "survey", "2025-2.pdf"))).toBe(false);
    expect(out.join("\n")).toMatch(/取れませんでした/u);

    fetched = [];
    await runTrends(["--fetch"], d);
    expect(fetched).toEqual([]); // 2 度目は何も取らない（再試行しない）
    expect(clients).toBe(0);
  });

  it("--fetch は PDF でない応答を置かない", async () => {
    const d = deps({
      fetchOne: async (url) => {
        fetched.push(url);
        return url.endsWith(".html") ? null : Buffer.from("<!doctype html>");
      },
    });
    expect(await runTrends(["--fetch"], d)).toBe(1);
    expect(fs.existsSync(path.join(dir, "survey", "2025-1.pdf"))).toBe(false);
  });

  async function fetchAll(): Promise<void> {
    await runTrends(["--fetch"], deps({ fetchOne: pdfOnly() }));
    out = [];
  }

  it("引数なしと --dry-run は件数と見積もりだけを出し、client を作らない", async () => {
    await fetchAll();
    for (const argv of [[], ["--dry-run"]]) {
      out = [];
      expect(await runTrends(argv, deps())).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("3 件");
      expect(text).toMatch(/見積もり/u);
      expect(text).toMatch(/ドル/u);
    }
    expect(clients).toBe(0);
  });

  it("--yes はバッチ ID を待つ前に保存し、結果を data/private の抽出の結果にだけ書く。--aggregate は集計だけを書く", async () => {
    await fetchAll();
    const { client, created } = fakeClient((id) => (id === "2025-2" ? ({ type: "errored", error: {} } as unknown as Anthropic.Messages.MessageBatchResult) : okMessage(EXTRACT)));
    let savedBeforeWait = false;
    const d = deps({
      makeClient: () => {
        clients += 1;
        const orig = client.messages.batches.retrieve;
        client.messages.batches.retrieve = (async (id: string) => {
          savedBeforeWait = fs.existsSync(path.join(dir, "survey", "batches.json"));
          return orig(id);
        }) as typeof orig;
        return client;
      },
    });
    expect(await runTrends(["--yes"], d)).toBe(0);
    expect(clients).toBe(1);
    expect(savedBeforeWait).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]!.map((r) => r.custom_id).sort()).toEqual(["2023-1", "2025-1", "2025-2"]);
    for (const r of created[0]!) expect(JSON.stringify(r.params)).not.toMatch(/"citations"|"tool_choice"|"temperature"/);

    const ex = JSON.parse(fs.readFileSync(path.join(dir, "survey-extract.json"), "utf8")) as { rows: SurveyExtractRow[] };
    expect(ex.rows.map((r) => [r.season, r.no, r.extract === null])).toEqual([
      [2023, 1, false],
      [2025, 1, false],
      [2025, 2, true],
    ]);
    expect(fs.existsSync(path.join(dir, "trends", "summary.json"))).toBe(false);

    out = [];
    expect(await runTrends(["--aggregate"], d)).toBe(0);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "trends", "summary.json"), "utf8")) as TrendSummary;
    expect(summary.seasons.map((s) => [s.season, s.surveyed])).toEqual([
      [2025, 1],
      [2023, 1],
    ]);
    expectNoLeak(summary);
    expect(out.join("\n")).toMatch(/2025.*外部事業者の専用の衣服や靴.*1 \/ 1/u); // 前季の 2 項目を報告書の「半数以上」と比べるための行
  });

  it("--resume <batchId> は新しい依頼を作らず、結果を取り直す", async () => {
    await fetchAll();
    const { client, created } = fakeClient(() => okMessage(EXTRACT));
    // 前の実行で作ったバッチ（ここでは作った client に直接作らせる）
    await client.messages.batches.create({ requests: [{ custom_id: "2025-1", params: {} } as never] });
    const d = deps({
      makeClient: () => {
        clients += 1;
        return client;
      },
    });
    expect(await runTrends(["--resume", "msgbatch_test1"], d)).toBe(0);
    expect(created).toHaveLength(1);
    const ex = JSON.parse(fs.readFileSync(path.join(dir, "survey-extract.json"), "utf8")) as { rows: SurveyExtractRow[] };
    expect(ex.rows.map((r) => `${r.season}-${r.no}`)).toEqual(["2025-1"]);
  });

  it("--aggregate は抽出の結果がなければ書かずに止まる", async () => {
    expect(await runTrends(["--aggregate"], deps())).toBe(1);
    expect(fs.existsSync(path.join(dir, "trends", "summary.json"))).toBe(false);
  });
});
