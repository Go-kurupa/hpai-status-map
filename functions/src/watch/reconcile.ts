// 国との突き合わせ（I-18、設計書 §9.7）。6 時間ごとに、国の報道発表の一覧と作品の事例を比べ、取りこぼしと食い違いを運営者の箱に入れる。
// 順: 国の一覧を取得 → 本文を読んだことのない発表だけ取得して事実を控える → 欠けた確定を国の情報で載せる → 解除の再適用 → 国にない確定
//    → 疑いのまま止まった事例 → 見回り全体の停止 → reading の取り残し → 確認中の見直し。メールは reconcileAndNotify が最後に送る。
// 直さない原則: 否定された事例と国の確定の食い違いは自動で直さず、運営者の確認に回す。事例は消さない。
import { logger } from "firebase-functions";
import { displayStage, isStalledSuspect } from "@hpai/shared/cases";
import { diffDays, toJstIso } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { filterMaffItems, maffPressUrl } from "@hpai/shared/read/maff";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import {
  appOnlyConfirmed,
  liftGaps,
  missingNationalNos,
  nationalConfirmedNos,
  nationalListUrls,
  parseNationalFact,
  type NationalFact,
  type NationalLiftFact,
} from "@hpai/shared/read/reconcile";
import type { DocumentRecord } from "@hpai/shared/read/types";
import { currentSeason, seasonOf } from "@hpai/shared/season";
import { normalizeForMatch } from "@hpai/shared/text";
import type { Case, IsoDateTime, PrefCode, Source, WatchStatus } from "@hpai/shared/types";
import { bucket, db } from "../admin";
import { reviewPlan } from "../read/apply";
import { dismissNotPoultry } from "../read/dismiss";
import { upsertCaseIn } from "../read/upsert";
import { notifyOperator, type NotifyDeps } from "../review/notifyOperator";
import { enqueueReview, reviewAlertId, type NewReviewItem } from "../review/queue";
import type { WatchDeps } from "./deps";
import { decodeBody, extractHtml, sha256Hex } from "./extract";
import { allowMaff, applyNationalConfirmed, applyNationalLift, loadIndex } from "./maff";
import { missingItemOf } from "./record";
import { watchFailingItem } from "./status";

/** 1 回の実行で本文を取得する上限（初回は国の発表が 70 本近い。残りは次の回に回し、その回は国にない確定を比べない）。 */
export const MAX_FACT_FETCHES = 80;
/** 本文を取れない発表を、読めないものとして扱うまでの失敗の回数。 */
export const MAX_FETCH_FAILURES = 3;
/** 見回り全体が止まったとみなす、確認の古さ。 */
export const STALE_CHECK_MS = 24 * 60 * 60 * 1000;
/** reading のまま取り残された文書とみなす時間（読み取りの上限は 540 秒）。 */
export const READING_STUCK_MS = 30 * 60 * 1000;
/**
 * 国の確定を作品に載せてから、取りこぼしの警告を出すまでの猶予。国の入口の見回りは 3 時間に 1 回なので、その間隔 + 余裕 1 時間。
 * 見回りが先に載せる順番の競合で、余計な警告とメールを出さない。事例はすぐ載せる（表示は遅らせない）。
 */
export const MISSING_GRACE_MS = 4 * 60 * 60 * 1000;

const FACTS_PATH = "state/maff/national-facts.json";

// ── 控えた国の事実（Storage の state/maff/national-facts.json） ──
// 発表の URL → 本文から読んだ事実と、この関数での扱い。national-index.json（見回りが書く）とは別のファイルにする
// （見回りが index を保存し直すときに消されない。この関数だけが書く）。

interface Entry {
  type: "confirmed" | "movement_lifted";
  title: string;
  /** 初めて見た時刻。 */
  seenAt: IsoDateTime;
  /** 読んだ事実。読めなかった発表は null（確認済みの印。毎回取り直さない）。 */
  fact: NationalFact | null;
  /** 読めない発表を運営者の箱に入れた。 */
  warned?: boolean;
  /** 作品になかったので、この関数が載せた時刻。 */
  appliedAt?: IsoDateTime;
  /** 取りこぼしの警告の判断が済んだ（出した、または見回りが先に載せていた）。 */
  settled?: boolean;
}

interface FactsFile {
  entries: Record<string, Entry>;
  /** 本文を取れなかった回数（URL ごと）。 */
  failures: Record<string, number>;
}

async function loadFacts(): Promise<FactsFile> {
  const file = bucket().file(FACTS_PATH);
  const [exists] = await file.exists();
  if (!exists) return { entries: {}, failures: {} };
  try {
    const parsed = JSON.parse((await file.download())[0].toString("utf8")) as Partial<FactsFile> & { facts?: Record<string, NationalFact> };
    if (typeof parsed.entries === "object" && parsed.entries !== null) {
      return { entries: parsed.entries, failures: typeof parsed.failures === "object" && parsed.failures !== null ? parsed.failures : {} };
    }
    // 最初の形式（事実だけ）。猶予は済んだものとして読む
    if (typeof parsed.facts === "object" && parsed.facts !== null) {
      const entries: Record<string, Entry> = {};
      for (const [url, fact] of Object.entries(parsed.facts)) entries[url] = { type: fact.type, title: fact.title, seenAt: "1970-01-01T09:00:00+09:00", fact, settled: true };
      return { entries, failures: {} };
    }
    return { entries: {}, failures: {} };
  } catch {
    return { entries: {}, failures: {} }; // 壊れていたら読み直す（本文をもう一度取るだけ）
  }
}

async function saveFacts(f: FactsFile): Promise<void> {
  await bucket().file(FACTS_PATH).save(JSON.stringify(f), { contentType: "application/json", resumable: false });
}

// ── 国の一覧の取得 ──

interface Listing {
  /** 全部の一覧を取得できた（1 つでも失敗したら false。その回は比べない）。 */
  ok: boolean;
  items: ReturnType<typeof filterMaffItems>;
}

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** ログに出すのは種類だけ（送信の例外の文言に宛先が入ることがある）。 */
const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown; responseCode?: unknown } | null) ?? {};
  return String(c.code ?? c.responseCode ?? (e instanceof Error ? e.name : "unknown"));
};

/** 報道発表の個別のページへのリンクか（一覧の index.html は除く）。 */
const isPressArticle = (href: string): boolean => {
  const url = maffPressUrl(href);
  return url !== null && !new URL(url).pathname.endsWith("/index.html");
};

async function fetchLists(deps: WatchDeps): Promise<Listing> {
  const items: Listing["items"] = [];
  const seen = new Set<string>();
  for (const url of nationalListUrls(deps.now())) {
    const o = await deps.fetch(url, { allowUrl: allowMaff });
    if (o.kind !== "ok") {
      logger.warn("国の一覧を取得できないので、今回は比べません", { url, kind: o.kind });
      return { ok: false, items: [] };
    }
    const page = extractHtml(decodeBody(o.body, o.contentType), o.finalUrl);
    // 200 でも発表のリンクが 1 本もなければ「発表なし」ではなく別物のページ（メンテナンスなど）。比べると全部が「国にない」になる
    if (!page.links.some((l) => isPressArticle(l.href))) {
      logger.warn("国の一覧が想定と違うので、今回は比べません", { url });
      return { ok: false, items: [] };
    }
    for (const item of filterMaffItems(page.links)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  return { ok: true, items };
}

// ── 比べる ──

const readCases = async (season: number): Promise<Case[]> => (await db.collection("cases").where("season", "==", season).get()).docs.map((d) => d.data() as Case);

const REASON_LABEL: Record<string, string> = {
  muni_not_found: "市町村を地図の区画から見つけられません",
  ambiguous_case: "同じ事例の候補を決められません",
  number_conflict: "同じ番号の事例が別の市町村にあります",
};

/** 事例の最初の日付が、日付から 7 日以内か（matchCase と同じ幅）。 */
function startsNear(c: Case, date: string): boolean {
  const dates = Object.values(c.stages).map((x) => x.date);
  return dates.length > 0 && Math.abs(diffDays(dates.sort()[0]!, date)) <= 7;
}

type ConfirmedFact = Extract<NationalFact, { type: "confirmed" }>;

const describeConfirmed = (f: ConfirmedFact): string => `国の発表（${f.date}、${f.muniName}、国内${f.nationalNo}例目）`;

/** 国の確定が作品にない（national_missing）。id は季節と番号で 1 件だけ。 */
function confirmedMissingItem(f: ConfirmedFact, message: string, caseId: string | null): NewReviewItem {
  return {
    id: reviewAlertId("national_missing", `confirmed-${seasonOf(f.date)}-${f.nationalNo}`),
    kind: "alert",
    alert: "national_missing",
    prefCode: f.prefCode,
    caseId,
    message: `${message} ${f.url}`,
  };
}

/** 読めない国の発表（national_missing）。URL ごとに 1 件。 */
function unreadableItem(url: string, e: Entry): NewReviewItem {
  const what = e.type === "confirmed" ? "国にない確定の比較に番号が使えません" : "移動制限の解除を事例に反映できません";
  return {
    id: reviewAlertId("national_missing", `unreadable-${sha256Hex(url).slice(0, 16)}`),
    kind: "alert",
    alert: "national_missing",
    prefCode: null,
    caseId: null,
    message: `国の発表を読めないため、${what}（${e.title}）。内容を確かめ、必要なら事例を直してください。この発表は取り直しません。 ${url}`,
  };
}

export interface ReconcileReport {
  /** 国の一覧を全部取得できて、比べた。 */
  compared: boolean;
  /** 国にない確定を比べた（本文の控えが揃っていた）。 */
  comparedAppOnly: boolean;
  factsFetched: number;
  appliedConfirmed: number[];
  reappliedLifts: string[];
  queued: number;
  stuckReading: string[];
  /** その県の家きんの発生ではないと二人が読んだ確認中を、人の確認から外した文書の id（設定が入: 捨てて箱から出した。切: 公開の札を外し非公開に下げた）。 */
  notPoultry: { discarded: string[]; lowered: string[] };
}

/** 見回り全体が止まったか。確認の時刻が読めない、24 時間より古い、未来、のどれか。 */
export function isWatchStale(s: Pick<WatchStatus, "checkedAt">, now: Date): boolean {
  if (s.checkedAt === null) return true;
  const t = Date.parse(s.checkedAt);
  return !Number.isFinite(t) || t > now.getTime() || now.getTime() - t > STALE_CHECK_MS;
}

/**
 * 見回り全体の停止の知らせ。id は I-02 の watchFailingItem に合わせる（同じ失敗の期間は 1 件だけ）。
 * 失敗の最初の時刻が分かれば（failingSince）そのまま、なければ最後の確認の時刻（checkedAt、lastOkAt）から。
 * どれもなければ（見回りが一度も動いていない）県ごとに固定の id。now は id に使わない（6 時間ごとに増えない）。
 */
export function stalledWatchItem(s: WatchStatus, now: Date): NewReviewItem {
  const since = s.failingSince ?? s.checkedAt ?? s.lastOkAt;
  if (since !== null) {
    const item = watchFailingItem({ ...s, ok: false, failingSince: since }, now);
    if (item !== null) return item;
  }
  const name = PREFS.find((p) => p.code === s.prefCode)?.name ?? s.prefCode;
  return {
    id: reviewAlertId("watch_failing", `${s.prefCode}-none`),
    kind: "alert",
    alert: "watch_failing",
    prefCode: s.prefCode,
    caseId: null,
    message: `${name}の見回りの記録がありません。見回りが一度も動いていない可能性があります。入口の設定と見回りの動作を確かめてください。`,
  };
}

/** 文書の本文（raw/{id}.txt）。読めなければ空。 */
async function bodyOf(id: string): Promise<string> {
  try {
    return (await bucket().file(`raw/${id}.txt`).download())[0].toString("utf8");
  } catch {
    return "";
  }
}

/**
 * 突き合わせの本体。途中の段が失敗しても残りは続け、最後にまとめて throw する（失敗を黙って捨てない）。
 * 国の一覧が 1 つでも取得できなければ、国との比較は全部飛ばす（疑いのまま止まった事例、見回りの停止、reading の取り残しは行う）。
 */
export async function runReconcile(deps: WatchDeps): Promise<ReconcileReport> {
  const now = deps.now();
  const season = currentSeason(now);
  const errors: unknown[] = [];
  const report: ReconcileReport = { compared: false, comparedAppOnly: false, factsFetched: 0, appliedConfirmed: [], reappliedLifts: [], queued: 0, stuckReading: [], notPoultry: { discarded: [], lowered: [] } };

  /** 箱に入れる。入れられた（すでにあった場合を含む）なら true、失敗したら false。 */
  const enqueue = async (item: NewReviewItem): Promise<boolean> => {
    try {
      if (await enqueueReview(item, now)) report.queued += 1;
      return true;
    } catch (e) {
      errors.push(e);
      logger.error("運営者の箱に入れられませんでした", { id: item.id, message: errMessage(e) });
      return false;
    }
  };
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      errors.push(e);
      logger.error("突き合わせの段が失敗しました", { step: name, message: errMessage(e) });
    }
  };

  // 1. 国との比較
  await step("国との比較", () => compareWithNational(deps, season, now, report, enqueue));

  // 2. 疑いのまま止まった事例（3 日。事例は消さない）
  await step("止まった事例", async () => {
    for (const c of await readCases(season)) {
      if (c.confirmState === "reviewing" || !isStalledSuspect(c, now)) continue;
      const days = displayStage(c, now).stalledDays;
      await enqueue({
        id: reviewAlertId("case_stalled", c.id),
        kind: "alert",
        alert: "case_stalled",
        prefCode: c.prefCode,
        caseId: c.id,
        message: `${c.muniName ?? c.prefCode}の疑い（${c.stages.suspected?.date ?? "日付不明"}）から${days ?? 3}日以上、確定などの続報がありません。県の発表を確かめてください。事例は消していません。`,
      });
    }
  });

  // 3. 見回り全体の停止（watchTick が動かず、県の確認が 24 時間より古い）
  await step("見回りの停止", async () => {
    const [sources, statuses] = await Promise.all([
      db.collection("sources").get().then((s) => s.docs.map((d) => d.data() as Source)),
      db.collection("watchStatus").get().then((s) => s.docs.map((d) => d.data() as WatchStatus)),
    ]);
    const byPref = new Map(statuses.map((s) => [s.prefCode, s]));
    // 有効な入口が 1 つもない県は、見回りの失敗ではない（I-02 の recordTick と同じ扱い）
    const watched = new Set(sources.filter((s) => s.enabled && s.prefCode !== null).map((s) => s.prefCode as PrefCode));
    for (const prefCode of [...watched].sort()) {
      const s: WatchStatus = byPref.get(prefCode) ?? { prefCode, checkedAt: null, ok: false, lastOkAt: null, failingSince: null };
      if (isWatchStale(s, now)) await enqueue(stalledWatchItem(s, now));
    }
  });

  // 4. reading のまま取り残された文書（540 秒の打ち切りなどで、retry:false のため誰も拾わない）
  //    題か本文に発生を示す語があれば公開の確認中（review_public）、なければ review_private（設計書 §9.6。発生を隠さない）
  await step("reading の取り残し", async () => {
    const snap = await db.collection("documents").where("readState", "==", "reading").get();
    for (const d of snap.docs) {
      if (now.getTime() - d.updateTime.toDate().getTime() < READING_STUCK_MS) continue;
      const rec = d.data() as DocumentRecord;
      const outbreak = hasOutbreakWords(`${rec.title}\n${await bodyOf(rec.id)}`);
      const plan = reviewPlan(rec, null, outbreak ? "review_public" : "review_private", ["reading_stalled"], now);
      // 箱に入れてから文書の状態を変える（逆だと、箱に入れる前に失敗したとき、文書が誰にも見られなくなる）
      let queued = true;
      for (const item of plan.reviews) queued = (await enqueue(item)) && queued;
      if (!queued) continue;
      const moved = await db.runTransaction(async (tx) => {
        const cur = await tx.get(d.ref);
        if (cur.data()?.readState !== "reading" || now.getTime() - cur.updateTime!.toDate().getTime() < READING_STUCK_MS) return false;
        for (const c of plan.cases) upsertCaseIn(tx, c);
        tx.update(d.ref, { readState: plan.readState, error: "reading_stalled", reasons: plan.reasons });
        return true;
      });
      if (moved) report.stuckReading.push(rec.id);
    }
  });

  // 5. 確認中の見直し。その県の家きんの発生・疑いでないことがはっきりしたものを人の確認から外す（§9.6）。
  //    読み取りの判断と同じ条件を、保存した二人の読みと本文に当てる（Claude は呼ばない）。迷うものは残す。記録は消さない
  await step("確認中の見直し", async () => {
    const r = await dismissNotPoultry(now);
    report.notPoultry.discarded.push(...r.discarded);
    report.notPoultry.lowered.push(...r.lowered);
    if (r.errors.length > 0) throw new AggregateError(r.errors, "確認中の見直しに失敗した文書があります");
  });

  if (errors.length > 0) throw new AggregateError(errors, "国との突き合わせに失敗した段があります");
  return report;
}

async function compareWithNational(
  deps: WatchDeps,
  season: number,
  now: Date,
  report: ReconcileReport,
  enqueue: (item: NewReviewItem) => Promise<boolean>,
): Promise<void> {
  const listing = await fetchLists(deps);
  if (!listing.ok) return;
  report.compared = true;
  const nowIso = toJstIso(now);

  // 本文を読んだことのない発表だけ取得して、事実を控える。読めない発表は確認済みの印を付け、毎回取り直さない
  const file = await loadFacts();
  const entries = file.entries;
  let complete = true;
  let changed = false;
  for (const item of listing.items) {
    if (entries[item.url] !== undefined) continue;
    if (report.factsFetched >= MAX_FACT_FETCHES) {
      complete = false;
      break;
    }
    report.factsFetched += 1;
    const o = await deps.fetch(item.url, { allowUrl: allowMaff });
    let fact: NationalFact | null = null;
    if (o.kind === "ok") {
      fact = parseNationalFact(item, extractHtml(decodeBody(o.body, o.contentType), o.finalUrl).text);
      if (fact === null) logger.warn("国の発表の定型文を読めません", { url: item.url });
    } else {
      const n = (file.failures[item.url] ?? 0) + 1;
      file.failures[item.url] = n;
      changed = true;
      logger.warn("国の発表の本文を取得できません", { url: item.url, kind: o.kind, failures: n });
      if (n < MAX_FETCH_FAILURES) {
        if (item.type === "confirmed") complete = false; // 番号の集合が欠けるので、今回は国にない確定を比べない（次の回に取り直す）
        continue;
      }
    }
    entries[item.url] = { type: item.type, title: item.title, seenAt: nowIso, fact };
    changed = true;
  }

  // 読めない発表は運営者に 1 回知らせる（警告が箱に入るまで毎回試す）。読めた分の比較は続ける
  for (const [url, e] of Object.entries(entries)) {
    if (e.fact !== null || e.warned === true) continue;
    if (await enqueue(unreadableItem(url, e))) {
      e.warned = true;
      changed = true;
    }
  }
  if (changed) await saveFacts(file);

  const readable = Object.values(entries).flatMap((e) => (e.fact === null ? [] : [e.fact]));
  const nationalNos = nationalConfirmedNos(readable, season);
  // 読めない確定の発表でも、題に番号があればその番号は国にある（国にない確定の誤りを減らす）
  for (const e of Object.values(entries)) {
    if (e.fact !== null || e.type !== "confirmed") continue;
    const m = /国内(\d+)例目/.exec(normalizeForMatch(e.title));
    if (m !== null) nationalNos.add(Number(m[1]));
  }
  let cases = await readCases(season);
  let index: Awaited<ReturnType<typeof loadIndex>> | null = null;

  // 国にあって作品にない確定を、国の情報で載せる（事例はすぐ載せる。取りこぼしの警告は猶予の後）
  for (const no of missingNationalNos(nationalNos, cases, season)) {
    const hit = Object.values(entries).find((e) => e.fact?.type === "confirmed" && e.fact.nationalNo === no && seasonOf(e.fact.date) === season);
    const f = hit?.fact as ConfirmedFact | undefined;
    if (hit === undefined || f === undefined) continue;
    const wantName = normalizeForMatch(f.muniName);
    // 否定された（または否定の発表がある）事例と食い違うときは、自動で直さない（人の判断が要るので猶予なしで知らせる）
    const conflicting = cases.find(
      (c) =>
        c.confirmState !== "reviewing" &&
        c.prefCode === f.prefCode &&
        c.negation !== "none" &&
        (c.nationalNo === no || (normalizeForMatch(c.muniName ?? "") === wantName && startsNear(c, f.date))),
    );
    if (conflicting !== undefined) {
      await enqueue(confirmedMissingItem(f, `${describeConfirmed(f)}は確定ですが、作品では否定された（または否定の発表がある）ままの事例があります。自動では直していません。どちらが正しいか確かめてください。`, conflicting.id));
      continue;
    }
    const r = await applyNationalConfirmed(
      { parsed: { prefCode: f.prefCode, muniName: f.muniName, nationalNo: f.nationalNo, date: f.date }, farm: { headCount: f.headCount, birdUse: f.birdUse }, url: f.url },
      deps,
    );
    if (r.outcome === "review") {
      await enqueue(confirmedMissingItem(f, `${describeConfirmed(f)}が作品にありませんが、事例にできませんでした（${REASON_LABEL[r.reason ?? ""] ?? "理由不明"}）。事例を確かめて載せてください。`, null));
    } else {
      report.appliedConfirmed.push(no);
      // 載せたことを 1 件ごとに保存する（後の件が例外で落ちても、取りこぼしの警告の元を失わない）
      if (hit.appliedAt === undefined) hit.appliedAt = nowIso;
      index ??= await loadIndex();
      if (index.processed[f.url] !== undefined) {
        // 見回りが処理済みの印を付けたのに事例がなかった（データの欠落）。猶予なしで知らせる
        if (await enqueue(confirmedMissingItem(f, `${describeConfirmed(f)}は見回りが処理済みの印を付けていましたが、作品に事例がありませんでした。国の情報で確定として載せ直しました。データの欠落がないか確かめてください。`, r.caseId))) hit.settled = true;
      }
      await saveFacts(file);
      changed = false;
    }
  }

  // 載せた確定の取りこぼしの警告。見回りが先に載せていれば（national-index.json に印がある）出さない。猶予は初めて見てから 4 時間
  for (const [url, e] of Object.entries(entries)) {
    const f = e.fact;
    if (e.appliedAt === undefined || e.settled === true || f === null || f.type !== "confirmed") continue;
    if (now.getTime() - Date.parse(e.seenAt) < MISSING_GRACE_MS) continue;
    index ??= await loadIndex();
    if (index.processed[url] === undefined) {
      const caseId = cases.find((c) => c.nationalNo === f.nationalNo && c.season === season)?.id ?? null;
      if (!(await enqueue(confirmedMissingItem(f, `${describeConfirmed(f)}が作品にありませんでした。見回りが4時間以上取りこぼしたため、国の情報で確定として載せています。内容を確かめてください。`, caseId)))) continue;
    }
    e.settled = true;
    changed = true;
  }
  if (changed) await saveFacts(file);

  // 解除も同様: 事例ができる前に来た解除と、取りこぼした解除を、事例が揃ってから当て直す。
  // 当てるのは今季・同じ県・同じ市町村の事例だけ（前季の同じ番号の事例に付けない）。否定された（または否定の発表がある）事例は自動で直さない
  cases = await readCases(season);
  const lifts = readable.filter((x): x is NationalLiftFact => x.type === "movement_lifted");
  for (const gap of liftGaps(lifts, cases, season)) {
    const wantName = normalizeForMatch(gap.muniName);
    const kept: number[] = [];
    const absent: number[] = [];
    for (const no of gap.nationalNos) {
      const mine = cases.find(
        (c) => c.nationalNo === no && c.confirmState !== "reviewing" && c.prefCode === gap.prefCode && normalizeForMatch(c.muniName ?? "") === wantName,
      );
      if (mine === undefined) absent.push(no);
      else if (mine.negation === "none") kept.push(no);
    }
    if (kept.length > 0) {
      const r = await applyNationalLift({ lift: { ...gap, nationalNos: kept }, url: gap.url }, deps);
      report.reappliedLifts.push(gap.url);
      absent.push(...r.missing);
    }
    if (absent.length > 0) {
      await enqueue(missingItemOf({ url: gap.url, prefCode: gap.prefCode, muniName: gap.muniName, nationalNos: absent, date: gap.date }));
    }
  }

  // 作品にあって国にない確定（48 時間）。本文を全部読めたときだけ。事例は消さない
  if (!complete) return;
  report.comparedAppOnly = true;
  cases = await readCases(season); // 上で番号が付いた事例を、国にない確定に数えない
  for (const c of appOnlyConfirmed(cases, nationalNos, season, now)) {
    const at = c.stages.confirmed;
    await enqueue({
      id: reviewAlertId("app_only_confirmed", c.id),
      kind: "alert",
      alert: "app_only_confirmed",
      prefCode: c.prefCode,
      caseId: c.id,
      message: `${c.muniName ?? c.prefCode}の確定（${at?.date ?? "日付不明"}）は、国の報道発表の一覧に見当たりません（48 時間以上）。表示は保っています。県と国の発表を確かめてください。`,
    });
  }
}

/**
 * 突き合わせの後に、運営者へ 1 通知らせる。突き合わせが失敗しても、箱に入れたものは知らせる。
 * どちらかが失敗したら、両方を投げる（メールの失敗で箱の入れ漏れを、箱の失敗でメールを、隠さない）。
 */
export async function reconcileAndNotify(deps: WatchDeps, notify: NotifyDeps): Promise<ReconcileReport> {
  const errors: unknown[] = [];
  let report: ReconcileReport | null = null;
  try {
    report = await runReconcile(deps);
  } catch (e) {
    errors.push(e);
  }
  try {
    await notifyOperator(notify);
  } catch (e) {
    errors.push(e);
    logger.error("運営者へのメールを送れませんでした", { code: errCode(e) });
  }
  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "突き合わせとメールの両方が失敗しました");
  return report!;
}
