import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "..", "with-dev-key.sh");
// 本物の鍵の形にしない（公開前の検査の対象にならない作り物の値）
const FAKE = "fake-dev-value-for-test";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-devkey-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.ANTHROPIC_API_KEY;
  return spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" });
}

describe("with-dev-key.sh", () => {
  it("鍵のファイルがなければ止め、値を出さない", () => {
    const r = run(["true"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("anthropic-dev-key");
  });

  it("鍵を続くコマンドの環境に渡し、画面には出さない。末尾の改行は除く", () => {
    fs.mkdirSync(path.join(home, ".config", "hpai"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "hpai", "anthropic-dev-key"), `${FAKE}\n`);
    const r = run(["bash", "-c", '[ "$ANTHROPIC_API_KEY" = "' + FAKE + '" ] && echo matched']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("matched");
    expect(r.stdout).not.toContain(FAKE);
    expect(r.stderr).not.toContain(FAKE);
  });

  it("コマンドがなければ使い方を出して止める", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("使い方");
  });
});
