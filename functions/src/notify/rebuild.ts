// 朝のまとめと送り直しが使う、記録（sentNotices）から Notice を組み立て直す部分（M-13、設計書 §6）。
// 記録は段階も設定も持たないので、送る直前に農場、事例、野鳥を読み直して宛先と段階を計算し直す。
// 送らないと決めたものは消す（drop）。sent にはしない（planCaseNotices は sent の記録から訂正かを決めるため）。
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { diffDays } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { mortalityNotices, selfCheckDueNotice, planCaseNotices, wildBirdNotices, type Notice, type SentNotice } from "@hpai/shared/notices";
import type { Case, Farm, IsoDate, WildBird } from "@hpai/shared/types";

/** 読んだ記録。state は読んだときの状態（送る直前の読み直しと比べる）。 */
export interface QueueRec {
  ref: DocumentReference;
  id: string;
  data: SentNotice;
}

/** drop: 送らない（記録を消す）／fail: 元の事例、野鳥がない（failed にする）／skip: 今は判断できない（そのまま）。 */
export type Rebuilt = { kind: "send"; notice: Notice } | { kind: "drop" } | { kind: "fail" } | { kind: "skip" };

type FarmDoc = Farm & { id: string };
type FarmRead = { kind: "ok"; farm: FarmDoc } | { kind: "missing" } | { kind: "unreadable" };

export interface RebuildContext {
  db: Firestore;
  geo: GeoStore;
  today: IsoDate;
  farms: Map<string, Promise<FarmRead>>;
  cases: Map<string, Promise<Case | null>>;
  birds: Map<string, Promise<WildBird | null>>;
  sentBySubject: Map<string, Promise<SentNotice[]>>;
  answered: Map<string, Promise<boolean>>;
}

export function createRebuildContext(db: Firestore, geo: GeoStore, today: IsoDate): RebuildContext {
  return { db, geo, today, farms: new Map(), cases: new Map(), birds: new Map(), sentBySubject: new Map(), answered: new Map() };
}

const CASE_EVENTS: ReadonlySet<string> = new Set(["suspected", "confirmed", "reviewing", "negated", "shipment_lifted", "movement_lifted"]);

function memo<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = make();
    map.set(key, p);
  }
  return p;
}

const farmOf = (ctx: RebuildContext, farmId: string): Promise<FarmRead> =>
  memo(ctx.farms, farmId, async () => {
    const snap = await ctx.db.collection("farms").doc(farmId).get();
    if (!snap.exists) return { kind: "missing" };
    const farm = { id: snap.id, ...(snap.data() as Farm) };
    if (!Array.isArray(farm.memberUids) || !Array.isArray(farm.unsubscribedUids)) return { kind: "unreadable" };
    return { kind: "ok", farm };
  });

const caseOf = (ctx: RebuildContext, id: string): Promise<Case | null> =>
  memo(ctx.cases, id, async () => {
    const snap = await ctx.db.collection("cases").doc(id).get();
    return snap.exists ? { ...(snap.data() as Case), id: snap.id } : null;
  });

const birdOf = (ctx: RebuildContext, id: string): Promise<WildBird | null> =>
  memo(ctx.birds, id, async () => {
    const snap = await ctx.db.collection("wildBirds").doc(id).get();
    return snap.exists ? { ...(snap.data() as WildBird), id: snap.id } : null;
  });

/** 同じ事例の、送れた（sent）知らせ。訂正かどうかを決める。 */
const sentOf = (ctx: RebuildContext, caseId: string): Promise<SentNotice[]> =>
  memo(ctx.sentBySubject, caseId, async () => {
    const snap = await ctx.db.collection("sentNotices").where("subjectId", "==", caseId).get();
    return snap.docs.map((d) => d.data() as SentNotice).filter((s) => s.state === "sent");
  });

/** その月の自己点検の記録が 1 件でもあるか。 */
export const isSelfCheckAnswered = (ctx: Pick<RebuildContext, "db" | "answered">, farmId: string, month: string): Promise<boolean> =>
  memo(ctx.answered, `${farmId}__${month}`, async () => {
    const snap = await ctx.db.collection("farms").doc(farmId).collection("checks").where("month", "==", month).limit(1).get();
    return !snap.empty;
  });

/**
 * 読む記録の事例と野鳥を先に読み、その県をすべて ensurePrefs する（prefsToLoad は否定を除くので使わない）。
 * 距離を測る前に必ず呼ぶ（呼ばないと未読み込みの県で GeoNotLoadedError になる）。
 */
export async function loadSubjects(ctx: RebuildContext, recs: readonly QueueRec[]): Promise<void> {
  const prefs = new Set<string>();
  const add = (prefCode: string, muniCode: string | null): void => {
    prefs.add(prefCode);
    if (muniCode) prefs.add(muniCode.slice(0, 2));
  };
  const caseIds = new Set<string>();
  const birdIds = new Set<string>();
  for (const r of recs) {
    if (CASE_EVENTS.has(r.data.event)) caseIds.add(r.data.subjectId);
    else if (r.data.event === "wild_bird_confirmed") birdIds.add(r.data.subjectId);
  }
  const [cases, birds] = await Promise.all([
    Promise.all([...caseIds].map((id) => caseOf(ctx, id))),
    Promise.all([...birdIds].map((id) => birdOf(ctx, id))),
  ]);
  for (const c of cases) if (c) add(c.prefCode, c.muniCode);
  for (const b of birds) if (b) add(b.prefCode, b.muniCode);
  if (prefs.size > 0) await ctx.geo.ensurePrefs([...prefs].sort());
}

const isDay = (v: unknown): v is IsoDate => {
  if (typeof v !== "string") return false;
  try {
    diffDays(v, v);
    return true;
  } catch {
    return false;
  }
};

/**
 * 記録 1 件を Notice に組み立て直す。loadSubjects を済ませてから呼ぶ。
 * 農場がない、会員でない、配信停止は drop。事例と野鳥は読み直した内容で宛先、段階、設定を計算し直す
 * （否定の訂正は planCaseNotices が決める: 先に疑い・確定が届いていれば、今 ④ でも設定を切っていても届く）。
 * 否定済みの事例の疑い・確定は drop。事例、野鳥の文書がなければ fail。
 * 期限の知らせは、記録済みの月と期限を過ぎた月を drop。基準の知らせは事例を読まず、記録の id の日付で作る。
 */
export async function rebuildNotice(ctx: RebuildContext, rec: QueueRec): Promise<Rebuilt> {
  const { farmId, uid, subjectId, event } = rec.data;
  const read = await farmOf(ctx, farmId);
  if (read.kind === "missing") return { kind: "drop" };
  if (read.kind === "unreadable") return { kind: "skip" };
  const farm = read.farm;
  if (!farm.memberUids.includes(uid) || farm.unsubscribedUids.includes(uid)) return { kind: "drop" };

  const pick = (list: readonly Notice[]): Rebuilt => {
    const n = list.find((x) => x.uid === uid);
    return n ? { kind: "send", notice: n } : { kind: "drop" };
  };

  if (CASE_EVENTS.has(event)) {
    const c = await caseOf(ctx, subjectId);
    if (c === null) return { kind: "fail" };
    if (c.confirmState === "replay") return { kind: "drop" };
    if ((event === "suspected" || event === "confirmed") && c.negation === "negated") return { kind: "drop" };
    if (event === "negated" && c.negation !== "negated") return { kind: "drop" };
    const alreadySent = (await sentOf(ctx, subjectId)).filter((s) => !(s.farmId === farmId && s.uid === uid && s.event === event));
    return pick(planCaseNotices({ event, caseDoc: c, farms: [farm], geo: ctx.geo, alreadySent }));
  }

  if (event === "wild_bird_confirmed") {
    const b = await birdOf(ctx, subjectId);
    if (b === null) return { kind: "fail" };
    return pick(wildBirdNotices({ bird: b, farms: [farm], geo: ctx.geo }));
  }

  if (event === "self_check_due") {
    if (await isSelfCheckAnswered(ctx, farmId, subjectId)) return { kind: "drop" };
    const due = (typeof farm.selfCheckDue === "object" && farm.selfCheckDue !== null ? farm.selfCheckDue : {})[subjectId];
    const date = isDay(due) ? due : null;
    if (date !== null && diffDays(ctx.today, date) > 0) return { kind: "drop" }; // 期限を過ぎた
    return { kind: "send", notice: selfCheckDueNotice(farmId, uid, subjectId, date) };
  }

  if (event === "mortality_hit") {
    const day = subjectId.slice(0, 10);
    const date = isDay(day) ? day : null; // id から日付が読めなければ、日付なしの文面にする
    return pick(mortalityNotices(farm, subjectId, day).map((n) => ({ ...n, facts: { ...n.facts, date } })));
  }

  return { kind: "fail" };
}
