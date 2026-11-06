// bundle のあと、lib/data/consult/cards.json が既定の読み先（__dirname/data/consult）の形で読める。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConsultData } from "../src/consult/data";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "functions", "scripts", "bundle.mjs");
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("bundle のあと（対策の相談のカード）", () => {
  it("lib/data/consult/cards.json があり、loadConsultData で読め、確認済みのカードだけが入っている", async () => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-bundle-consult-"));
    tmpDirs.push(outdir);
    const r = spawnSync("node", [BUNDLE, "--outdir", outdir, "--data-root", path.join(ROOT, "data")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(outdir, "data", "consult", "cards.json"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "data", "consult", "verify.json"))).toBe(false);
    const { cards } = await loadConsultData(path.join(outdir, "data", "consult"));
    expect(cards.cards.length).toBeGreaterThan(0);
    expect(cards.cards.every((c) => c.approved)).toBe(true);
  }, 60_000);
});
