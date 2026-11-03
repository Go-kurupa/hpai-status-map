// 国（農林水産省）の見回り（I-01、設計書 §9.2）。主の入口: 確定（疑似患畜の確認）と移動制限の解除を取りこぼさない。
// 本文の定型文はプログラムで読み、Claude は使わない。読めない本文は pending の文書にして、読み取り（I-05）に回す。
import { logger } from "firebase-functions";
import { applyRead, matchCase, nextCaseId } from "@hpai/shared/cases";
import { toJstIso } from "@hpai/shared/dates";
import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import { filterMaffItems, parseMaffFarm, parseMaffLift, parseMaffPress, type MaffLift } from "@hpai/shared/read/maff";
import type { NormalizedRead } from "@hpai/shared/read/types";
import { seasonOf } from "@hpai/shared/season";
import { normalizeForMatch } from "@hpai/shared/text";
import type { Case, IsoDateTime, MuniCode, PrefCode, Source, StageDates } from "@hpai/shared/types";
import { bucket, db } from "../admin";
import { upsertCase } from "../read/upsert";
import { FAILED, type CheckResult, type Handlers, type TickSink, type WatchDeps } from "./deps";
import { decodeBody, extractHtml, fingerprint } from "./extract";
import { storeDocument } from "./store";

const MAFF_HOST = "www.maff.go.jp";
/** 国の入口は農林水産省の https だけ。リダイレクトも含めてこの外へは出ない。 */
export const allowMaff = (u: URL): boolean => u.protocol === "https:" && u.hostname === MAFF_HOST;

// ── 処理済みの発表の印（Storage の state/maff/national-index.json） ──

const INDEX_PATH = "state/maff/national-index.json";

interface NationalIndex {
  /** 発表の URL → 処理した時刻。事例と文書を残せたものだけに印をつける。 */
  processed: Record<string, IsoDateTime>;
}

async function loadIndex(): Promise<NationalIndex> {
  const file = bucket().file(INDEX_PATH);
  const [exists] = await file.exists();
  if (!exists) return { processed: {} };
  try {
    const parsed = JSON.parse((await file.download())[0].toString("utf8")) as Partial<NationalIndex>;
    return { processed: typeof parsed.processed === "object" && parsed.processed !== null ? parsed.processed : {} };
  } catch {
    return { processed: {} }; // 壊れていても、文書の id が重ならないので二重には作らない
  }
}

async function saveIndex(index: NationalIndex): Promise<void> {
  await bucket().file(INDEX_PATH).save(JSON.stringify(index), { contentType: "application/json", resumable: false });
}

// ── 事例への反映 ──

/** 県と名前（正規化の後）が一致する市町村。ちょうど 1 件のときだけ。 */
function findMuni(geo: GeoStore, prefCode: PrefCode, name: string): MuniEntry | null {
  const want = normalizeForMatch(name);
  const hits = Object.values(geo.index).filter((e) => e.prefCode === prefCode && normalizeForMatch(e.name) === want);
  return hits.length === 1 ? hits[0]! : null;
}

const readCases = async (q: FirebaseFirestore.Query): Promise<Case[]> => (await q.get()).docs.map((d) => d.data() as Case);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
/** updatedAt 以外が同じか。同じなら書き直さない（書き直すと M の onCaseWritten が動き、同じ知らせが重なる）。 */
const sameContent = (a: Case, b: Case): boolean => stable({ ...a, updatedAt: "" }) === stable({ ...b, updatedAt: "" });

function baseRead(over: Partial<NormalizedRead> & Pick<NormalizedRead, "kind" | "prefCode" | "muniCode" | "muniName" | "primaryStage" | "primaryStamp">): NormalizedRead {
  return {
    nationalNo: null,
    prefNo: null,
    birdUse: null,
    housing: null,
    headCount: null,
    stages: {},
    radiiKm: [],
    estimates: { shipment: null, movement: null, surveillance: null },
    negationBasis: null,
    yearCompleted: false,
    wildBirds: [],
    ...over,
  };
}

type ReviewReason = "muni_not_found" | "ambiguous_case" | "number_conflict";

/**
 * 確定の発表を事例にする。県の疑いなどの事例があれば同じ事例に足し（id は変わらない）、なければ作る。
 * 市町村が N03 にない、候補が決められない、同じ N が別の市町村にある、のときは事例を作らず review。
 */
export async function applyNationalConfirmed(
  p: { parsed: NonNullable<ReturnType<typeof parseMaffPress>>; farm: ReturnType<typeof parseMaffFarm>; url: string },
  deps: WatchDeps,
): Promise<{ caseId: string | null; outcome: "created" | "merged" | "review"; reason?: ReviewReason }> {
  const { parsed, farm, url } = p;
  const entry = findMuni(deps.geo, parsed.prefCode, parsed.muniName);
  if (entry === null) return { caseId: null, outcome: "review", reason: "muni_not_found" };

  const season = seasonOf(parsed.date);
  const [inPref, byNo] = await Promise.all([
    readCases(db.collection("cases").where("prefCode", "==", parsed.prefCode)),
    readCases(db.collection("cases").where("nationalNo", "==", parsed.nationalNo)),
  ]);
  // 同じシーズンの同じ N が別の市町村にあるなら、重複を作らず人に任せる（matchCase は市町村で絞るので見えない）
  if (byNo.some((c) => c.season === season && c.confirmState !== "reviewing" && c.muniCode !== entry.code)) {
    return { caseId: null, outcome: "review", reason: "number_conflict" };
  }
  const existing = [...new Map([...inPref, ...byNo].map((c) => [c.id, c])).values()];

  const match = matchCase(
    { prefCode: parsed.prefCode, muniCode: entry.code, date: parsed.date, nationalNo: parsed.nationalNo, stage: "confirmed" },
    existing,
  );
  if (match.kind === "ambiguous") return { caseId: null, outcome: "review", reason: "ambiguous_case" };

  const prev = match.kind === "same" ? (existing.find((c) => c.id === match.caseId) ?? null) : null;
  const read = baseRead({
    kind: "confirmed",
    prefCode: parsed.prefCode,
    muniCode: entry.code,
    muniName: entry.name,
    nationalNo: parsed.nationalNo,
    birdUse: farm.birdUse,
    headCount: farm.headCount,
    primaryStage: "confirmed",
    primaryStamp: { date: parsed.date, time: null },
  });
  let next = applyRead(prev, read, url, "national", deps.now());
  if (prev === null) next = { ...next, id: nextCaseId(entry.code, parsed.date, existing) };

  if (prev === null || !sameContent(prev, next)) await upsertCase(next);
  return { caseId: next.id, outcome: prev === null ? "created" : "merged" };
}

/**
 * 移動制限の解除の発表を、対応する事例（県、市町村、N が一致）に足す。事例を作らない。
 * 防疫措置の完了日と搬出制限の解除日は、事例の空欄だけ埋める。
 */
export async function applyNationalLift(
  p: { lift: MaffLift; url: string },
  deps: WatchDeps,
): Promise<{ caseIds: string[]; missing: number[] }> {
  const { lift, url } = p;
  const wantName = normalizeForMatch(lift.muniName);
  const caseIds: string[] = [];
  const missing: number[] = [];

  for (const no of lift.nationalNos) {
    const hits = (await readCases(db.collection("cases").where("nationalNo", "==", no))).filter(
      (c) =>
        c.confirmState !== "reviewing" &&
        c.prefCode === lift.prefCode &&
        c.muniCode !== null &&
        normalizeForMatch(c.muniName ?? "") === wantName &&
        c.season <= seasonOf(lift.date),
    );
    const prev = hits.sort((a, b) => b.season - a.season)[0];
    if (prev === undefined || prev.muniCode === null || prev.muniName === null) {
      missing.push(no);
      continue;
    }
    const stages: StageDates = {};
    if (lift.controlDone !== null) stages.control_done = { date: lift.controlDone, time: null };
    if (lift.shipmentLifted !== null) stages.shipment_lifted = { date: lift.shipmentLifted, time: null };
    const read = baseRead({
      kind: "zone_lifted",
      prefCode: prev.prefCode,
      muniCode: prev.muniCode as MuniCode,
      muniName: prev.muniName,
      nationalNo: no,
      primaryStage: "movement_lifted",
      primaryStamp: { date: lift.date, time: null },
      stages,
    });
    const next = applyRead(prev, read, url, "national", deps.now());
    if (!sameContent(prev, next)) await upsertCase(next);
    caseIds.push(next.id);
  }
  return { caseIds, missing };
}

// ── 入口ごとの確認 ──

const passThrough = (s: Source): CheckResult => ({ ok: true, etag: s.etag, lastModified: s.lastModified, fingerprint: s.fingerprint });

/** 今季ページ。指紋だけを見る（文書は作らない）。変わったら tick が報道発表を前倒しで確認する。 */
export async function checkMaffSeason(source: Source, deps: WatchDeps): Promise<CheckResult> {
  const o = await deps.fetch(source.url, { etag: source.etag, lastModified: source.lastModified, allowUrl: allowMaff });
  if (o.kind === "not_modified") return passThrough(source);
  if (o.kind !== "ok") return FAILED;
  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  return { ok: true, etag: o.etag, lastModified: o.lastModified, fingerprint: fingerprint(page.text) };
}

/** 発表のページを 1 本読み、事例と文書を残す。取得に失敗したら throw（印をつけない）。 */
async function processItem(
  item: { url: string; title: string; type: "confirmed" | "movement_lifted" },
  source: Source,
  deps: WatchDeps,
  sink: TickSink,
): Promise<void> {
  const o = await deps.fetch(item.url, { allowUrl: allowMaff });
  if (o.kind !== "ok") throw new Error(`発表のページを取得できません（${o.kind}）: ${item.url}`);
  const text = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl).text;
  const base = {
    source,
    url: item.url,
    title: item.title,
    contentType: "html" as const,
    body: o.body,
    fingerprint: fingerprint(text),
    textForRead: text,
    hasTextLayer: true,
    fetchedAt: o.fetchedAt,
  };

  if (item.type === "confirmed") {
    const parsed = parseMaffPress(text);
    if (parsed === null) {
      sink.reviews.push({ url: item.url, title: item.title, prefCode: null, reason: "unreadable" });
      await storeDocument({ ...base, prefCode: null, readState: "pending", kind: null });
      return;
    }
    const r = await applyNationalConfirmed({ parsed, farm: parseMaffFarm(text), url: item.url }, deps);
    if (r.outcome === "review") {
      sink.reviews.push({ url: item.url, title: item.title, prefCode: parsed.prefCode, reason: r.reason ?? "ambiguous_case" });
      await storeDocument({ ...base, prefCode: parsed.prefCode, readState: "pending", kind: "confirmed" });
      return;
    }
    await storeDocument({ ...base, prefCode: parsed.prefCode, readState: "published", kind: "confirmed", caseId: r.caseId });
    return;
  }

  const lift = parseMaffLift(text);
  if (lift === null) {
    sink.reviews.push({ url: item.url, title: item.title, prefCode: null, reason: "unreadable" });
    await storeDocument({ ...base, prefCode: null, readState: "pending", kind: null });
    return;
  }
  const r = await applyNationalLift({ lift, url: item.url }, deps);
  if (r.missing.length > 0) {
    sink.missing.push({ url: item.url, prefCode: lift.prefCode, muniName: lift.muniName, nationalNos: r.missing, date: lift.date });
  }
  // 事例が 1 つ複数でも、文書の caseId は 1 つ。複数の解除は番号の小さい事例の id を持つ。反映できなかった解除は discarded（読み取りに回さない）
  await storeDocument({
    ...base,
    prefCode: lift.prefCode,
    readState: r.caseIds.length > 0 ? "published" : "discarded",
    kind: "zone_lifted",
    caseId: r.caseIds[0] ?? null,
  });
}

/** 国の報道発表。新しい確認と解除の発表だけを取り、定型文から事例を作る。 */
export async function checkMaffPress(source: Source, deps: WatchDeps, sink: TickSink): Promise<CheckResult> {
  const o = await deps.fetch(source.url, { etag: source.etag, lastModified: source.lastModified, allowUrl: allowMaff });
  if (o.kind === "not_modified") return passThrough(source);
  if (o.kind !== "ok") return FAILED;

  const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
  const index = await loadIndex();
  let allDone = true;
  for (const item of filterMaffItems(page.links)) {
    if (index.processed[item.url] !== undefined) continue;
    try {
      await processItem(item, source, deps, sink);
      index.processed[item.url] = toJstIso(deps.now());
      await saveIndex(index);
    } catch (e) {
      allDone = false; // 印をつけない。入口の印（etag）も更新しないので、次の巡回でもう一度ここに来る
      logger.warn("国の発表を処理できませんでした", { url: item.url, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!allDone) return FAILED;
  return { ok: true, etag: o.etag, lastModified: o.lastModified, fingerprint: fingerprint(page.text) };
}

export const maffHandlers: Handlers = {
  maff_press: checkMaffPress,
  maff_season: checkMaffSeason,
};
