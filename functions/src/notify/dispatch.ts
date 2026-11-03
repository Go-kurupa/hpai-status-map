// 知らせを送る（M-02）。記録（sentNotices）を先に create() して重複を止め、すぐの分だけ送る。朝の分は queued のまま（M-13 が送る）。
// 本物のメールは試験で送らない: mailer は引数で受ける。Secret は呼び出し側が handler の中で読んで渡す。
// ログに出すのは件数と、エラーの code だけ。宛先のメールアドレスや、エラーの文面（宛先を含みうる）は出さない。
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import { noticeDocId, renderNotice, type Notice, type SentNotice } from "@hpai/shared/notices";
import { enqueueReview, reviewAlertId } from "../review/queue";
import type { sendMail } from "./send";
import { signUnsubscribe } from "./unsubscribeSig";

export interface NotifyDeps {
  db: Firestore;
  mailer: typeof sendMail;
  /** 会員のメールアドレス。取れなければ null（その会員の知らせは failed）。 */
  emailOf(uid: string): Promise<string | null>;
  appUrl: string;
  unsubscribeSecret: string;
  now(): Date;
}

const ALREADY_EXISTS = 6;

const NETWORK_CODES: ReadonlySet<string> = new Set(["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EDNS"]);

/**
 * 送信のエラーが「これ以上送っても同じ」ものか。止める側:
 * - auth: 認証（EAUTH、535）
 * - quota: Gmail の送信上限（5.4.5、上限超過の語）と一時的な制限（421、454 の 4.7.0）
 * - network: 通信の失敗（時間切れ、接続、ソケット、名前解決）
 * 宛先の不備（5.1.1、EENVELOPE など）は null（その人だけの失敗）。
 * 上限の応答の形は未確認（Gmail の SMTP は 550 5.4.5 "Daily user sending quota exceeded" とされる。M-13 の docs で確かめる）。
 */
export function isMailStopError(e: unknown): "auth" | "quota" | "network" | null {
  if (typeof e !== "object" || e === null) return null;
  const err = e as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  if (err.code === "EAUTH" || err.responseCode === 535) return "auth";
  if (err.responseCode === 421 || err.responseCode === 454) return "quota";
  const text = [err.response, err.message].filter((x): x is string => typeof x === "string").join("\n");
  if (/\b5\.4\.5\b/.test(text) || /(daily\s+)?(user\s+)?sending\s+(quota|limit)s?\s+(has\s+been\s+)?(exceeded|reached)|quota\s+exceeded/i.test(text)) return "quota";
  if (typeof err.code === "string" && NETWORK_CODES.has(err.code)) return "network";
  return null;
}

/** `${appUrl}/unsubscribe?farm=&uid=&sig=`。 */
export function unsubscribeUrlFor(n: Pick<Notice, "farmId" | "uid">, deps: Pick<NotifyDeps, "appUrl" | "unsubscribeSecret">): string {
  const sig = signUnsubscribe(n.farmId, n.uid, deps.unsubscribeSecret);
  return `${deps.appUrl.replace(/\/+$/, "")}/unsubscribe?farm=${encodeURIComponent(n.farmId)}&uid=${encodeURIComponent(n.uid)}&sig=${encodeURIComponent(sig)}`;
}

/** メールが止まっていることを運営者の画面に出す（1 日 1 件。運営者へのメールも同じ Gmail なので、画面に出す）。 */
export async function noteMailStop(deps: Pick<NotifyDeps, "now">): Promise<void> {
  const now = deps.now();
  await enqueueReview(
    {
      id: reviewAlertId("mail_failing", jstDateOf(now)),
      kind: "alert",
      alert: "mail_failing",
      prefCode: null,
      caseId: null,
      message: "メールを送れませんでした（認証、または送信数の上限）。Gmail のアプリパスワードと、1 日の送信数の上限を確かめてください。送れなかった知らせは、1 時間ごとに送り直します。",
    },
    now,
  );
}

type Gate = { kind: "ok"; members: ReadonlySet<string>; stopped: ReadonlySet<string> } | { kind: "missing" } | { kind: "unreadable" };

/** 農場の会員と配信停止を読む。読めない（欄が配列でない、読み込みの失敗）は unreadable。 */
async function readGate(db: Firestore, farmId: string): Promise<Gate> {
  try {
    const snap = await db.collection("farms").doc(farmId).get();
    if (!snap.exists) return { kind: "missing" };
    const d = snap.data() as { memberUids?: unknown; unsubscribedUids?: unknown } | undefined;
    if (!Array.isArray(d?.memberUids) || !Array.isArray(d?.unsubscribedUids)) return { kind: "unreadable" };
    return { kind: "ok", members: new Set(d.memberUids as string[]), stopped: new Set(d.unsubscribedUids as string[]) };
  } catch {
    return { kind: "unreadable" };
  }
}

const codeOf = (e: unknown): string => {
  const c = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof c === "string" || typeof c === "number" ? String(c).slice(0, 40) : "unknown";
};

/** 送れたことを記録する。1 回だけやり直す（記録が queued のまま残ると、送り直しで二重に送りうる）。 */
async function markSent(ref: DocumentReference, sentAt: string): Promise<void> {
  try {
    await ref.update({ state: "sent", sentAt });
  } catch {
    await ref.update({ state: "sent", sentAt });
  }
}

/**
 * 知らせを二段で処理する。
 * 1 段目: 宛先ごとに農場の会員と配信停止を確かめ（停止済み、会員でない、農場がない会員は何もしない。読めなければ failed の記録だけ残して送らない）、
 *   create() で記録（queued）を全件作る。すでにあれば何もしない（gRPC コード 6）。途中で関数が打ち切られても、全件が M-13 の送り直しの対象になる。
 * 2 段目: 今回作った immediate を 1 件ずつ、記録を読み直して queued のときだけ送り、sent か failed にする。morning は queued のまま。
 * 認証、上限、一時的な制限、通信の失敗が出たら、残りは送らず queued のまま残し（M-13 の送り直しが拾う）、noteMailStop（連打しない）。
 * 記録の書き込みの失敗は件数をログに残し、呼び出し側の処理は止めない。
 */
export async function dispatchNotices(deps: NotifyDeps, notices: readonly Notice[]): Promise<{ mailStopped: boolean }> {
  let mailStopped = false;
  let errors = 0;
  const gates = new Map<string, Promise<Gate>>();
  const gateOf = (farmId: string): Promise<Gate> => {
    let g = gates.get(farmId);
    if (!g) gates.set(farmId, (g = readGate(deps.db, farmId)));
    return g;
  };

  // 1 段目
  const toSend: Array<{ n: Notice; ref: DocumentReference }> = [];
  for (const n of notices) {
    try {
      const gate = await gateOf(n.farmId);
      if (gate.kind === "missing") continue;
      if (gate.kind === "ok" && (!gate.members.has(n.uid) || gate.stopped.has(n.uid))) continue;

      const ref = deps.db.doc(`sentNotices/${noticeDocId(n.farmId, n.uid, n.subjectId, n.event)}`);
      const record: SentNotice = {
        farmId: n.farmId,
        uid: n.uid,
        subjectId: n.subjectId,
        event: n.event,
        timing: n.timing,
        state: gate.kind === "ok" ? "queued" : "failed",
        queuedAt: toJstIso(deps.now()),
        sentAt: null,
      };
      try {
        await ref.create(record);
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === ALREADY_EXISTS) continue;
        throw e;
      }
      if (gate.kind === "ok" && n.timing === "immediate") toSend.push({ n, ref });
    } catch (e) {
      errors += 1;
      console.error("[notify] 記録の書き込みに失敗しました", { code: codeOf(e) });
    }
  }

  // 2 段目
  for (const { n, ref } of toSend) {
    try {
      const cur = (await ref.get()).data() as { state?: unknown } | undefined;
      if (cur?.state !== "queued") continue; // 他で送られた、または失敗に直された

      let email: string | null = null;
      try {
        email = await deps.emailOf(n.uid);
      } catch (e) {
        console.error("[notify] 宛先を取れませんでした", { code: codeOf(e) });
      }
      if (email === null || email === "") {
        await ref.update({ state: "failed" });
        continue;
      }
      try {
        const mail = renderNotice(n, { unsubscribeUrl: unsubscribeUrlFor(n, deps), appUrl: deps.appUrl });
        await deps.mailer(email, mail);
      } catch (e) {
        const stop = isMailStopError(e);
        console.error("[notify] 送信に失敗しました", { code: codeOf(e), stop });
        if (stop !== null) mailStopped = true; // 更新が失敗しても、止める
        await ref.update({ state: "failed" });
        if (stop !== null) {
          await noteMailStop(deps);
          break; // 残りは queued のまま
        }
        continue;
      }
      await markSent(ref, toJstIso(deps.now()));
    } catch (e) {
      errors += 1;
      console.error("[notify] 記録の書き込みに失敗しました", { code: codeOf(e) });
      if (mailStopped) break;
    }
  }
  if (errors > 0) console.error("[notify] 記録に失敗した知らせがあります", { count: errors }); // 呼び出し側の処理は止めない。mailStopped の信号も失わない
  return { mailStopped };
}
