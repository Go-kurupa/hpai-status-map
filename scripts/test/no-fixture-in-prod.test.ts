// X-20: 本番の build に、試験の入口（__HPAI_FIXTURE__、__hpaiMap）が残っていない。
// 入口は import.meta.env.MODE === "e2e" の中だけにあり、本番の build（vite build）では取り除かれる。
// 前提: `cd web && npx vite build` を済ませてある（web/dist/assets/*.js）。build が無い間は飛ばす。
// build の後に飛ばされていたら、試験が働いていない。実行結果で「skipped」でないことを確かめる。
// REQUIRE_BUILD=1 のときは、web/dist が無ければ飛ばさず失敗にする（提出の前の確認、CI）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "..", "..", "web");
const jsIn = (dir: string): string[] => {
  const assets = path.join(WEB, dir, "assets");
  return fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => path.join(assets, f)) : [];
};

const prod = jsIn("dist");
const e2e = jsIn("dist-e2e");
/** build が無いときに、飛ばさず失敗にする */
const REQUIRE_BUILD = process.env.REQUIRE_BUILD === "1";
const skipWithoutBuild = prod.length === 0 && !REQUIRE_BUILD;
const ENTRANCES = ["__HPAI_FIXTURE__", "__hpaiMap"] as const;
const readAll = (files: string[]) => files.map((f) => ({ name: path.relative(WEB, f), text: fs.readFileSync(f, "utf8") }));

describe("本番の build（web/dist）に試験の入口がない", () => {
  it.runIf(REQUIRE_BUILD)("REQUIRE_BUILD=1: web/dist/assets/*.js がある（無ければ失敗。cd web && npx vite build を先に）", () => {
    expect(prod.length).toBeGreaterThan(0);
  });

  it.skipIf(skipWithoutBuild)("web/dist/assets/*.js に __HPAI_FIXTURE__ と __hpaiMap がない", () => {
    const files = readAll(prod);
    expect(files.length).toBeGreaterThan(0);
    for (const entrance of ENTRANCES) {
      expect(files.filter((f) => f.text.includes(entrance)).map((f) => f.name), `${entrance} が残っているファイル`).toEqual([]);
    }
  });

  it.skipIf(skipWithoutBuild)("web/dist は mode=e2e の build ではない（index.html が dist-e2e と同じ入口を指さない）", () => {
    const html = fs.readFileSync(path.join(WEB, "dist", "index.html"), "utf8");
    expect(html).toMatch(/assets\/index-[\w-]+\.js/u);
    if (e2e.length > 0) {
      const e2eHtml = fs.readFileSync(path.join(WEB, "dist-e2e", "index.html"), "utf8");
      expect(html).not.toBe(e2eHtml);
    }
  });

  // 対照: 探す語が本当に build に残る形だと分かっている（dist-e2e に入口がある）。ここが落ちたら、上の試験は空振りしている
  it.skipIf(e2e.length === 0)("対照: web/dist-e2e には入口がある（探す語で見つかる）", () => {
    const files = readAll(e2e);
    expect(files.some((f) => f.text.includes("__HPAI_FIXTURE__"))).toBe(true);
    expect(files.some((f) => f.text.includes("__hpaiMap"))).toBe(true);
  });
});
