// 原文の控え（data/private/fixtures/、公開しない）を要る試験の入口（取り決め 1.4）。
// 控えがなければ飛ばす。受け入れの実行は REQUIRE_FIXTURES=1 を付け、控えがなければ失敗にする（飛んだまま緑にしない）。
// scripts/test からも使う。
import fs from "node:fs";
import { describe, expect, it } from "vitest";

export type FixtureMode = "run" | "skip" | "fail";

function hasFixture(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return fs.readdirSync(p).length > 0;
    return st.isFile();
  } catch {
    return false;
  }
}

export function fixtureMode(paths: readonly string[], env: Record<string, string | undefined>): FixtureMode {
  if (paths.every(hasFixture)) return "run";
  return env.REQUIRE_FIXTURES === "1" ? "fail" : "skip";
}

/**
 * 控えがあれば describe、なければ飛ばす。
 * 飛ばすときは本体 fn を呼ばない（vitest は skip した describe の本体も集める時に実行するので、本体が控えのファイルを読むと落ちる）。
 * REQUIRE_FIXTURES=1 で控えがなければ、失敗する試験を 1 件登録する。env は試験で差し替えるための引数。
 */
export function describeFixture(name: string, paths: readonly string[], fn: () => void, env: Record<string, string | undefined> = process.env): void {
  const mode = fixtureMode(paths, env);
  if (mode === "run") {
    describe(name, fn);
  } else if (mode === "skip") {
    describe.skip(name, () => {
      it.skip("控え（data/private/fixtures/）がないので飛ばした", () => {});
    });
  } else {
    describe(name, () => {
      it("控え（data/private/fixtures/）がある", () => {
        const missing = paths.filter((p) => !hasFixture(p));
        expect.fail(`REQUIRE_FIXTURES=1 ですが控えがありません: ${missing.join(", ")}`);
      });
    });
  }
}
