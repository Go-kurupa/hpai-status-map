// 取得した文書を、原本（Storage の raw/）と記録（Firestore の documents）に残す（I-01。I-02、I-12、I-18 も使う）。
import type { DocumentKind, DocumentRecord, ReadState } from "@hpai/shared/read/types";
import { jstDateOf } from "@hpai/shared/dates";
import { extractAnnouncedOn } from "@hpai/shared/read/announcedOn";
import type { IsoDate, IsoDateTime, PrefCode, Source } from "@hpai/shared/types";
import { bucket, db } from "../admin";
import { sha256Hex } from "./extract";

export interface StoreDocumentInput {
  source: Source;
  url: string;
  title: string;
  contentType: "html" | "pdf";
  body: Buffer;
  fingerprint: string;
  /** 読み取りに渡す本文（raw/{id}.txt）。PDF は照合用の文字層。 */
  textForRead: string;
  hasTextLayer: boolean;
  prefCode: PrefCode | null;
  fetchedAt: IsoDateTime;
  readState: ReadState;
  kind?: DocumentKind | null;
  /** 国の定型文から事例を作った（足した）ときの事例 id。 */
  caseId?: string | null;
  /** 発表日。渡さなければ本文から取り出す（RSS の日付など、確かなものがあれば呼び手が渡す）。取得の日より後なら使わない。 */
  announcedOn?: IsoDate | null;
}

/** 発表日を決める。渡された日付を優先し、なければ本文から。取得の日より後（日本時間）の日付は信用せず null。 */
export function announcedOnOf(input: Pick<StoreDocumentInput, "announcedOn" | "textForRead" | "source" | "fetchedAt">): IsoDate | null {
  const d = input.announcedOn !== undefined ? input.announcedOn : extractAnnouncedOn(input.textForRead, { maff: input.source.kind.startsWith("maff") });
  if (d === null) return null;
  const fetched = Date.parse(input.fetchedAt);
  return Number.isFinite(fetched) && d > jstDateOf(new Date(fetched)) ? null : d;
}

/** documents/{sha256(url) 先頭 24 桁}_{指紋 先頭 12 桁}。同じ URL でも本文が変われば別の文書になる。 */
export function documentIdOf(url: string, fingerprint: string): string {
  return `${sha256Hex(url).slice(0, 24)}_${fingerprint.slice(0, 12)}`;
}

const ALREADY_EXISTS = 6;
const isAlreadyExists = (e: unknown) => (e as { code?: unknown } | null)?.code === ALREADY_EXISTS;

/**
 * 文書を残す。すでにあれば何もせず created:false。
 * 書く順は、原本と本文を Storage に先に置いてから、最終の readState で Firestore に create() する
 * （読み取りは文書の作成で始まるので、本文がない状態や、あとから pending に変わる状態を作らない）。
 */
export async function storeDocument(input: StoreDocumentInput): Promise<{ created: boolean; id: string }> {
  const id = documentIdOf(input.url, input.fingerprint);
  const ref = db.doc(`documents/${id}`);
  if ((await ref.get()).exists) return { created: false, id };

  const storagePath = `raw/${id}.${input.contentType}`;
  const b = bucket();
  await b.file(storagePath).save(input.body, { contentType: input.contentType === "pdf" ? "application/pdf" : "text/html; charset=utf-8", resumable: false });
  await b.file(`raw/${id}.txt`).save(input.textForRead, { contentType: "text/plain; charset=utf-8", resumable: false });

  const record: DocumentRecord = {
    id,
    sourceId: input.source.id,
    prefCode: input.prefCode,
    url: input.url,
    title: input.title,
    contentType: input.contentType,
    storagePath,
    fetchedAt: input.fetchedAt,
    fingerprint: input.fingerprint,
    hasTextLayer: input.hasTextLayer,
    kind: input.kind ?? null,
    readState: input.readState,
    primary: null,
    second: null,
    verify: null,
    compare: null,
    caseId: input.caseId ?? null,
    announcedOn: announcedOnOf(input),
    error: null,
  };
  try {
    await ref.create(record);
  } catch (e) {
    if (isAlreadyExists(e)) return { created: false, id };
    throw e;
  }
  return { created: true, id };
}
