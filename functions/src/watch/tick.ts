// 1 時間ごとの見回り（I-01）。入口を 3 つの group に分け、JST の時 % 3 が group と等しいものを回す（3 時間で 1 周）。
// 取得は再試行しない。失敗は failureCount + 1。入口の種類ごとの確認は handlers が持つ（国は maff.ts、環境省は moe.ts、県は page.ts と rss.ts）。
import { logger } from "firebase-functions";
import { toJstIso } from "@hpai/shared/dates";
import type { Source } from "@hpai/shared/types";
import { db } from "../admin";
import { FAILED, type CheckResult, type Handlers, type MissingNote, type ReviewNote, type TickSink, type WatchDeps } from "./deps";

export type { CheckResult, Handlers, MissingNote, ReviewNote, SourceHandler, TickSink, WatchDeps } from "./deps";

/** 入口の読み書き。本番は Firestore の sources、試験は偽物。 */
export interface TickIo {
  listSources(): Promise<Source[]>;
  updateSource(id: string, patch: Partial<Source>): Promise<void>;
}

export interface TickReport {
  group: 0 | 1 | 2;
  checked: Array<{ id: string; kind: Source["kind"]; ok: boolean }>;
  /** 実装のない種類の入口。失敗にも数えない。 */
  skipped: string[];
  /** 今季ページの指紋が変わって、前倒しで確認した報道発表の入口。 */
  early: string[];
  reviews: ReviewNote[];
  missing: MissingNote[];
}

/** 日本時間の時（0〜23）。 */
export function jstHour(d: Date): number {
  return (d.getUTCHours() + 9) % 24;
}

/** 確認の結果から、入口に書く更新。成功は印を更新し、失敗は数と時刻だけ（etag と指紋は前のまま）。 */
export function sourcePatch(source: Source, result: CheckResult, now: Date): Partial<Source> {
  const at = toJstIso(now);
  if (!result.ok) return { failureCount: source.failureCount + 1, lastCheckedAt: at };
  return { failureCount: 0, lastCheckedAt: at, lastOkAt: at, etag: result.etag, lastModified: result.lastModified, fingerprint: result.fingerprint };
}

export async function runTick(deps: WatchDeps, io: TickIo, handlers: Handlers): Promise<TickReport> {
  const group = (jstHour(deps.now()) % 3) as 0 | 1 | 2;
  const all = (await io.listSources()).filter((s) => s.enabled);
  const sink: TickSink = { reviews: [], missing: [] };
  const report: TickReport = { group, checked: [], skipped: [], early: [], reviews: sink.reviews, missing: sink.missing };
  const ran = new Set<string>();

  const check = async (source: Source): Promise<CheckResult | null> => {
    const handler = handlers[source.kind];
    if (handler === undefined) {
      report.skipped.push(source.id);
      return null;
    }
    ran.add(source.id);
    let result: CheckResult;
    try {
      result = await handler(source, deps, sink);
    } catch (e) {
      logger.error("見回りで想定外の失敗", { sourceId: source.id, kind: source.kind, message: e instanceof Error ? e.message : String(e) });
      result = FAILED;
    }
    await io.updateSource(source.id, sourcePatch(source, result, deps.now()));
    report.checked.push({ id: source.id, kind: source.kind, ok: result.ok });
    return result;
  };

  let seasonChanged = false;
  for (const source of all.filter((s) => s.group === group)) {
    const result = await check(source);
    if (
      source.kind === "maff_season" &&
      result !== null &&
      result.ok &&
      source.fingerprint !== null &&
      result.fingerprint !== null &&
      result.fingerprint !== source.fingerprint
    ) {
      seasonChanged = true;
    }
  }

  // 今季ページが動いたら、報道発表を次の巡回を待たずに確認する（確定を取りこぼさない）。文書は今季ページからは作らない。
  if (seasonChanged) {
    for (const source of all.filter((s) => s.kind === "maff_press" && !ran.has(s.id))) {
      report.early.push(source.id);
      await check(source);
    }
  }
  return report;
}

/** 本番の入口の読み書き（Firestore の sources）。 */
export function firestoreIo(): TickIo {
  return {
    async listSources() {
      const snap = await db.collection("sources").get();
      return snap.docs.map((d) => d.data() as Source);
    },
    async updateSource(id, patch) {
      await db.doc(`sources/${id}`).update(patch);
    },
  };
}
