// 全国の傾向の段階 2（計画 T5）。4 項目の抽出のスキーマ、Batch の依頼、見積もり、照合、集計、口（--dry-run / --yes / --resume / --aggregate）。
// data/private/ は .gitignore 済みなので読まない。原本の形は作った文と作った応答で調べる（実在の発表の文ではない）。
// Claude の API は呼ばない。--yes と --resume は作った client で調べる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import { findWordingViolations } from "@hpai/shared/wording";
import { SEASON_CASE_COUNTS, SEASON_PAGES, TREND_MODEL } from "../lib/trends";
import {
  NOTICING_EXPECTED_OUTPUT_TOKENS,
  NOTICING_EXTRACT_JSON_SCHEMA,
  NOTICING_FIELDS,
  NOTICING_KEYS,
  NOTICING_LABELS,
  NOTICING_MAX_TOKENS,
  NOTICING_MODEL,
  NOTICING_SYSTEM,
  NOTICING_VALUE_LABELS,
  NoticingExtractSchema,
  aggregateNoticing,
  buildNoticingParams,
  buildNoticingRequests,
  checkExtract,
  checkField,
  checkNoticingSummary,
  estimateNoticing,
  previousActual,
  runNoticing,
  type CheckedRow,
  type NoticingDeps,
  type NoticingDoc,
  type NoticingExtract,
  type NoticingField,
  type NoticingRow,
  type NoticingSummary,
  type QuoteCheck,
} from "../lib/trends-noticing";

// ── 見本（作った文。実在の概要の文ではない） ──

const Q_SIGN = "通報前日の朝、１鶏舎で死亡鶏がまとまって確認された。";
const Q_DISEASE = "当初は別の疾病を疑い、経過を観察していた。";
const Q_WATER = "農場の約３００ｍ先にため池がある。";
const Q_FOWL = "ため池ではカモ類の飛来が確認されている。";
const Q_STAFF = "鶏舎ごとの長靴の履き替えが徹底されていなかった。";
/** PDF の本文の写し（改行や半角の空白が入るのを、照合で吸収できることも見る） */
const DOC_TEXT = [
  "３ 通報の経緯・発生時の状況",
  "① 通報前日の朝、１鶏舎で死亡鶏がまとまって",
  "確認された。 当初は別の疾病を疑い、経過を観察していた。",
  "２ 農場の周辺環境 農場の約３００ｍ先にため池がある。ため池ではカモ類の飛来が確認されている。",
  "５ 農場の飼養衛生管理 鶏舎ごとの長靴の履き替えが徹底されていなかった。",
].join("\n");

const f = (value: string, quote: string | null = null) => ({ value, quote });
const EXTRACT: NoticingExtract = {
  first_sign: f("mass_death", Q_SIGN),
  other_disease_suspected: f("yes", Q_DISEASE),
  waterside_1km: f("yes", Q_WATER),
  waterfowl_seen: f("yes", Q_FOWL),
  staff_hygiene: f("issue", Q_STAFF),
};
const NONE: NoticingExtract = {
  first_sign: f("not_mentioned"),
  other_disease_suspected: f("not_mentioned"),
  waterside_1km: f("not_mentioned"),
  waterfowl_seen: f("not_mentioned"),
  staff_hygiene: f("not_mentioned"),
};

// ── 抽出のスキーマ ──

type Json = { [key: string]: any };
function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((x) => walk(x, visit));
  if (typeof node !== "object" || node === null) return;
  visit(node as Json);
  for (const v of Object.values(node)) walk(v, visit);
}

/** 構造化出力の型と enum と anyOf だけを見る小さな検査器（trends.test.ts と同じ） */
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

describe("抽出のスキーマ（NoticingExtractSchema と JSON Schema）", () => {
  const schema = NOTICING_EXTRACT_JSON_SCHEMA as Json;

  it("5 つの欄だけを持ち、値は依頼の通り。平常の死亡羽数や倍数の欄はない", () => {
    expect(Object.keys(schema.properties)).toEqual(["first_sign", "other_disease_suspected", "waterside_1km", "waterfowl_seen", "staff_hygiene"]);
    expect(NOTICING_KEYS).toEqual(Object.keys(schema.properties));
    expect(NOTICING_FIELDS).toEqual({
      first_sign: ["mass_death", "death_increase", "lethargy", "egg_drop", "feed_water_drop", "other", "not_mentioned"],
      other_disease_suspected: ["yes", "no", "not_mentioned"],
      waterside_1km: ["yes", "no", "not_mentioned"],
      waterfowl_seen: ["yes", "no", "not_mentioned"],
      staff_hygiene: ["issue", "no_issue", "not_mentioned"],
    });
    expect(JSON.stringify(schema)).not.toMatch(/count|ratio|times|baseline|羽/iu);
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
    expect(enums).toBe(5);
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
    expect(objects).toBe(6);
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
    for (const good of [EXTRACT, NONE]) {
      expect(valid(schema, good)).toBe(true);
      expect(NoticingExtractSchema.safeParse(good).success).toBe(true);
    }
    const bads: unknown[] = [
      { ...EXTRACT, first_sign: f("fever", null) },
      { ...EXTRACT, staff_hygiene: f("yes", Q_STAFF) }, // staff_hygiene は issue / no_issue
      { ...EXTRACT, waterside_1km: f("issue", Q_WATER) },
      { ...EXTRACT, extra: 1 },
      { ...EXTRACT, waterfowl_seen: { value: "yes", quote: Q_FOWL, note: "x" } },
      { first_sign: EXTRACT.first_sign },
      { ...EXTRACT, other_disease_suspected: { value: null, quote: null } },
    ];
    for (const b of bads) {
      expect(valid(schema, b)).toBe(false);
      expect(NoticingExtractSchema.safeParse(b).success).toBe(false);
    }
  });
});

// ── Batch の依頼と見積もり ──

const DOC: NoticingDoc = { season: 2025, no: 7, pdfBase64: Buffer.from("%PDF-1.4 作った中身").toString("base64"), pages: 2 };

describe("Batch の依頼（buildNoticingParams、buildNoticingRequests）", () => {
  it("モデルは 3 項目と同じ claude-sonnet-5-5、max_tokens は 3,000、output_config.format は json_schema、custom_id は ${season}-${no}", () => {
    const p = buildNoticingParams(DOC);
    expect(NOTICING_MODEL).toBe(TREND_MODEL);
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.max_tokens).toBe(NOTICING_MAX_TOKENS);
    expect(NOTICING_MAX_TOKENS).toBe(3000);
    expect(p.output_config?.format).toEqual({ type: "json_schema", schema: NOTICING_EXTRACT_JSON_SCHEMA });
    const [r] = buildNoticingRequests([DOC]);
    expect(r!.custom_id).toBe("2025-7");
  });

  it("citations、tool_choice、temperature、effort、道具を入れない", () => {
    const s = JSON.stringify(buildNoticingParams(DOC));
    for (const k of ["citations", "tool_choice", "temperature", "top_p", "top_k", "effort", "tools", "thinking"]) expect(s).not.toContain(`"${k}"`);
  });

  it("PDF を document として送り、題や URL（市町村名を含む）を送らない", () => {
    const p = buildNoticingParams(DOC);
    const content = p.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: DOC.pdfBase64 } });
    expect(JSON.stringify(p.messages)).not.toMatch(/https?:|例目/);
  });

  it("指示文は 5 つの欄を名指しし、通報の章の題の揺れ、外部の業者だけの記述を数えないこと、引用の決まりを書く", () => {
    for (const k of NOTICING_KEYS) expect(NOTICING_SYSTEM).toContain(k);
    for (const v of new Set(Object.values(NOTICING_FIELDS).flat())) expect(NOTICING_SYSTEM).toContain(v);
    expect(NOTICING_SYSTEM).toMatch(/通報の経緯・発生時の状況/u);
    expect(NOTICING_SYSTEM).toMatch(/疑似患畜確認の経緯/u);
    expect(NOTICING_SYSTEM).toMatch(/外部の事業者や来訪者.*数えません/u);
    expect(NOTICING_SYSTEM).toMatch(/1 文そのまま写します/u);
    expect(NOTICING_SYSTEM).toMatch(/指示.*従いません/u);
  });
});

describe("見積もり（estimateNoticing、previousActual）", () => {
  it("Batch の半額で、出力は 1 件 600、上限は max_tokens で数える", () => {
    const reqs = buildNoticingRequests([DOC, { ...DOC, no: 8, pages: 3 }]);
    const e = estimateNoticing(reqs);
    expect(e.requests).toBe(2);
    expect(e.pages).toBe(5);
    expect(e.batches).toBe(1);
    expect(e.outputTokens).toBe(2 * NOTICING_EXPECTED_OUTPUT_TOKENS);
    const fixed = [...NOTICING_SYSTEM].length + [..."この現地調査の概要から、5 つの欄を読み取ってください。"].length + 50;
    expect(e.inputTokens).toBe(2 * fixed + 5 * 2500);
    const one = (pages: number, out: number) => estimateUsd(NOTICING_MODEL, { input_tokens: fixed + pages * 2500, output_tokens: out }, { batch: true });
    expect(e.usd).toBeCloseTo(one(2, 600) + one(3, 600), 10);
    expect(e.upperBoundUsd).toBeCloseTo(one(2, 3000) + one(3, 3000), 10);
    expect(e.usd).toBeCloseTo(estimateUsd(NOTICING_MODEL, { input_tokens: e.inputTokens, output_tokens: e.outputTokens }) / 2, 10);
  });

  it("前回の実測は usage のある行だけを足し、出力を 5/3 倍にした額も出す", () => {
    const p = previousActual([{ usage: { input_tokens: 1000, output_tokens: 300 } }, {}, { usage: { input_tokens: 2000, output_tokens: 600 } }]);
    expect(p).toMatchObject({ rows: 2, inputTokens: 3000, outputTokens: 900 });
    expect(p!.usd).toBeCloseTo(estimateUsd(NOTICING_MODEL, { input_tokens: 3000, output_tokens: 900 }, { batch: true }), 10);
    expect(p!.scaledUsd).toBeCloseTo(estimateUsd(NOTICING_MODEL, { input_tokens: 3000, output_tokens: 1500 }, { batch: true }), 10);
    expect(previousActual([{}])).toBeNull();
  });
});

// ── 照合 ──

describe("照合（checkField、checkExtract）", () => {
  const doc = DOC_TEXT;
  const norm = (s: string) => s.normalize("NFKC").replace(/\s+/gu, "");

  it("値があり、引用が本文にあれば ok。改行、全角、空白の違いは吸収する", () => {
    expect(checkField(EXTRACT.first_sign, norm(doc))).toBe("ok");
    expect(checkField(f("death_increase", "通報前日の朝、1鶏舎で死亡鶏が まとまって確認された。"), norm(doc))).toBe("ok");
  });

  it("引用がない・空・本文にない、記載なしなのに引用がある、は数えない形にする", () => {
    expect(checkField(f("yes", null), norm(doc))).toBe("no_quote");
    expect(checkField(f("yes", "  "), norm(doc))).toBe("no_quote");
    expect(checkField(f("yes", "近くに大きな湖がある。"), norm(doc))).toBe("not_found");
    expect(checkField(f("not_mentioned", Q_WATER), norm(doc))).toBe("quote_on_not_mentioned");
    expect(checkField(f("not_mentioned", null), norm(doc))).toBe("not_mentioned");
  });

  it("1 つ目の本文で落ちた欄だけを、2 つ目の本文で照らし直す。2 つ目は落ちた欄があるときだけ作る", async () => {
    let altCalls = 0;
    const all = await checkExtract(EXTRACT, doc, async () => {
      altCalls += 1;
      return "";
    });
    expect(Object.values(all).every((c) => c === "ok")).toBe(true);
    expect(altCalls).toBe(0);

    const primary = doc.replace("鶏舎ごとの長靴の履き替えが徹底されていなかった。", "（文字化け）");
    const retried = await checkExtract(EXTRACT, primary, async () => {
      altCalls += 1;
      return doc;
    });
    expect(altCalls).toBe(1);
    expect(retried.staff_hygiene).toBe("ok");

    const stillBad = await checkExtract(EXTRACT, primary, async () => null);
    expect(stillBad.staff_hygiene).toBe("not_found");
    expect(stillBad.first_sign).toBe("ok");
  });
});

// ── 集計 ──

const checkedOf = (season: number, no: number, values: Partial<Record<NoticingField, [string, QuoteCheck]>> | null): CheckedRow & { no: number } => ({
  season,
  no,
  values:
    values === null
      ? null
      : (Object.fromEntries(NOTICING_KEYS.map((k) => [k, { value: values[k]?.[0] ?? "not_mentioned", check: values[k]?.[1] ?? "not_mentioned" }])) as CheckedRow["values"]),
});

/** 値の中の全キー（入れ子も）。counts と labels.values の中は値の名前（"no" は「いいえ」）なので、値の一覧にあることだけを見る */
const ALL_VALUES = new Set<string>(Object.values(NOTICING_FIELDS).flat());
function* keys(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keys(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      if (k === "counts" || k === "values") {
        for (const vk of Object.keys(x as object)) expect(ALL_VALUES.has(vk), vk).toBe(true);
        continue;
      }
      yield* keys(x);
    }
}
const muniNames = (): string[] => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "geo", "muni-index.json"), "utf8")) as Record<string, { name: string }>;
  return [...new Set(Object.values(idx).map((m) => m.name))];
};

function expectNoLeak(s: NoticingSummary): void {
  const ks = [...keys(s)];
  for (const k of ["muniCode", "muniName", "prefCode", "caseId", "no", "sourceUrl", "quote", "custom_id"]) expect(ks, k).not.toContain(k);
  const text = JSON.stringify(s);
  for (const q of [Q_SIGN, Q_DISEASE, Q_WATER, Q_FOWL, Q_STAFF]) expect(text).not.toContain(q);
  expect(text).not.toMatch(/例目|\d{4}-\d+"/u);
  expect(muniNames().filter((n) => text.includes(n))).toEqual([]);
  expect(checkNoticingSummary(s, muniNames())).toEqual([]);
}

describe("集計（aggregateNoticing、checkNoticingSummary）", () => {
  const AT = "2026-11-08T10:00:00+09:00";

  it("シーズンごとと合計で、照合できた値と記載なしだけを数え、確かめられなかったものは別に数える。読めなかった行は failed", () => {
    const rows = [
      checkedOf(2025, 1, { first_sign: ["mass_death", "ok"], waterside_1km: ["yes", "ok"], waterfowl_seen: ["yes", "ok"], staff_hygiene: ["issue", "ok"] }),
      checkedOf(2025, 2, { first_sign: ["death_increase", "not_found"], other_disease_suspected: ["yes", "ok"], waterside_1km: ["no", "no_quote"] }),
      checkedOf(2025, 3, null),
      checkedOf(2024, 1, { first_sign: ["egg_drop", "ok"], other_disease_suspected: ["not_mentioned", "quote_on_not_mentioned"] }),
    ];
    const s = aggregateNoticing(rows, AT);
    expect(s.generatedAt).toBe(AT);
    expect(s.seasons.map((x) => [x.season, x.read, x.failed, x.caseCount])).toEqual([
      [2025, 2, 1, SEASON_CASE_COUNTS[2025]],
      [2024, 1, 0, SEASON_CASE_COUNTS[2024]],
    ]);
    const s25 = s.seasons[0]!.fields;
    expect(s25.first_sign).toEqual({ counts: { mass_death: 1, death_increase: 0, lethargy: 0, egg_drop: 0, feed_water_drop: 0, other: 0, not_mentioned: 0 }, unverified: 1 });
    expect(s25.other_disease_suspected).toEqual({ counts: { yes: 1, no: 0, not_mentioned: 1 }, unverified: 0 });
    expect(s25.waterside_1km).toEqual({ counts: { yes: 1, no: 0, not_mentioned: 0 }, unverified: 1 });
    expect(s25.staff_hygiene.counts).toEqual({ issue: 1, no_issue: 0, not_mentioned: 1 });
    expect(s.seasons[1]!.fields.other_disease_suspected).toEqual({ counts: { yes: 0, no: 0, not_mentioned: 0 }, unverified: 1 });

    expect(s.total.read).toBe(3);
    expect(s.total.failed).toBe(1);
    expect(s.total.caseCount).toBe(SEASON_CASE_COUNTS[2025]! + SEASON_CASE_COUNTS[2024]!);
    expect(s.total.fields.first_sign.counts).toMatchObject({ mass_death: 1, egg_drop: 1 });
    expect(s.total.fields.first_sign.unverified).toBe(1);
    expect(s.sourceUrls).toEqual([SEASON_PAGES[2025], SEASON_PAGES[2024]]);
    expectNoLeak(s);
  });

  it("同じ事例が 2 度ある、シーズンの件数を超える、知らないシーズンは throw", () => {
    expect(() => aggregateNoticing([checkedOf(2025, 1, {}), checkedOf(2025, 1, {})], AT)).toThrow();
    expect(() => aggregateNoticing(Array.from({ length: 12 }, (_, i) => checkedOf(2023, i + 1, {})), AT)).toThrow();
    expect(() => aggregateNoticing([checkedOf(2019, 1, {})], AT)).toThrow();
  });

  it("checkNoticingSummary は、事例や市町村の手がかり、合わない数、知らない値を拾う", () => {
    const s = aggregateNoticing([checkedOf(2025, 1, { first_sign: ["lethargy", "ok"] })], AT);
    expect(checkNoticingSummary(s)).toEqual([]);
    const leaked = { ...s, seasons: [{ ...s.seasons[0]!, quote: "x", no: 1 }] } as unknown as NoticingSummary;
    expect(checkNoticingSummary(leaked).length).toBeGreaterThan(0);
    const muni = muniNames()[0]!;
    expect(checkNoticingSummary({ ...s, note: `${muni}の農場` }, [muni]).length).toBeGreaterThan(0);
    const off = structuredClone(s);
    off.seasons[0]!.fields.first_sign.counts.lethargy = 5;
    expect(checkNoticingSummary(off).length).toBeGreaterThan(0);
    const unknown = structuredClone(s);
    (unknown.total.fields.first_sign.counts as Record<string, number>).fever = 0;
    expect(checkNoticingSummary(unknown).length).toBeGreaterThan(0);
    const relabeled = structuredClone(s);
    relabeled.labels.values.no = "安全";
    expect(checkNoticingSummary(relabeled).length).toBeGreaterThan(0);
  });

  it("日本語の名前は全ての欄と値にあり、禁句がない", () => {
    expect(Object.keys(NOTICING_LABELS)).toEqual(NOTICING_KEYS);
    for (const v of new Set(Object.values(NOTICING_FIELDS).flat())) expect(NOTICING_VALUE_LABELS[v], v).toBeTruthy();
    expect(findWordingViolations([...Object.values(NOTICING_LABELS), ...Object.values(NOTICING_VALUE_LABELS)].join("\n"))).toEqual([]);
  });
});

// ── 口 ──

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

const okMessage = (value: unknown, stop: string = "end_turn"): Anthropic.Messages.MessageBatchResult =>
  ({
    type: "succeeded",
    message: { stop_reason: stop, content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 3000, output_tokens: 300 } },
  }) as unknown as Anthropic.Messages.MessageBatchResult;

describe("口（runNoticing）", () => {
  let dir: string;
  let out: string[];
  let clients: number;

  const deps = (over: Partial<NoticingDeps> = {}): NoticingDeps => ({
    surveyDir: path.join(dir, "survey"),
    noticingFile: path.join(dir, "survey-noticing.json"),
    summaryFile: path.join(dir, "noticing-summary.json"),
    log: (l) => out.push(l),
    now: () => new Date("2026-11-08T01:00:00Z"),
    pageCount: async () => 2,
    // 作った PDF の「本文」は DOC_TEXT（2025-2 だけ staff_hygiene の文がない）
    pdfText: async (pdf) => (pdf.toString("latin1").includes("2025-2") ? DOC_TEXT.replace(Q_STAFF, "") : DOC_TEXT),
    makeClient: () => {
      clients += 1;
      throw new Error("この試験では client を作らない");
    },
    sleep: async () => undefined,
    ...over,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "noticing-"));
    out = [];
    clients = 0;
    const survey = path.join(dir, "survey");
    fs.mkdirSync(survey, { recursive: true });
    const manifest = [
      { season: 2025, no: 1, file: "2025-1.pdf" },
      { season: 2025, no: 2, file: "2025-2.pdf" },
      { season: 2023, no: 1, file: "2023-1.pdf" },
      { season: 2023, no: 2, file: "2023-2.pdf" }, // 手元にない
    ].map((m) => ({ ...m, title: "（作った題）", url: "https://www.maff.go.jp/x.pdf", form: "概要" }));
    fs.writeFileSync(path.join(survey, "manifest.json"), JSON.stringify(manifest));
    for (const m of manifest.slice(0, 3)) fs.writeFileSync(path.join(survey, m.file), `%PDF-1.4 ${m.season}-${m.no}`);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("引数なしと --dry-run は件数と見積もりだけを出し、client を作らず、何も書かない", async () => {
    const prev = path.join(dir, "survey-extract.json");
    fs.writeFileSync(prev, JSON.stringify({ rows: [{ season: 2025, no: 1, extract: null, usage: { input_tokens: 7000, output_tokens: 330 } }] }));
    for (const argv of [[], ["--dry-run"]]) {
      out = [];
      expect(await runNoticing(argv, deps({ previousExtractFile: prev }))).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("依頼 3 件");
      expect(text).toContain("手元にない 1 件");
      expect(text).toMatch(/見積もり.*入力 約 \d+ トークン、出力 約 1800 トークン.*ドル/u);
      expect(text).toMatch(/前回の 3 項目の実測（1 件/u);
    }
    expect(clients).toBe(0);
    expect(fs.readdirSync(dir).sort()).toEqual(["survey", "survey-extract.json"]);
    expect(fs.existsSync(path.join(dir, "survey", "noticing-batches.json"))).toBe(false);
  });

  it("口を 2 つ選ぶ、知らない引数は 2 で止まり、client を作らない", async () => {
    expect(await runNoticing(["--yes", "--aggregate"], deps())).toBe(2);
    expect(await runNoticing(["--dry-run", "--yes"], deps())).toBe(2);
    expect(await runNoticing(["--force"], deps())).toBe(2);
    expect(clients).toBe(0);
  });

  it("--yes はバッチ ID を待つ前に noticing-batches.json に保存し、3 項目の batches.json には触れない。--aggregate は照合して集計だけを書く", async () => {
    const oldRecord = JSON.stringify({ createdAt: "x", model: "m", batches: [{ batchId: "msgbatch_old", customIds: ["2025-1"] }] });
    fs.writeFileSync(path.join(dir, "survey", "batches.json"), oldRecord);
    const { client, created } = fakeClient((id) =>
      id === "2023-1" ? ({ type: "errored", error: {} } as unknown as Anthropic.Messages.MessageBatchResult) : id === "2025-2" ? okMessage(EXTRACT) : okMessage(EXTRACT),
    );
    let savedBeforeWait = false;
    const d = deps({
      makeClient: () => {
        clients += 1;
        const orig = client.messages.batches.retrieve;
        client.messages.batches.retrieve = (async (id: string) => {
          savedBeforeWait = fs.existsSync(path.join(dir, "survey", "noticing-batches.json"));
          return orig(id);
        }) as typeof orig;
        return client;
      },
    });
    expect(await runNoticing(["--yes"], d)).toBe(0);
    expect(clients).toBe(1);
    expect(savedBeforeWait).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]!.map((r) => r.custom_id).sort()).toEqual(["2023-1", "2025-1", "2025-2"]);
    expect(fs.readFileSync(path.join(dir, "survey", "batches.json"), "utf8")).toBe(oldRecord);

    const ex = JSON.parse(fs.readFileSync(path.join(dir, "survey-noticing.json"), "utf8")) as { rows: NoticingRow[] };
    expect(ex.rows.map((r) => [r.season, r.no, r.extract === null])).toEqual([
      [2023, 1, true],
      [2025, 1, false],
      [2025, 2, false],
    ]);
    expect(fs.existsSync(path.join(dir, "noticing-summary.json"))).toBe(false);

    // 2 度目の --yes は払わない
    out = [];
    expect(await runNoticing(["--yes"], d)).toBe(2);
    expect(created).toHaveLength(1);

    out = [];
    expect(await runNoticing(["--aggregate"], d)).toBe(0);
    expect(clients).toBe(1); // --aggregate は client を作らない
    const s = JSON.parse(fs.readFileSync(path.join(dir, "noticing-summary.json"), "utf8")) as NoticingSummary;
    expect(s.seasons.map((x) => [x.season, x.read, x.failed])).toEqual([
      [2025, 2, 0],
      [2023, 0, 1],
    ]);
    const s25 = s.seasons[0]!.fields;
    expect(s25.first_sign.counts.mass_death).toBe(2);
    // 2025-2 の本文には staff_hygiene の文がない → 数えない
    expect(s25.staff_hygiene).toEqual({ counts: { issue: 1, no_issue: 0, not_mentioned: 0 }, unverified: 1 });
    expect(s.total.read).toBe(2);
    expectNoLeak(s);
    expect(out.join("\n")).toMatch(/根拠を確かめられず数えなかった 1/u);
  });

  it("--aggregate は pdftotext の本文で、unpdf で照らせなかった欄を照らし直す", async () => {
    fs.writeFileSync(
      path.join(dir, "survey-noticing.json"),
      JSON.stringify({ updatedAt: "", model: NOTICING_MODEL, rows: [{ season: 2025, no: 2, extract: EXTRACT }] }),
    );
    let alt = 0;
    const d = deps({
      pdfTextAlt: async () => {
        alt += 1;
        return DOC_TEXT;
      },
    });
    expect(await runNoticing(["--aggregate"], d)).toBe(0);
    expect(alt).toBe(1);
    const s = JSON.parse(fs.readFileSync(path.join(dir, "noticing-summary.json"), "utf8")) as NoticingSummary;
    expect(s.seasons[0]!.fields.staff_hygiene).toEqual({ counts: { issue: 1, no_issue: 0, not_mentioned: 0 }, unverified: 0 });
  });

  it("max_tokens で切れた応答は読めなかった行にする（再試行しない）", async () => {
    const { client } = fakeClient(() => okMessage(EXTRACT, "max_tokens"));
    expect(await runNoticing(["--yes"], deps({ makeClient: () => client }))).toBe(0);
    const ex = JSON.parse(fs.readFileSync(path.join(dir, "survey-noticing.json"), "utf8")) as { rows: NoticingRow[] };
    expect(ex.rows.every((r) => r.extract === null && r.failure === "max_tokens:max_tokens")).toBe(true);
  });

  it("--resume <batchId> は noticing-batches.json にあるバッチだけを、新しい依頼を作らずに取り直す", async () => {
    const { client, created } = fakeClient(() => okMessage(EXTRACT));
    await client.messages.batches.create({ requests: [{ custom_id: "2025-1", params: {} } as never] });
    const d = deps({
      makeClient: () => {
        clients += 1;
        return client;
      },
    });
    // 控えにない（3 項目の batches.json にだけある）ID は、client を作らずに断る
    fs.writeFileSync(path.join(dir, "survey", "batches.json"), JSON.stringify({ createdAt: "x", model: "m", batches: [{ batchId: "msgbatch_test1", customIds: ["2025-1"] }] }));
    expect(await runNoticing(["--resume", "msgbatch_test1"], d)).toBe(2);
    expect(await runNoticing(["--resume", "bad id!"], d)).toBe(2);
    expect(clients).toBe(0);
    expect(fs.existsSync(path.join(dir, "survey-noticing.json"))).toBe(false);

    fs.writeFileSync(
      path.join(dir, "survey", "noticing-batches.json"),
      JSON.stringify({ createdAt: "x", model: NOTICING_MODEL, batches: [{ batchId: "msgbatch_test1", customIds: ["2025-1"] }] }),
    );
    expect(await runNoticing(["--resume", "msgbatch_test1"], d)).toBe(0);
    expect(clients).toBe(1);
    expect(created).toHaveLength(1);
    const ex = JSON.parse(fs.readFileSync(path.join(dir, "survey-noticing.json"), "utf8")) as { rows: NoticingRow[] };
    expect(ex.rows.map((r) => `${r.season}-${r.no}`)).toEqual(["2025-1"]);
  });

  it("--aggregate は抽出の結果がなければ書かずに止まる", async () => {
    expect(await runNoticing(["--aggregate"], deps())).toBe(1);
    expect(fs.existsSync(path.join(dir, "noticing-summary.json"))).toBe(false);
  });
});

describe("置き場所", () => {
  it("結果と集計は data/private/ にだけ置く（.gitignore 済み）。公開用のファイルを作らない", () => {
    const ROOT = path.resolve(import.meta.dirname, "..", "..");
    const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignore).toContain("data/private/");
    const src = fs.readFileSync(path.join(ROOT, "scripts", "build-trends-noticing.ts"), "utf8");
    expect(src).toContain('path.join(ROOT, "data", "private", "survey-noticing.json")');
    expect(src).toContain('path.join(ROOT, "data", "private", "noticing-summary.json")');
    expect(src).not.toMatch(/"data", "trends"|web\//u);
    expect(src).toContain("maxRetries: 0");
  });
});
