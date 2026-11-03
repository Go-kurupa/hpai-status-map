// 主と別の読み手のスキーマ（契約 2.6）。JSON Schema は手書き、zod は受信の検証と ReadResult への変換。web から import しない。
//
// 構造化出力の制約: additionalProperties:false 必須、全項目 required、数値と長さの制約は不可、
// union（anyOf と type 配列）は 16 まで。$ref は使わず、日付の schema は使う場所ごとに展開する。
// Quoted の 8 項目は facts の配列に畳む。値のない項目は行を出さない。
import { z } from "zod";
import { normalizeForMatch } from "../text";
import type { CaseStage, WildBirdTest } from "../types";
import type { DocumentKind, ReadResult, SecondReadResult } from "./types";

export const DOCUMENT_KINDS = [
  "suspected",
  "confirmed",
  "progress",
  "control_done",
  "zone_lifted",
  "negated",
  "wild_bird",
  "other_pref",
  "drill",
  "notice",
  "irrelevant",
] as const satisfies readonly DocumentKind[];

export const CASE_STAGES = [
  "suspected",
  "confirmed",
  "culling_done",
  "control_done",
  "shipment_lifted",
  "movement_lifted",
  "surveillance_lifted",
] as const satisfies readonly CaseStage[];

export const WILD_BIRD_TESTS = ["screening_positive", "hpai_confirmed", "negative"] as const satisfies readonly WildBirdTest[];
export const ESTIMATE_TARGETS = ["shipment", "movement", "surveillance"] as const;
export const FACT_FIELDS = [
  "prefecture",
  "municipality",
  "nationalNo",
  "prefNo",
  "birdUse",
  "housing",
  "headCount",
  "negationBasis",
] as const;
type FactField = (typeof FACT_FIELDS)[number];

// ── JSON Schema ──
type JsonSchema = { [key: string]: unknown };

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const string = (): JsonSchema => ({ type: "string" });
const nullableString = (): JsonSchema => ({ type: ["string", "null"] });
const dateSchema = (): JsonSchema =>
  object({
    year: { type: ["integer", "null"] },
    month: { type: "integer" },
    day: { type: "integer" },
    time: nullableString(),
  });
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });

export const READ_RESULT_JSON_SCHEMA: JsonSchema = object({
  kind: { type: "string", enum: [...DOCUMENT_KINDS] },
  kindQuote: nullableString(),
  multipleCases: { type: "boolean" },
  facts: {
    type: "array",
    items: object({ field: { type: "string", enum: [...FACT_FIELDS] }, value: string(), quote: string() }),
  },
  primaryStage: { type: ["string", "null"], enum: [...CASE_STAGES, null] },
  primaryDate: nullable(dateSchema()),
  primaryDateQuote: nullableString(),
  stageEvents: {
    type: "array",
    items: object({ stage: { type: "string", enum: [...CASE_STAGES] }, date: dateSchema(), quote: string() }),
  },
  radiiKm: { type: "array", items: object({ km: { type: "number" }, quote: string() }) },
  estimates: {
    type: "array",
    items: object({ target: { type: "string", enum: [...ESTIMATE_TARGETS] }, date: dateSchema(), quote: string() }),
  },
  wildBirds: {
    type: "array",
    items: object({
      date: dateSchema(),
      prefecture: string(),
      municipality: nullableString(),
      species: nullableString(),
      test: { type: "string", enum: [...WILD_BIRD_TESTS] },
      quote: string(),
    }),
  },
});

export const SECOND_READ_RESULT_JSON_SCHEMA: JsonSchema = object({
  kind: { type: "string", enum: [...DOCUMENT_KINDS] },
  multipleCases: { type: "boolean" },
  prefecture: nullableString(),
  municipality: nullableString(),
  primaryStage: { type: ["string", "null"], enum: [...CASE_STAGES, null] },
  primaryDate: nullable(dateSchema()),
  wildBirds: {
    type: "array",
    items: object({
      date: dateSchema(),
      prefecture: string(),
      municipality: nullableString(),
      test: { type: "string", enum: [...WILD_BIRD_TESTS] },
    }),
  },
});

// ── zod（受信の検証と変換）。数値や長さの制約はここで掛ける（JSON Schema には書けない） ──
const DateSchema = z.strictObject({
  year: z.number().int().min(1900).max(2100).nullable(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).nullable(),
});

const FactSchema = z.strictObject({ field: z.enum(FACT_FIELDS), value: z.string(), quote: z.string() });

const RawReadSchema = z.strictObject({
  kind: z.enum(DOCUMENT_KINDS),
  kindQuote: z.string().nullable(),
  multipleCases: z.boolean(),
  facts: z.array(FactSchema),
  primaryStage: z.enum(CASE_STAGES).nullable(),
  primaryDate: DateSchema.nullable(),
  primaryDateQuote: z.string().nullable(),
  stageEvents: z.array(z.strictObject({ stage: z.enum(CASE_STAGES), date: DateSchema, quote: z.string() })),
  radiiKm: z.array(z.strictObject({ km: z.number().positive().finite(), quote: z.string() })),
  estimates: z.array(z.strictObject({ target: z.enum(ESTIMATE_TARGETS), date: DateSchema, quote: z.string() })),
  wildBirds: z.array(
    z.strictObject({
      date: DateSchema,
      prefecture: z.string(),
      municipality: z.string().nullable(),
      species: z.string().nullable(),
      test: z.enum(WILD_BIRD_TESTS),
      quote: z.string(),
    }),
  ),
});
type RawRead = z.infer<typeof RawReadSchema>;

/** 数を表す文字列だけを数にする。全角、コンマは直す。数にならなければ null。 */
function toCount(s: string): number | null {
  const t = normalizeForMatch(s).replace(/,/gu, "");
  if (!/^\d+$/u.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function convert(raw: RawRead): ReadResult {
  const row = (field: FactField) => raw.facts.find((f) => f.field === field);
  const text = (field: FactField) => {
    const f = row(field);
    return f ? { value: f.value.trim() === "" ? null : f.value, quote: f.quote } : { value: null, quote: null };
  };
  const count = (field: FactField) => {
    const f = row(field);
    return f ? { value: toCount(f.value), quote: f.quote } : { value: null, quote: null };
  };
  return {
    kind: raw.kind,
    kindQuote: raw.kindQuote,
    multipleCases: raw.multipleCases,
    prefecture: text("prefecture"),
    municipality: text("municipality"),
    nationalNo: count("nationalNo"),
    prefNo: count("prefNo"),
    birdUse: text("birdUse"),
    housing: text("housing"),
    headCount: count("headCount"),
    negationBasis: text("negationBasis"),
    primaryStage: raw.primaryStage,
    primaryDate: raw.primaryDate,
    primaryDateQuote: raw.primaryDateQuote,
    stageEvents: raw.stageEvents,
    radiiKm: raw.radiiKm,
    estimates: raw.estimates,
    wildBirds: raw.wildBirds,
  };
}

/** 主の読み手の受信。facts を ReadResult の Quoted 8 項目に変換する。同じ field が 2 行なら失敗（format_error）。 */
export const ReadResultSchema = RawReadSchema.refine(
  (raw) => new Set(raw.facts.map((f) => f.field)).size === raw.facts.length,
  { path: ["facts"], message: "duplicate_field" },
).transform(convert);

export const SecondReadResultSchema = z.strictObject({
  kind: z.enum(DOCUMENT_KINDS),
  multipleCases: z.boolean(),
  prefecture: z.string().nullable(),
  municipality: z.string().nullable(),
  primaryStage: z.enum(CASE_STAGES).nullable(),
  primaryDate: DateSchema.nullable(),
  wildBirds: z.array(
    z.strictObject({
      date: DateSchema,
      prefecture: z.string(),
      municipality: z.string().nullable(),
      test: z.enum(WILD_BIRD_TESTS),
    }),
  ),
}) satisfies z.ZodType<SecondReadResult>;
