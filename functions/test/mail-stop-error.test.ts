// M-13: 公式のページ（Gmail の SMTP のエラー一覧）の応答の形が、isMailStopError と合う。
import { describe, expect, it } from "vitest";
import { isMailStopError } from "../src/notify/dispatch";

/** nodemailer が投げる形（response は SMTP の応答の 1 行、responseCode は数）。 */
const smtp = (responseCode: number, response: string, code = "EENVELOPE") => Object.assign(new Error(response), { code, responseCode, response });

describe("isMailStopError: Gmail の応答の形", () => {
  it.each([
    smtp(550, "550 5.4.5 Daily user sending limit exceeded."),
    smtp(550, "550 5.4.5 Daily SMTP relay limit exceeded for user."),
    smtp(550, "550 5.7.1 Daily SMTP relay sending limit exceeded for this customer."),
  ])("送信数の上限は quota: %s", (e) => {
    expect(isMailStopError(e)).toBe("quota");
  });

  it("認証は auth（535 5.7.80、EAUTH）", () => {
    expect(isMailStopError(smtp(535, "535 5.7.80 Username and Password not accepted.", "EAUTH"))).toBe("auth");
  });

  it.each([
    smtp(421, "421 4.7.0 Try again later, closing connection.", "ESOCKET"),
    smtp(454, "454 4.7.0 Too many sign-in attempts, try again later."),
  ])("一時的な制限は quota: %s", (e) => {
    expect(isMailStopError(e)).toBe("quota");
  });

  it("通信の失敗は network。宛先の不備（5.1.1）は null", () => {
    expect(isMailStopError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe("network");
    expect(isMailStopError(smtp(550, "550 5.1.1 The email account that you tried to reach does not exist."))).toBeNull();
    expect(isMailStopError(new Error("unknown"))).toBeNull();
  });
});
