import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeFixture, fixtureMode } from "./helpers/fixtures";

let dir: string;
let present: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-fixture-"));
  present = path.join(dir, "present.txt");
  fs.writeFileSync(present, "x");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("fixtureMode", () => {
  it("控えが全部あれば run", () => {
    expect(fixtureMode([present], {})).toBe("run");
    expect(fixtureMode([present], { REQUIRE_FIXTURES: "1" })).toBe("run");
  });
  it("控えがなければ skip", () => {
    expect(fixtureMode([path.join(dir, "none.txt")], {})).toBe("skip");
    expect(fixtureMode([present, path.join(dir, "none.txt")], { REQUIRE_FIXTURES: "0" })).toBe("skip");
  });
  it("控えがなくて REQUIRE_FIXTURES=1 なら fail", () => {
    expect(fixtureMode([path.join(dir, "none.txt")], { REQUIRE_FIXTURES: "1" })).toBe("fail");
    expect(fixtureMode([present, path.join(dir, "none.txt")], { REQUIRE_FIXTURES: "1" })).toBe("fail");
  });
  it("パスが空なら run（必要な控えがない）", () => {
    expect(fixtureMode([], {})).toBe("run");
  });
  it("フォルダだけの存在は控えとして数えない（空のフォルダ）", () => {
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    expect(fixtureMode([empty], {})).toBe("skip");
  });
});

// 控えがなければ本体を呼ばない（本体が控えのファイルを読んでも、集める時に落ちない）。env は差し替える。
let skippedBodyRan = false;
describeFixture(
  "存在しない控え",
  [path.join(os.tmpdir(), "hpai-fixture-does-not-exist")],
  () => {
    skippedBodyRan = true;
    fs.readFileSync(path.join(os.tmpdir(), "hpai-fixture-does-not-exist")); // 呼ばれれば ENOENT で集める時に落ちる
    it("呼ばれない", () => {});
  },
  {},
);
describe("describeFixture", () => {
  it("控えがなければ本体を実行しない", () => {
    expect(skippedBodyRan).toBe(false);
  });
});
