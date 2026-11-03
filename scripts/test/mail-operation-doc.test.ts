import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOC = path.resolve(import.meta.dirname, "..", "..", "docs", "mail-operation.md");
const doc = fs.readFileSync(DOC, "utf8");

describe("docs/mail-operation.md", () => {
  it("Gmail の 1 日 500 通と、確認日がある", () => {
    expect(doc).toContain("500");
    expect(doc).toMatch(/確認日: \d{4}-\d{2}-\d{2}/);
  });

  it("公式のページの URL が書かれている", () => {
    for (const url of [
      "https://support.google.com/mail/answer/22839",
      "https://support.google.com/accounts/answer/185833",
      "https://laws.e-gov.go.jp/law/414AC0100000026",
    ]) {
      expect(doc).toContain(url);
    }
  });

  it("特定電子メール法について、適法などと言い切らない", () => {
    expect(doc).not.toMatch(/(該当しません|対象外です|適法です)/);
    expect(doc).toContain("断定しない");
    expect(doc).toContain("送信者の立場");
    expect(doc).toContain("広告又は宣伝を行うための手段として送信をする電子メール"); // 定義の原文
  });

  it("通数は M-02 の実測（5 人で 115 通、20 人で 460 通）で、計画の 480 通は残さない", () => {
    expect(doc).toContain("115 通");
    expect(doc).toContain("460 通");
    expect(doc).not.toContain("20 人なら 480"); // 置き換えた計画の値を、現在の見積もりとして書かない
  });

  it("SMTP だけの上限は未確認と書く。アプリパスワードの条件がある", () => {
    expect(doc).toMatch(/SMTP だけの[^\n]*未確認/);
    for (const s of ["2 段階認証", "セキュリティキー", "取り消される"]) expect(doc).toContain(s);
  });

  it("止まったときの動き（failed、1 時間ごと、mail_failing）と、メールアドレスを含まない", () => {
    for (const s of ["failed", "1 時間ごと", "mail_failing"]) expect(doc).toContain(s);
    expect(doc).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
