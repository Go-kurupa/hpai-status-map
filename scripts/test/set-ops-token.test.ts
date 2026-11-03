import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "set-ops-token.sh");

// 控えのファイル名（ops.ts は ops-token を読む）。Secret の名前との対応。
const FILES: Record<string, string> = {
  OPS_TOKEN: "ops-token",
  INTERNAL_MCP_TOKEN: "internal-mcp-token",
  UNSUBSCRIBE_SECRET: "unsubscribe-secret",
};
const ACCOUNT = "test@example.invalid";
const PROJECT = "demo-test";

let tmp: string;
let home: string;
let bin: string;
let log: string;
let configDir: string;

// 偽の npx。引数と標準入力を別々のファイルに記録するだけで、何にも接続しない。
const FAKE_NPX = `#!/usr/bin/env bash
id="$(date +%s%N)-$$"
printf '%s\\n' "$@" > "$FAKE_LOG/$id.args"
cat > "$FAKE_LOG/$id.stdin"
`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-token-"));
  home = path.join(tmp, "home");
  bin = path.join(tmp, "bin");
  log = path.join(tmp, "log");
  configDir = path.join(home, ".config", "hpai");
  for (const d of [home, bin, log]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(bin, "npx"), FAKE_NPX, { mode: 0o755 });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(env: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    FAKE_LOG: log,
    FIREBASE_ACCOUNT: ACCOUNT,
    FIREBASE_PROJECT: PROJECT,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return spawnSync("bash", [SCRIPT], { env: base, encoding: "utf8" });
}

interface Call {
  args: string[];
  stdin: string;
}
function calls(): Call[] {
  return fs
    .readdirSync(log)
    .filter((f) => f.endsWith(".args"))
    .sort()
    .map((f) => ({
      args: fs.readFileSync(path.join(log, f), "utf8").split("\n").filter((l) => l !== ""),
      stdin: fs.readFileSync(path.join(log, f.replace(/\.args$/, ".stdin")), "utf8"),
    }));
}
const read = (name: string) => fs.readFileSync(path.join(configDir, FILES[name]!), "utf8");
const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe("set-ops-token.sh", () => {
  it("3 つの Secret を --account、--project つきで入れる", () => {
    const r = run();
    expect(r.status).toBe(0);

    const cs = calls();
    expect(cs).toHaveLength(3);
    const names = cs.map((c) => c.args[c.args.indexOf("functions:secrets:set") + 1]);
    expect(names.sort()).toEqual(["INTERNAL_MCP_TOKEN", "OPS_TOKEN", "UNSUBSCRIBE_SECRET"]);

    for (const c of cs) {
      expect(c.args[0]).toBe("firebase");
      expect(c.args).toContain("functions:secrets:set");
      expect(c.args).toContain("--data-file=-");
      expect(c.args[c.args.indexOf("--account") + 1]).toBe(ACCOUNT);
      expect(c.args[c.args.indexOf("--project") + 1]).toBe(PROJECT);
      // 再 deploy の質問に答えさせない
      expect(c.args).toContain("--non-interactive");
    }
  });

  it("入れた値は控えと 1 バイトも違わない（改行を含まない）。argv にも出力にも載せない", () => {
    const r = run();
    expect(r.status).toBe(0);

    for (const c of calls()) {
      const name = c.args[c.args.indexOf("functions:secrets:set") + 1]!;
      const saved = read(name);
      expect(c.stdin).toBe(saved);
      expect(saved).toMatch(/^[A-Za-z0-9+/=]{32,}$/);
      expect(saved).not.toMatch(/\s/);
      expect(c.args.join("\n")).not.toContain(saved);
      expect(r.stdout).not.toContain(saved);
      expect(r.stderr).not.toContain(saved);
    }
    // 3 つの値は互いに違う
    expect(new Set(Object.keys(FILES).map(read)).size).toBe(3);
  });

  it("控えは mode 600、置き場は mode 700", () => {
    run();
    expect(mode(configDir)).toBe(0o700);
    for (const file of Object.values(FILES)) expect(mode(path.join(configDir, file))).toBe(0o600);
  });

  it("控えが在れば作り直さず、その値を入れ直す", () => {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const known = "KnownValueFromAnEarlierRunAAAAAAAAAAAAAAAAAAAA=";
    fs.writeFileSync(path.join(configDir, FILES.OPS_TOKEN!), known, { mode: 0o600 });

    const r = run();
    expect(r.status).toBe(0);

    expect(read("OPS_TOKEN")).toBe(known);
    const ops = calls().find((c) => c.args.includes("OPS_TOKEN"));
    expect(ops?.stdin).toBe(known);
    expect(mode(path.join(configDir, FILES.OPS_TOKEN!))).toBe(0o600);
    // ほかの 2 つは新しく作る
    expect(read("INTERNAL_MCP_TOKEN")).toMatch(/^[A-Za-z0-9+/=]{32,}$/);

    // 2 回目の実行でも全部同じ
    const before = Object.keys(FILES).map(read);
    expect(run().status).toBe(0);
    expect(Object.keys(FILES).map(read)).toEqual(before);
  });

  it("ANTHROPIC_API_KEY と GMAIL_APP_PASSWORD は入れず、仮の値も入れない", () => {
    const r = run();
    expect(r.status).toBe(0);
    for (const c of calls()) {
      expect(c.args.join("\n")).not.toMatch(/ANTHROPIC_API_KEY|GMAIL_APP_PASSWORD/);
    }
    expect(calls()).toHaveLength(3);
    expect(fs.readdirSync(configDir).sort()).toEqual(Object.values(FILES).sort());
  });

  it("FIREBASE_ACCOUNT または FIREBASE_PROJECT が無ければ何も入れずに止まる", () => {
    for (const missing of ["FIREBASE_ACCOUNT", "FIREBASE_PROJECT"]) {
      const r = run({ [missing]: undefined });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(missing);
    }
    expect(calls()).toHaveLength(0);
    expect(fs.existsSync(configDir)).toBe(false);
  });

  it("npx が失敗したら非 0 で止まる", () => {
    fs.writeFileSync(path.join(bin, "npx"), "#!/usr/bin/env bash\ncat > /dev/null\nexit 3\n", { mode: 0o755 });
    expect(run().status).not.toBe(0);
  });

  it("ソースに set -euo pipefail と umask 077 と openssl rand -base64 32 がある", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    expect(src).toMatch(/^set -euo pipefail$/m);
    expect(src).toMatch(/^umask 077$/m);
    expect(src).toContain("openssl rand -base64 32");
  });
});
