// readDocument の模擬環境の試験の道具（I-05）。偽の client、文書の置き方、読み手の返事の作り方。実際の Claude は呼ばない。
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { GeoStore } from "@hpai/shared/geo";
import type { DocumentKind, DocumentRecord } from "@hpai/shared/read/types";
import type { Case, CaseStage, PrefCode, Source } from "@hpai/shared/types";
import { bucket, db } from "../../src/admin";
import { loadGeoStore } from "../../src/geo/loadGeo";

export const PROJECT = "demo-hpai";
export const GEO_DIR = path.resolve(import.meta.dirname, "../../../data/geo");
export const NOW = new Date("2025-12-22T03:30:00Z");
export const FETCHED_AT = "2025-12-22T12:00:00+09:00";
export const PRIMARY_MODEL = "claude-opus-5-5";
export const SECOND_MODEL = "claude-haiku-5-5";

export function requireEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
}

export async function clearAll(): Promise<void> {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
}

export const loadGeo = (): Promise<GeoStore> => loadGeoStore(GEO_DIR);

// ── 読み手の返事 ──
export interface Scenario {
  kind: DocumentKind;
  stage: CaseStage | null;
  pref: string; // 「岡山県」。引用に県名を入れたくないときは quotePref:false
  muni: string; // 「津山市」
  month: number;
  day: number;
  /** 本文の 1 文（全項目の引用に使う）。 */
  sentence: string;
  nationalNo?: number;
  quotePref?: boolean;
}

/** 本文: 題 + 1 文。 */
export const bodyOf = (title: string, sentence: string): string => `${title}\n${sentence}\n`;

export const sentenceOf = (o: { pref?: string; muni: string; month: number; day: number; tail: string }): string =>
  `令和7年${o.month}月${o.day}日、${o.pref ?? "岡山県"}${o.muni}の養鶏場において、${o.tail}`;

export const SUSPECT_TAIL = "簡易検査で陽性を確認しました。";
export const CONFIRM_TAIL = "遺伝子検査を実施した結果、疑似患畜と確認しました。";

export function primaryWire(s: Scenario): string {
  const facts: Array<{ field: string; value: string; quote: string }> = [
    { field: "prefecture", value: s.pref, quote: s.sentence },
    { field: "municipality", value: s.muni, quote: s.sentence },
  ];
  if (s.nationalNo !== undefined) facts.push({ field: "nationalNo", value: String(s.nationalNo), quote: s.sentence });
  return JSON.stringify({
    kind: s.kind,
    kindQuote: s.sentence,
    multipleCases: false,
    facts,
    primaryStage: s.stage,
    primaryDate: { year: null, month: s.month, day: s.day, time: null },
    primaryDateQuote: s.sentence,
    stageEvents: [],
    radiiKm: [],
    estimates: [],
    wildBirds: [],
  });
}

export const secondWire = (s: Scenario): string =>
  JSON.stringify({
    kind: s.kind,
    multipleCases: false,
    prefecture: s.pref,
    municipality: s.muni,
    primaryStage: s.stage,
    primaryDate: { year: null, month: s.month, day: s.day, time: null },
    wildBirds: [],
  });

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export function message(text: string, usage: Usage = { input_tokens: 1000, output_tokens: 200 }): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test",
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    content: [{ type: "text", text, citations: null }],
    usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

export function refusal(category: string | null, usage?: Usage): Anthropic.Message {
  return {
    ...message("", usage ?? { input_tokens: 500, output_tokens: 0 }),
    stop_reason: "refusal",
    stop_details: category === null ? null : { category },
  } as unknown as Anthropic.Message;
}

export type Reply = Anthropic.Message | Error | ((params: Anthropic.MessageCreateParamsNonStreaming) => Anthropic.Message | Promise<Anthropic.Message>);

/** 偽の client。モデルの名前で主と別の読み手を分ける。渡された引数をすべて控える。 */
export function fakeClient(replies: { primary: Reply; second: Reply }) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    calls.push(params);
    const r = params.model === PRIMARY_MODEL ? replies.primary : replies.second;
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(params) : r;
  };
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}

/** 主と別の読み手が同じ読みをする偽の client。 */
export const agreeing = (s: Scenario) => fakeClient({ primary: message(primaryWire(s)), second: message(secondWire(s)) });

// ── 文書と事例を置く ──
export interface SeedDoc {
  id: string;
  title: string;
  text: string | null; // null なら raw/{id}.txt を置かない
  prefCode?: PrefCode | null;
  sourceId?: string;
  contentType?: "html" | "pdf";
  pdf?: Buffer;
  hasTextLayer?: boolean;
  readState?: DocumentRecord["readState"];
  fetchedAt?: string;
}

export async function seedDoc(d: SeedDoc): Promise<DocumentRecord> {
  const contentType = d.contentType ?? "html";
  const storagePath = `raw/${d.id}.${contentType}`;
  if (d.text !== null) await bucket().file(`raw/${d.id}.txt`).save(d.text, { contentType: "text/plain; charset=utf-8", resumable: false });
  await bucket().file(storagePath).save(d.pdf ?? Buffer.from(d.text ?? ""), { resumable: false });
  const rec: DocumentRecord = {
    id: d.id,
    sourceId: d.sourceId ?? "src1",
    prefCode: d.prefCode === undefined ? "33" : d.prefCode,
    url: `https://example.test/${d.id}`,
    title: d.title,
    contentType,
    storagePath,
    fetchedAt: d.fetchedAt ?? FETCHED_AT,
    fingerprint: "f".repeat(64),
    hasTextLayer: d.hasTextLayer ?? true,
    kind: null,
    readState: d.readState ?? "pending",
    primary: null,
    second: null,
    verify: null,
    compare: null,
    caseId: null,
    error: null,
  };
  await db.doc(`documents/${d.id}`).set(rec);
  return rec;
}

export async function seedSource(id: string, kind: Source["kind"], prefCode: PrefCode | null): Promise<void> {
  const s: Source = {
    id,
    prefCode,
    url: `https://example.test/${id}`,
    kind,
    confirmedOn: "2025-11-01",
    note: null,
    group: 0,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 0,
  };
  await db.doc(`sources/${id}`).set(s);
}

export const setSettings = (data: Record<string, unknown>): Promise<unknown> => db.doc("usage/settings").set(data);

export function realCase(o: Partial<Case> = {}): Case {
  return {
    id: "33203-2025-12-20-1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.test/old"],
    updatedAt: "2025-12-21T12:00:00+09:00",
    ...o,
  };
}

export const getDoc = async (p: string): Promise<Record<string, any> | undefined> => (await db.doc(p).get()).data();
export const listIds = async (collection: string): Promise<string[]> => (await db.collection(collection).get()).docs.map((d) => d.id).sort();
