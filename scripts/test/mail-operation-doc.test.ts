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

  it("確認中のメールは「最初の 1 通だけ」と「14 日」の決まりがある。古い見積もりを今の見積もりとして書かない", () => {
    expect(doc).toContain("最初の 1 通だけ");
    expect(doc).toContain("14 日");
    // 決まりの前の実測（23 通、115 通、460 通）は、その行に「決まりの前」か「参考」がある
    const lines = doc.split("\n").filter((l) => /(23|115|460) 通/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/決まりの前|参考/);
    // 決まりの前の言い方を、今の見積もりとして残さない
    for (const old of ["20 人なら 480", "量の既定", "招待が 5 人なら", "招待が 20 人なら", "未実測"]) expect(doc).not.toContain(old);
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
