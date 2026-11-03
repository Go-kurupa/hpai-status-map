import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GeoNotLoadedError, isAdjacent } from "@hpai/shared/geo";
import { loadGeoStore } from "../src/geo/loadGeo";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "functions", "scripts", "bundle.mjs");
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("loadGeoStore", () => {
  it("data/geo から津山市 33203 を読める。県を読む前は GeoNotLoadedError", async () => {
    const geo = await loadGeoStore(path.join(ROOT, "data", "geo"));
    expect(Object.keys(geo.index)).toHaveLength(1747);
    expect(() => geo.geometry("33203")).toThrow(GeoNotLoadedError);
    await geo.ensurePrefs(["33"]);
    const g = geo.geometry("33203");
    expect(g.properties.c).toBe("33203");
    expect(["Polygon", "MultiPolygon"]).toContain(g.geometry.type);
    expect(isAdjacent("33203", "31201", geo)).toBe(true);
  });

  it("同じフォルダなら同じ GeoStore（読んだ県を使い回す）", async () => {
    const dir = path.join(ROOT, "data", "geo");
    expect(await loadGeoStore(dir)).toBe(await loadGeoStore(dir));
  });

  it("フォルダがなければ throw し、次の呼び出しでやり直せる", async () => {
    const missing = path.join(os.tmpdir(), "hpai-no-such-geo-dir");
    await expect(loadGeoStore(missing)).rejects.toThrow();
    await expect(loadGeoStore(missing)).rejects.toThrow();
  });
});

describe("bundle のあと", () => {
  it("lib/data/geo/muni-index.json があり、既定の場所（__dirname/data/geo）の形で読める", async () => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-bundle-"));
    tmpDirs.push(outdir);
    const r = spawnSync("node", [BUNDLE, "--outdir", outdir, "--data-root", path.join(ROOT, "data")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(outdir, "data", "geo", "muni-index.json"))).toBe(true);
    const geo = await loadGeoStore(path.join(outdir, "data", "geo"));
    await geo.ensurePrefs(["33"]);
    expect(geo.geometry("33203").properties.c).toBe("33203");
  }, 60_000);
});
