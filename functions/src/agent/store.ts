// 道具が Firestore と politeFetch につながる部分（X-14）。tools.ts は偽物の deps で試せるよう、Firestore に触らない。
// 読むだけ: sources と watchStatus。書くのは確認の箱（enqueueReview）と取得の回数だけで、sources は書かない。
import type { IsoDateTime, PrefCode, SourceKind } from "@hpai/shared/types";
import { db } from "../admin";
import { enqueueReview } from "../review/queue";
import { politeFetch } from "../watch/politeFetch";
import { reserveAgentCall } from "./limits";
import type { AgentToolDeps, SourceRow } from "./tools";

export async function readSourceRows(): Promise<SourceRow[]> {
  const snap = await db.collection("sources").get();
  return snap.docs.map((d): SourceRow => {
    const s = d.data() as { prefCode?: PrefCode | null; url?: string; kind?: SourceKind; enabled?: boolean; confirmedOn?: string };
    return { prefCode: s.prefCode ?? null, url: s.url ?? "", kind: s.kind as SourceKind, enabled: s.enabled === true, confirmedOn: s.confirmedOn ?? "" };
  });
}

export async function readFailingSince(): Promise<ReadonlyMap<PrefCode, IsoDateTime | null>> {
  const snap = await db.collection("watchStatus").get();
  return new Map(snap.docs.map((d): [PrefCode, IsoDateTime | null] => [d.id, (d.data() as { failingSince?: IsoDateTime | null }).failingSince ?? null]));
}

/** 本物の deps。隠す県（AGENT_EVAL_HIDE_PREFS）だけは呼び出し側が渡す（設定は handler の中で読むため）。 */
export function firestoreToolDeps(hidePrefs: AgentToolDeps["hidePrefs"], over: Partial<AgentToolDeps> = {}): AgentToolDeps {
  return {
    fetch: politeFetch,
    reserveCall: reserveAgentCall,
    now: () => new Date(),
    readSources: readSourceRows,
    readFailingSince,
    hidePrefs,
    enqueue: enqueueReview,
    ...over,
  };
}
