// bundle のあと、lib/data/consult/cards.json が既定の読み先（__dirname/data/consult）の形で読み込める。町の名前を引く lib/data/geo/muni-index.json もある。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { townNameOf } from "@hpai/shared/consult/farmCondition";
import { loadConsultData } from "../src/consult/data";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "functions", "scripts", "bundle.mjs");
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("bundle のあと（対策の相談のカード）", () => {
  it("lib/data/consult/cards.json と lib/data/history/cases.json があり、loadConsultData で読み込め、確認済みのカードだけが入っている", async () => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-bundle-consult-"));
    tmpDirs.push(outdir);
    const r = spawnSync("node", [BUNDLE, "--outdir", outdir, "--data-root", path.join(ROOT, "data")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(outdir, "data", "consult", "cards.json"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "data", "consult", "verify.json"))).toBe(false);
    const { cards, history } = await loadConsultData(path.join(outdir, "data", "consult"), path.join(outdir, "data", "history", "cases.json"));
    expect(cards.cards.length).toBeGreaterThan(0);
    // 発生の件数の表のために、過去の事例も同梱されている
    expect(history.length).toBeGreaterThan(0);
    expect(cards.cards.every((c) => c.approved)).toBe(true);
    // 相談の条件の市町村コードから町の名前を引く索引も同梱されている（index.ts の muniIndex が読む）
    const index = JSON.parse(fs.readFileSync(path.join(outdir, "data", "geo", "muni-index.json"), "utf8")) as Record<string, { name: string; prefCode: string }>;
    expect(townNameOf(index, "33643")).toBe("岡山県西粟倉村");
  }, 60_000);
});
