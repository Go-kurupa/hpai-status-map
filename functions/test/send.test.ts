// メール送信の土台（I-18。以後の所有者は M）。実際には送らない: jsonTransport で組み立てた中身を見る。
import { createTransport } from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { gmailTransportOptions, makeSender, SMTP_TIMEOUT_MS } from "../src/notify/send";

describe("makeSender", () => {
  it("差出人、宛先、件名、本文が入る（jsonTransport）", async () => {
    const transport = createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    await makeSender(transport, '"鳥インフル発生状況マップ" <sender@example.com>')("to@example.com", { subject: "運営者の確認が 3 件あります", text: "本文です\n2 行目" });
    expect(spy).toHaveBeenCalledTimes(1);
    const info = (await spy.mock.results[0]!.value) as { message: string };
    const json = JSON.parse(info.message) as { from: { name: string; address: string }; to: Array<{ address: string }>; subject: string; text: string };
    expect(json.from).toEqual({ name: "鳥インフル発生状況マップ", address: "sender@example.com" });
    expect(json.to.map((t) => t.address)).toEqual(["to@example.com"]);
    expect(json.subject).toBe("運営者の確認が 3 件あります");
    expect(json.text).toBe("本文です\n2 行目");
  });

  it("送信に失敗したら、その例外を投げる（黙って成功にしない）", async () => {
    const fail = { sendMail: async () => Promise.reject(new Error("smtp down")) };
    await expect(makeSender(fail, "a@example.com")("to@example.com", { subject: "s", text: "t" })).rejects.toThrow("smtp down");
  });

  it("宛先と件名に改行があっても、ヘッダーを増やさない（件名の改行は空白にする）", async () => {
    const calls: Array<{ to: string; subject: string }> = [];
    const spy = { sendMail: async (m: { to: string; subject: string }) => void calls.push(m) };
    await makeSender(spy as never, "a@example.com")("to@example.com", { subject: "一行目\r\nBcc: evil@example.com", text: "t" });
    expect(calls[0]!.subject).not.toMatch(/[\r\n]/);
  });
});

describe("gmailTransportOptions", () => {
  it("接続、挨拶、無通信の待ちに短い上限を付ける（関数の打ち切りまで待たない）", () => {
    const o = gmailTransportOptions("sender@example.test", "pw");
    expect(SMTP_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    expect(o).toMatchObject({ service: "Gmail", connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS });
  });
});
