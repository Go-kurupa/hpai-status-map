// 会員の通知（M-02、M-13）の模擬環境の試験が使う道具。本番のコードは import しない。
// 送信は偽物（本物のメールは送らない）。メールアドレスは example.test。
import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import { db } from "../../src/admin";
import type { NotifyDeps } from "../../src/notify/dispatch";
import type { Farm } from "@hpai/shared/types";
import { farmFixture } from "../../../shared/test/helpers/mFixtures";

const PROJECT = "demo-hpai";

/** 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。beforeAll で呼ぶ。 */
export function assertEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
}

/** Firestore の中身を全部消す。beforeEach で呼ぶ。 */
export async function clearFirestore(): Promise<void> {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST!;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
}

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export interface FakeMailer {
  mailer: NotifyDeps["mailer"];
  /** 送れた分。 */
  sent: SentMail[];
  /** 呼ばれた宛先（失敗した分も含む）。 */
  calls: string[];
}

/** 偽の送信。fail が値を返した宛先は、その値を投げる（送れた分に入れない）。 */
export function fakeMailer(fail: (to: string, nth: number) => unknown = () => undefined): FakeMailer {
  const sent: SentMail[] = [];
  const calls: string[] = [];
  const mailer: NotifyDeps["mailer"] = async (to, mail) => {
    calls.push(to);
    const err = fail(to, calls.length);
    if (err !== undefined) throw err;
    sent.push({ to, subject: mail.subject, text: mail.text });
  };
  return { mailer, sent, calls };
}

export const NOW = new Date("2026-11-05T03:00:00Z"); // JST 12:00

/** 会員ごとのメールアドレスは `${uid}@example.test`。emailOf の上書きで取れない会員を作れる。 */
export function makeDeps(over: Partial<NotifyDeps> & { fail?: (to: string, nth: number) => unknown } = {}): { deps: NotifyDeps; mail: FakeMailer } {
  const { fail, ...rest } = over;
  const mail = fakeMailer(fail);
  const deps: NotifyDeps = {
    db,
    mailer: mail.mailer,
    emailOf: async (uid) => `${uid}@example.test`,
    appUrl: "https://app.example.test",
    unsubscribeSecret: "test-secret-not-real",
    now: () => NOW,
    ...rest,
  };
  return { deps, mail };
}

export async function seedFarm(id: string, uid: string, over: Partial<Farm> = {}): Promise<void> {
  await db.collection("farms").doc(id).set(farmFixture(uid, over));
}

/** sentNotices の全文書を、id をキーに返す。 */
export async function sentNoticeDocs(): Promise<Record<string, FirebaseFirestore.DocumentData>> {
  const snap = await db.collection("sentNotices").get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}

export async function reviewQueueIds(): Promise<string[]> {
  return (await db.collection("reviewQueue").get()).docs.map((d) => d.id).sort();
}

/** console の出力を集める（ログにメールアドレスなどが出ていないかを確かめる）。restore で戻す。 */
export function captureLogs(): { text(): string; restore(): void } {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, (_k, v) => (v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v)))).join(" "));
    }),
  );
  return { text: () => lines.join("\n"), restore: () => spies.forEach((s) => s.mockRestore()) };
}

/** 総括の Claude の返事の形（本物の Claude は呼ばない）。 */
export function claudeMessage(message: string, over: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify({ message }), citations: null }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  } as unknown as Anthropic.Message;
}

/** 偽の Claude。呼ばれた内容を calls に残す。Error なら投げる。 */
export function fakeClient(reply: Anthropic.Message | Error): { client: Anthropic; calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(p);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}
