// カードの JSON の読み込みの検査。違反は throw する（黙って落とさない）。
import { z } from "zod";
import type { ConsultCard, ConsultCardsFile, ConsultLicense, ConsultSource, Evidence, SourceKind } from "./types";

export const EVIDENCE_VALUES = [
  "obligation",
  "outbreak-finding",
  "study-association",
  "study-no-difference",
  "recommendation",
  "expert-estimate",
] as const satisfies readonly Evidence[];

export const SOURCE_KINDS = ["law", "guideline", "report", "pamphlet", "paper", "guide"] as const satisfies readonly SourceKind[];

// 自由に使える資料の許可証。これ以外の綴りは通さない。
export const ALLOWED_LICENSES = ["PDL1.0", "CC BY", "CC BY 4.0", "OGL v3.0", "US Gov"] as const satisfies readonly ConsultLicense[];

const text = z.string().trim().min(1);
const httpUrl = z.url().refine((s) => /^https?:\/\//i.test(s), "http か https の URL にする");
const fetchedAt = z.string().regex(/^\d{4}-\d{2}-\d{2}(T.+)?$/, "YYYY-MM-DD か日時にする");

const sourceSchema = z.strictObject({
  id: text,
  title: text,
  publisher: text,
  url: httpUrl,
  fetchedAt,
  domestic: z.boolean(),
  kind: z.enum(SOURCE_KINDS),
  license: z.enum(ALLOWED_LICENSES),
  licenseVerified: z.boolean(),
  studyDesign: z.string().nullable(),
});

const cardSchema = z.strictObject({
  id: text,
  origin: text,
  action: text,
  appliesTo: text,
  evidence: z.enum(EVIDENCE_VALUES),
  evidenceNote: z.string(),
  quote: text,
  sourceId: text,
  locator: z.string(),
  caveats: z.array(z.string()),
  conditionTags: z.array(text),
  quoteVerified: z.boolean().optional(),
  approved: z.boolean(),
});

// 重複した id を最初の 1 件を除いて数える。
const duplicates = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
};

const fileSchema = z.strictObject({ sources: z.array(sourceSchema), cards: z.array(cardSchema) }).superRefine((file, ctx) => {
  for (const id of duplicates(file.sources.map((s) => s.id))) {
    ctx.addIssue({ code: "custom", path: ["sources"], message: `資料の id が重複: ${id}` });
  }
  for (const id of duplicates(file.cards.map((c) => c.id))) {
    ctx.addIssue({ code: "custom", path: ["cards"], message: `カードの id が重複: ${id}` });
  }
  const sourceIds = new Set(file.sources.map((s) => s.id));
  file.cards.forEach((c, i) => {
    if (!sourceIds.has(c.sourceId)) {
      ctx.addIssue({ code: "custom", path: ["cards", i, "sourceId"], message: `sourceId が sources にない: ${c.sourceId}` });
    }
  });
});

// 型とスキーマのずれを型検査で見つける。
type Assert<T extends true> = T;
type _Source = Assert<z.infer<typeof sourceSchema> extends ConsultSource ? (ConsultSource extends z.infer<typeof sourceSchema> ? true : false) : false>;
type _Card = Assert<z.infer<typeof cardSchema> extends ConsultCard ? (ConsultCard extends z.infer<typeof cardSchema> ? true : false) : false>;
export type _SchemaMatchesTypes = [_Source, _Card];

export function parseCardsFile(raw: unknown): ConsultCardsFile {
  return fileSchema.parse(raw);
}
