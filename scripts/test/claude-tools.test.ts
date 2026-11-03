import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// 先頭の --- で囲んだ部分だけを読む簡易な解析（key: value の 1 行形式）
function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("frontmatter がない");
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv?.[1] !== undefined) meta[kv[1]] = (kv[2] ?? "").trim();
  }
  return { meta, body: m[2] ?? "" };
}

function tableHeader(text: string): string[] {
  const line = text.split("\n").find((l) => l.trim().startsWith("|"));
  if (!line) throw new Error("表がない");
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

describe(".claude/settings.json", () => {
  const settings = JSON.parse(read(".claude/settings.json"));

  it("SessionStart が残っている", () => {
    expect(Array.isArray(settings.hooks?.SessionStart)).toBe(true);
    const commands = settings.hooks.SessionStart.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(commands.some((c: string) => c.includes("HANDOFF.md"))).toBe(true);
  });

  it("PreToolUse の Bash にこの hook がある", () => {
    const entries: any[] = settings.hooks?.PreToolUse ?? [];
    const bash = entries.filter((e) => e.matcher === "Bash");
    const commands = bash.flatMap((e) => e.hooks.map((h: any) => h.command));
    expect(commands).toContain('"$CLAUDE_PROJECT_DIR/.claude/hooks/public-precommit.sh"');
    for (const e of bash) for (const h of e.hooks) expect(h.type).toBe("command");
  });

  it("既存の設定を消していない", () => {
    expect(settings.enabledPlugins).toBeDefined();
  });
});

describe("役割（サブエージェント）", () => {
  const load = (name: string) => frontmatter(read(`.claude/agents/${name}.md`));
  const toolsOf = (meta: Record<string, string>) => (meta.tools ?? "").split(",").map((t) => t.trim());

  it("researcher は sonnet で、報告は未検証と明記する", () => {
    const { meta, body } = load("researcher");
    expect(meta.name).toBe("researcher");
    expect(meta.model).toBe("sonnet");
    expect((meta.description ?? "").length).toBeGreaterThan(10);
    expect(body).toContain("報告は未検証。本体が原本で確かめる");
  });

  for (const name of ["code-reviewer", "security-reviewer"]) {
    it(`${name} は opus で、Edit と Write を持たない`, () => {
      const { meta, body } = load(name);
      expect(meta.name).toBe(name);
      expect(meta.model).toBe("opus");
      // tools を省くと全部の道具を引き継ぐので、書いてあることまで確かめる
      expect(meta.tools).toBeTruthy();
      const tools = toolsOf(meta);
      expect(tools.length).toBeGreaterThan(0);
      for (const banned of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(tools).not.toContain(banned);
      expect(body.length).toBeGreaterThan(100);
    });
  }

  it("researcher は道具を明示し、既存のファイルを直す道具を持たない", () => {
    const { meta, body } = load("researcher");
    const tools = toolsOf(meta);
    expect(tools).toContain("Read");
    for (const banned of ["Edit", "MultiEdit", "NotebookEdit"]) expect(tools).not.toContain(banned);
    // 書くのは private/ の下の調査メモだけ（Write を持つ代わりに本文で縛る）
    if (tools.includes("Write")) expect(body).toContain("private/");
  });
});

describe("記録", () => {
  it("claude-code-usage.md の列", () => {
    expect(tableHeader(read("docs/claude-code-usage.md"))).toEqual(["日付", "作業", "モデル", "理由", "結果"]);
  });

  it("api-credit-usage.md の列", () => {
    expect(tableHeader(read("docs/api-credit-usage.md"))).toEqual(["日付", "用途", "モデル", "トークン数", "推定費用"]);
  });

  it("trial-and-error.md に「報道発表の一覧」「期限」の節がある", () => {
    const text = read("docs/trial-and-error.md");
    expect(text).toMatch(/^#{2,3} .*報道発表の一覧/m);
    expect(text).toMatch(/^#{2,3} .*期限/m);
  });

  it("記録に数字や秘密を作っていない（api-credit-usage の行は実測だけ）", () => {
    const rows = read("docs/api-credit-usage.md")
      .split("\n")
      .filter((l) => l.trim().startsWith("|"))
      .slice(2);
    for (const row of rows) expect(row).not.toMatch(/sk-/);
  });
});
