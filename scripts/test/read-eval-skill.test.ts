// スキル read-eval（読み取りの試験の実行と読み方）の検査（I-06）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKILL = path.join(ROOT, ".claude", "skills", "read-eval", "SKILL.md");
const raw = fs.existsSync(SKILL) ? fs.readFileSync(SKILL, "utf8") : "";

function frontmatter(src: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/u.exec(src);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/u.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

describe("スキル read-eval", () => {
  it("SKILL.md があり、frontmatter に name と description がある", () => {
    expect(raw).not.toBe("");
    const fm = frontmatter(raw);
    expect(fm.name).toBe("read-eval");
    expect((fm.description ?? "").length).toBeGreaterThan(20);
  });

  it("本文のコマンドが evals/run.ts を呼び、--dry-run を先に勧める", () => {
    expect(raw).toMatch(/npx tsx evals\/run\.ts/u);
    expect(raw).toContain("--dry-run");
    expect(raw).toContain("--sync");
    expect(raw.indexOf("--dry-run")).toBeLessThan(raw.indexOf("--sync"));
  });

  it("鍵の値がなく、鍵を表示しないと書いてある", () => {
    expect(raw).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/u);
    expect(raw).not.toMatch(/ANTHROPIC_API_KEY\s*=\s*\S+/u);
    expect(raw).toMatch(/鍵.{0,20}表示しない/u);
  });

  it("summary.json、項目ごとの正解率、費用の読み方がある", () => {
    expect(raw).toContain("summary.json");
    expect(raw).toMatch(/正解率/u);
    expect(raw).toMatch(/費用/u);
    expect(raw).toContain("costPerDocumentUsd");
  });

  it("autoPublishEnabled を変えるのは利用者の確認の後だと書いてある", () => {
    expect(raw).toContain("autoPublishEnabled");
    expect(raw).toMatch(/利用者の確認の後/u);
  });

  it("原文と引用を書かない、有料の実行は確認を取る、と書いてある", () => {
    expect(raw).toMatch(/原文と引用を(結果に)?書かない/u);
    expect(raw).toMatch(/見積もり.{0,30}確認/u);
  });
});
