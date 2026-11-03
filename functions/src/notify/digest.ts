// 朝のまとめ（M-13、設計書 §6）。毎朝 6 時に、自己点検の期限の知らせを作って送り、②③の疑い・確定・否定・解除と野鳥を会員ごとに 1 通で送る。
// 送り直し（retryFailed.ts）も同じ deliverQueued を使う。ログに出すのは件数とエラーの code だけ（宛先やエラーの文面は出さない）。
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { renderMorningDigest, renderNotice, selfCheckDueNotices, type Notice, type NoticeEvent, type SentNotice } from "@hpai/shared/notices";
import type { Farm } from "@hpai/shared/types";
import { codeOf, dispatchNotices, isMailStopError, markSent, noteMailStop, unsubscribeUrlFor, type NotifyDeps } from "./dispatch";
import { createRebuildContext, isSelfCheckAnswered, loadSubjects, rebuildNotice, type QueueRec } from "./rebuild";

/** 送ってから「すぐ」の知らせを拾うまでの待ち（分）。onCaseWritten が送っている間に拾わない。 */
const STALE_IMMEDIATE_MINUTES = 10;
/** 1 回の実行で使う時間（ミリ秒）。540 秒で打ち切られる前に止める（残りは次の実行が拾う）。 */
const BUDGET_MS = 480_000;

const EVENTS: ReadonlySet<string> = new Set<NoticeEvent>([
  "suspected", "confirmed", "reviewing", "negated", "shipment_lifted", "movement_lifted", "wild_bird_confirmed", "self_check_due", "mortality_hit",
]);

/** 形の壊れた記録は読まない。 */
function asRec(ref: DocumentReference, id: string, data: unknown): QueueRec | null {
  const d = data as Partial<SentNotice> | undefined;
  if (!d || typeof d.farmId !== "string" || typeof d.uid !== "string" || typeof d.subjectId !== "string") return null;
  if (typeof d.event !== "string" || !EVENTS.has(d.event)) return null;
  if (d.state !== "queued" && d.state !== "failed") return null;
  return { ref, id, data: d as SentNotice };
}

/**
 * 送る候補の記録。failed のすべて、10 分以上前の queued の immediate、includeMorning なら queued の morning。
 * 問い合わせの形は索引（state、timing、queuedAt）に合わせる。id の順に並べる。
 */
export async function readQueue(db: Firestore, now: Date, includeMorning: boolean): Promise<QueueRec[]> {
  const cutoff = toJstIso(new Date(now.getTime() - STALE_IMMEDIATE_MINUTES * 60_000));
  const col = db.collection("sentNotices");
  const snaps = await Promise.all([
    col.where("state", "==", "failed").get(),
    col.where("state", "==", "queued").where("timing", "==", "immediate").where("queuedAt", "<", cutoff).get(),
    ...(includeMorning ? [col.where("state", "==", "queued").where("timing", "==", "morning").get()] : []),
  ]);
  const byId = new Map<string, QueueRec>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const rec = asRec(d.ref, d.id, d.data());
      if (rec) byId.set(d.id, rec);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface DeliverResult {
  sent: number;
  failed: number;
  dropped: number;
  skipped: number;
  mailStopped: boolean;
}

async function tryUpdate(label: string, op: () => Promise<unknown>): Promise<boolean> {
  try {
    await op();
    return true;
  } catch (e) {
    console.error(`[notify] 記録の更新に失敗しました（${label}）`, { code: codeOf(e) });
    return false;
  }
}

const markFailed = (rec: QueueRec): Promise<boolean> =>
  rec.data.state === "failed" ? Promise.resolve(true) : tryUpdate("failed", () => rec.ref.update({ state: "failed" }));

/**
 * 記録を Notice に組み立て直し、会員（農場と uid の組）ごとに 1 通で送る。1 件ならその知らせの文面、2 件以上なら朝のまとめ。
 * - 送らないと決めた記録（停止、会員でない、否定済み、設定が切れた）は消す。元の事例、野鳥がなければ failed。
 * - 送る直前に記録を読み直し、読んだときの状態のままの分だけ送る（他の実行が送った分を二度送らない）。
 * - 認証、上限、一時的な制限、通信のエラー（isMailStopError）が出たら、残りに送らず noteMailStop。failRestOnStop なら、
 *   残りの queued も failed にして次の送り直しに回す。failed への更新が投げても noteMailStop は呼ぶ。
 * - 宛先の不備はその会員だけの失敗（failed）で、残りには送り続ける。
 */
export async function deliverQueued(deps: NotifyDeps, geo: GeoStore, recs: readonly QueueRec[], opts: { failRestOnStop: boolean }): Promise<DeliverResult> {
  const result: DeliverResult = { sent: 0, failed: 0, dropped: 0, skipped: 0, mailStopped: false };
  const startedAt = Date.now();
  const ctx = createRebuildContext(deps.db, geo, jstDateOf(deps.now()));
  await loadSubjects(ctx, recs);

  // 1) 組み立て直す。記録 1 件の失敗は、その記録だけ飛ばす（全体を止めない）
  const groups = new Map<string, { notices: Notice[]; recs: QueueRec[] }>();
  let rebuildErrors = 0;
  for (const rec of recs) {
    try {
      const r = await rebuildNotice(ctx, rec);
      if (r.kind === "drop") {
        if (await tryUpdate("delete", () => rec.ref.delete())) result.dropped += 1;
      } else if (r.kind === "fail") {
        if (await markFailed(rec)) result.failed += 1;
      } else if (r.kind === "skip") {
        result.skipped += 1;
      } else {
        const key = `${rec.data.farmId}__${rec.data.uid}`;
        const g = groups.get(key) ?? { notices: [], recs: [] };
        g.notices.push(r.notice);
        g.recs.push(rec);
        groups.set(key, g);
      }
    } catch (e) {
      rebuildErrors += 1;
      result.skipped += 1;
      console.error("[notify] 知らせを組み立て直せませんでした", { code: codeOf(e) });
    }
  }

  // 2) 会員ごとに 1 通
  const emails = new Map<string, Promise<string | null>>();
  const emailOf = (uid: string): Promise<string | null> => {
    let p = emails.get(uid);
    if (!p) {
      p = deps.emailOf(uid).catch((e: unknown) => {
        console.error("[notify] 宛先を取れませんでした", { code: codeOf(e) });
        return null;
      });
      emails.set(uid, p);
    }
    return p;
  };

  const list = [...groups.values()];
  for (let i = 0; i < list.length; i += 1) {
    if (Date.now() - startedAt > BUDGET_MS) {
      console.error("[notify] 時間の上限に近いので止めます。残りは次の実行が送ります", { remaining: list.length - i });
      result.skipped += list.slice(i).reduce((n, g) => n + g.recs.length, 0);
      break;
    }
    const group = list[i]!;
    try {
      // 送る直前に読み直す: 読んだときの状態のままの記録だけ
      const snaps = await deps.db.getAll(...group.recs.map((r) => r.ref));
      const keep = group.recs.map((r, n) => snaps[n]!.exists && (snaps[n]!.data() as { state?: unknown }).state === r.data.state);
      const recsNow = group.recs.filter((_, n) => keep[n]);
      const notices = group.notices.filter((_, n) => keep[n]);
      if (recsNow.length === 0) continue;

      const email = await emailOf(group.recs[0]!.data.uid);
      if (email === null || email === "") {
        for (const r of recsNow) if (await markFailed(r)) result.failed += 1;
        continue;
      }

      let stop: ReturnType<typeof isMailStopError> = null;
      let sendFailed = false;
      try {
        const first = notices[0]!;
        const ctxRender = { unsubscribeUrl: unsubscribeUrlFor(first, deps), appUrl: deps.appUrl };
        const mail = notices.length === 1 ? renderNotice(first, ctxRender) : renderMorningDigest(notices, ctxRender);
        await deps.mailer(email, mail);
      } catch (e) {
        sendFailed = true;
        stop = isMailStopError(e);
        console.error("[notify] 送信に失敗しました", { code: codeOf(e), stop });
      }

      if (!sendFailed) {
        const at = toJstIso(deps.now());
        for (const r of recsNow) {
          // 送れたのに記録に残せないと、次の実行が二度送る。失敗は件数に残す
          if (await tryUpdate("sent", () => markSent(r.ref, at))) result.sent += 1;
          else result.failed += 1;
        }
        continue;
      }

      try {
        for (const r of recsNow) if (await markFailed(r)) result.failed += 1;
      } finally {
        if (stop !== null) {
          result.mailStopped = true;
          await noteMailStop(deps); // failed への更新が投げても、運営者の画面には出す
        }
      }
      if (stop !== null) {
        if (opts.failRestOnStop) {
          for (const g of list.slice(i + 1)) for (const r of g.recs) if (await markFailed(r)) result.failed += 1;
        }
        break;
      }
    } catch (e) {
      // 記録の読み書きの失敗。この会員だけ飛ばす（次の実行が拾う）
      result.skipped += group.recs.length;
      console.error("[notify] この会員への送信を飛ばしました", { code: codeOf(e) });
    }
  }

  console.log("[notify] 送信の結果", { ...result, rebuildErrors });
  return result;
}

/** 全農場の自己点検の期限の知らせ。点検が記録済みの月は除く。1 つの農場の失敗で他を止めない。 */
async function planSelfCheck(db: Firestore, today: string): Promise<Notice[]> {
  const farms = await db.collection("farms").get();
  const notices: Notice[] = [];
  let errors = 0;
  const ctx = { db, answered: new Map<string, Promise<boolean>>() };
  for (const d of farms.docs) {
    try {
      const farm = { id: d.id, ...(d.data() as Farm) };
      const candidates = selfCheckDueNotices(farm, today, []);
      if (candidates.length === 0) continue;
      const answered: string[] = [];
      for (const month of new Set(candidates.map((n) => n.subjectId))) {
        if (await isSelfCheckAnswered(ctx, d.id, month)) answered.push(month);
      }
      notices.push(...selfCheckDueNotices(farm, today, answered));
    } catch (e) {
      errors += 1;
      console.error("[notify] この農場の期限の知らせを作れませんでした", { code: codeOf(e) });
    }
  }
  if (errors > 0) console.error("[notify] 期限の知らせを作れなかった農場があります", { count: errors });
  return notices;
}

/**
 * 朝 6 時の実行。(1) 自己点検の期限の知らせを送る → (2) 朝の queued、failed、10 分以上の queued の immediate を読んで送る。
 * (1) で送信が止まったら (2) は送らず、読んだ記録を failed にして次の送り直しに回す。
 */
export async function runMorningDigest(deps: NotifyDeps, geo: GeoStore): Promise<void> {
  const now = deps.now();
  let stopped = false;
  try {
    const due = await planSelfCheck(deps.db, jstDateOf(now));
    if (due.length > 0) stopped = (await dispatchNotices(deps, due)).mailStopped;
  } catch (e) {
    console.error("[notify] 期限の知らせを送れませんでした", { code: codeOf(e) });
  }

  const recs = await readQueue(deps.db, now, true);
  if (stopped) {
    try {
      for (const r of recs) await markFailed(r);
    } finally {
      await noteMailStop(deps);
    }
    console.log("[notify] 送信が止まっているので、朝のまとめは送りませんでした", { count: recs.length });
    return;
  }
  await deliverQueued(deps, geo, recs, { failRestOnStop: true });
}
