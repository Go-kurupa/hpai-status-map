// 事例の純粋関数（I-08、設計書 §10.2、契約 6.3）。Firestore も時計も使わない（now は引数）。
// 読み取った発表から事例を作り、同じ事例の続報をまとめる。迷ったら別の事例にせず、呼び出し側が確認中にする。
import { diffDays, jstDateOf, toJstIso } from "./dates";
import { isCountable, isZoneActive } from "./level";
import type { NormalizedRead } from "./read/types";
import { seasonOf } from "./season";
import type {
  Case,
  CaseStage,
  ConfirmState,
  IsoDate,
  MuniCode,
  PrefCode,
  Season,
  StageDates,
  StageStamp,
} from "./types";

export type CaseMatch = { kind: "same"; caseId: string } | { kind: "new" } | { kind: "ambiguous"; candidateIds: string[] };

/** 疑いと確定は、事例の最初の日付からこの日数以内なら同じ事例（§10.2）。 */
const SAME_CASE_DAYS = 7;
/** 疑いから、続報がないまま「続報を確認中」と出すまでの日数（§10.2）。 */
const STALLED_DAYS = 3;

/** 段階の表示名。 */
export const STAGE_LABELS: Readonly<Record<CaseStage, string>> = {
  suspected: "疑い",
  confirmed: "確定",
  culling_done: "殺処分の完了",
  control_done: "防疫措置の完了",
  shipment_lifted: "搬出制限の解除",
  movement_lifted: "移動制限の解除",
  surveillance_lifted: "監視強化の解除",
};

/** 進んでいる順（後ろほど進んだ段階）。搬出と移動の両方があれば移動、監視強化があれば監視強化。 */
const STAGE_ORDER: readonly CaseStage[] = [
  "suspected",
  "confirmed",
  "culling_done",
  "control_done",
  "shipment_lifted",
  "movement_lifted",
  "surveillance_lifted",
];
const LATER_STAGES: ReadonlySet<CaseStage> = new Set(["culling_done", "control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"]);

const CONFIRM_RANK: Readonly<Record<ConfirmState, number>> = { reviewing: 0, auto: 1, national: 2, replay: 2, operator: 3 };

export function caseIdOf(muniCode: MuniCode, firstDate: IsoDate, seq: number): string {
  return `${muniCode}-${firstDate}-${seq}`;
}

/** 同じ市町村、同じ日の既存の連番の最大の次。過去の事例（h…）や別の日は数えない。 */
export function nextCaseId(muniCode: MuniCode, firstDate: IsoDate, existing: readonly Case[]): string {
  const prefix = `${muniCode}-${firstDate}-`;
  let max = 0;
  for (const c of existing) {
    if (!c.id.startsWith(prefix)) continue;
    const rest = c.id.slice(prefix.length);
    if (/^[1-9]\d*$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return caseIdOf(muniCode, firstDate, max + 1);
}

/** 確認中の事例。公開するのは県名とリンクだけ（契約 6.3）。読み取った値を入れない。 */
export function makeReviewingCase(
  input: { documentId: string; season: Season; prefCode: PrefCode; sourceUrl: string },
  now: Date,
): Case {
  return {
    id: `rev-${input.documentId}`,
    season: input.season,
    nationalNo: null,
    prefNo: null,
    prefCode: input.prefCode,
    muniCode: null,
    muniName: null,
    birdUse: null,
    housing: null,
    headCount: null,
    stages: {},
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "reviewing",
    sourceUrls: [input.sourceUrl],
    updatedAt: toJstIso(now),
  };
}

/** いちばん進んだ段階。段階がなければ null。 */
export function latestStage(c: Case): CaseStage | null {
  for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
    const stage = STAGE_ORDER[i]!;
    if (c.stages[stage] !== undefined) return stage;
  }
  return null;
}

/** 疑いの日付から数日たっても、確定などの続報がない事例。否定が確定したものは数えない。 */
function stalledDaysOf(c: Case, now: Date): number | null {
  if (c.negation === "negated") return null;
  const suspected = c.stages.suspected;
  if (suspected === undefined) return null;
  if (latestStage(c) !== "suspected") return null; // 確定など、疑いより進んだ段階があれば止まっていない
  const days = diffDays(jstDateOf(now), suspected.date);
  return days >= STALLED_DAYS ? days : null;
}

export function isStalledSuspect(c: Case, now: Date): boolean {
  return stalledDaysOf(c, now) !== null;
}

/** 一覧と詳細に出す段階の言葉（W-06）。 */
export function displayStage(c: Case, now: Date): { label: string; stalledDays: number | null } {
  if (c.confirmState === "reviewing") return { label: "確認中", stalledDays: null };
  if (c.negation === "negated") return { label: "否定されました", stalledDays: null };
  if (c.negation === "candidate") return { label: "否定の発表があるようです（確認中）", stalledDays: null };
  const stalledDays = stalledDaysOf(c, now);
  if (stalledDays !== null) return { label: `続報を確認中（${stalledDays} 日経過）`, stalledDays };
  const stage = latestStage(c);
  return { label: stage === null ? "確認中" : STAGE_LABELS[stage], stalledDays: null };
}

/** 事例の最初の日付。段階がなければ null。 */
function firstDateOf(stages: StageDates): IsoDate | null {
  let first: IsoDate | null = null;
  for (const stamp of Object.values(stages)) {
    if (stamp === undefined) continue;
    if (first === null || stamp.date < first) first = stamp.date;
  }
  return first;
}

/**
 * 読み取った発表が、既存のどの事例の続報かを決める（§10.2）。
 * 順: (1) 確認中を除き県と市町村が同じもの／(2) 国内の番号 N があれば一致で same、違う事例は外す／
 * (3) 疑い・確定・段階なしは最初の日付から 7 日以内、後の段階は同じシーズンで進行中のもの／(4) 0 件 new、1 件 same、2 件以上 ambiguous。
 */
export function matchCase(
  incoming: { prefCode: PrefCode; muniCode: MuniCode; date: IsoDate; nationalNo: number | null; stage?: CaseStage | null },
  existing: readonly Case[],
): CaseMatch {
  let candidates = existing.filter((c) => c.confirmState !== "reviewing" && c.prefCode === incoming.prefCode && c.muniCode === incoming.muniCode);

  const season = seasonOf(incoming.date);
  if (incoming.nationalNo !== null) {
    const byNo = candidates.find((c) => c.nationalNo === incoming.nationalNo && c.season === season);
    if (byNo !== undefined) return { kind: "same", caseId: byNo.id };
    candidates = candidates.filter((c) => c.nationalNo === null);
  }

  const stage = incoming.stage ?? null;
  if (stage === null || !LATER_STAGES.has(stage)) {
    candidates = candidates.filter((c) => {
      const first = firstDateOf(c.stages);
      return first !== null && Math.abs(diffDays(incoming.date, first)) <= SAME_CASE_DAYS;
    });
  } else {
    candidates = candidates.filter((c) => {
      if (c.season !== season) return false;
      const held = c.stages[stage];
      if (held !== undefined) return held.date === incoming.date && isCountable(c); // 同じ日付の再読み取り
      return stage === "surveillance_lifted" ? isCountable(c) : isZoneActive(c);
    });
  }

  if (candidates.length === 0) return { kind: "new" };
  if (candidates.length === 1) return { kind: "same", caseId: candidates[0]!.id };
  return { kind: "ambiguous", candidateIds: candidates.map((c) => c.id) };
}

/** 段階の日付と時刻を足す。同じ日付なら空いた時刻だけ埋め、日付が違えば既存を保つ。operator は上書き。 */
function mergeStamp(existing: StageStamp | undefined, incoming: StageStamp, override: boolean): StageStamp {
  if (existing === undefined) return { date: incoming.date, time: incoming.time };
  if (override) {
    if (existing.date === incoming.date && incoming.time === null) return { date: existing.date, time: existing.time };
    return { date: incoming.date, time: incoming.time };
  }
  if (existing.date === incoming.date && existing.time === null && incoming.time !== null) {
    return { date: existing.date, time: incoming.time };
  }
  return { date: existing.date, time: existing.time };
}

/** 既存を保つ欄。既存が null なら読み取りで埋める。operator は非 null で上書き。null では消さない。 */
function pick<T>(existing: T | null, incoming: T | null, override: boolean): T | null {
  if (incoming === null) return existing;
  if (existing === null || override) return incoming;
  return existing;
}

/**
 * 読み取りを事例に足して新しい Case を返す（existing は書き換えない）。
 * 新しい事例の id は連番 1。同じ市町村、同じ日に別の事例がある場合は、呼び出し側が nextCaseId で id を差し替える。
 * 確認中の事例（rev-）は existing に渡さない。渡されても新しい事例として扱う。
 */
export function applyRead(existing: Case | null, read: NormalizedRead, sourceUrl: string, confirm: ConfirmState, now: Date): Case {
  if (read.muniCode === null) throw new RangeError("市町村コードがない読み取りは事例にできません");
  const prev = existing !== null && existing.confirmState !== "reviewing" ? existing : null;
  const override = confirm === "operator";

  // 読み取りの段階（主の段階が優先）
  const incomingStages: StageDates = { ...read.stages };
  if (read.primaryStage !== null && read.primaryStamp !== null) incomingStages[read.primaryStage] = read.primaryStamp;

  const stages: StageDates = { ...(prev?.stages ?? {}) };
  for (const stage of STAGE_ORDER) {
    const stamp = incomingStages[stage];
    if (stamp === undefined) continue;
    stages[stage] = mergeStamp(stages[stage], stamp, override);
  }

  const muniCode = pick(prev?.muniCode ?? null, read.muniCode, override);
  const muniName = pick(prev?.muniName ?? null, read.muniName, override);
  if (muniCode === null || muniName === null) throw new RangeError("市町村名がない読み取りは事例にできません");

  let id: string;
  let season: Season;
  if (prev !== null) {
    id = prev.id;
    season = prev.season;
  } else {
    const first = firstDateOf(stages);
    if (first === null) throw new RangeError("日付がない読み取りは事例にできません");
    id = caseIdOf(muniCode, first, 1);
    season = seasonOf(first);
  }

  const radii = override && read.radiiKm.length > 0 ? read.radiiKm : [...(prev?.radiiKm ?? []), ...read.radiiKm];
  const radiiKm = [...new Set(radii)].sort((a, b) => a - b);

  const sourceUrls = [...(prev?.sourceUrls ?? [])];
  if (!sourceUrls.includes(sourceUrl)) sourceUrls.push(sourceUrl);

  const prevEstimates = prev?.prefEstimates ?? { shipment: null, movement: null, surveillance: null };
  const prefEstimates = {
    shipment: read.estimates.shipment ?? prevEstimates.shipment,
    movement: read.estimates.movement ?? prevEstimates.movement,
    surveillance: read.estimates.surveillance ?? prevEstimates.surveillance,
  };

  // 否定: 確定があれば候補も人の否定も退ける（確定を見逃さない）。なければ人が確定した否定（negated）は読み取りで下げない。否定の発表は candidate。
  let negation = prev?.negation ?? "none";
  let negatedAt = prev?.negatedAt ?? null;
  if (stages.confirmed !== undefined) {
    negation = "none";
    negatedAt = null;
  } else if (negation !== "negated" && read.kind === "negated") {
    negation = "candidate";
  }

  // 確かさは下がらない（reviewing < auto < national < operator）
  const confirmState = prev !== null && CONFIRM_RANK[prev.confirmState] > CONFIRM_RANK[confirm] ? prev.confirmState : confirm;

  return {
    id,
    season,
    nationalNo: pick(prev?.nationalNo ?? null, read.nationalNo, override),
    prefNo: pick(prev?.prefNo ?? null, read.prefNo, override),
    prefCode: pick(prev?.prefCode ?? null, read.prefCode, override) ?? muniCode.slice(0, 2),
    muniCode,
    muniName,
    birdUse: pick(prev?.birdUse ?? null, read.birdUse, override),
    housing: pick(prev?.housing ?? null, read.housing, override),
    headCount: pick(prev?.headCount ?? null, read.headCount, override),
    stages,
    radiiKm,
    prefEstimates,
    negation,
    negatedAt,
    confirmState,
    sourceUrls,
    updatedAt: toJstIso(now),
  };
}
