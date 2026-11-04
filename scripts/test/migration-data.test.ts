import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMigrationSummary } from "../../web/src/pages/trends/migrationTypes";
import { isMainSite, MAIN_SITE_MIN_MEDIAN } from "../lib/migration";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

describe("data/migration/summary.json（生成物）", () => {
  const file = path.join(ROOT, "data", "migration", "summary.json");
  const raw = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown) : null;

  it("画面が読める形で、主な地点だけが入っている", () => {
    expect(raw, "scripts/build-migration.ts を回して作る").not.toBeNull();
    const s = parseMigrationSummary(raw);
    expect(s).not.toBeNull();
    expect(s!.sites.length).toBeGreaterThan(0);
    for (const site of s!.sites) {
      expect(isMainSite(site), site.name).toBe(true);
      expect(site.baseline!.median).toBeGreaterThanOrEqual(MAIN_SITE_MIN_MEDIAN);
      // 過去の幅は今季より前のシーズンだけ
      for (const p of site.baseline!.seasons) expect(p.season).toBeLessThan(s!.currentSeason);
    }
  });

  it("農場・感染・予測・倍率に当たるキーを持たない", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(raw);
    for (const k of keys) expect(k).not.toMatch(/farm|infect|risk|level|predict|forecast|ratio|score|alert/iu);
  });
});

describe("isMainSite", () => {
  const base = { id: 1, name: "試験沼", latestDate: "2026-10-14", latestTotal: 5, fetchedAt: "2026-11-04", unreported: 0 };
  const baseline = (median: number) => ({ n: 3, median, min: 0, max: median + 1, seasons: [] });
  it("過去と比べられ、中央値が下限以上のときだけ", () => {
    expect(isMainSite({ ...base, baseline: null })).toBe(false);
    expect(isMainSite({ ...base, baseline: baseline(MAIN_SITE_MIN_MEDIAN - 1) })).toBe(false);
    expect(isMainSite({ ...base, baseline: baseline(MAIN_SITE_MIN_MEDIAN) })).toBe(true);
  });
});

describe("出典の文書と README", () => {
  const doc = read("docs", "data-sources.md");
  const sec = doc.slice(doc.indexOf("## 渡り鳥の飛来状況（data/migration/summary.json）"), doc.indexOf("## 過去の事例（data/history/cases.json）"));
  const legal = doc.slice(doc.indexOf("## 渡り鳥の飛来状況の利用条件"), doc.indexOf("## 過去の事例（data/history/cases.json）"));

  it("出典の文、加工の事実と主体、取得の流儀が data-sources.md にある", () => {
    expect(sec.length).toBeGreaterThan(200);
    for (const s of ["https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html", "加工", "この作品の作者", "politeFetch", "2 秒", "robots.txt", "175 本"]) {
      expect(sec, s).toContain(s);
    }
  });

  it("利用条件: PDL1.0 と確かめた日。All Rights Reserved との関係は未確認のまま（解けたと書かない）", () => {
    expect(legal).toContain("PDL1.0");
    expect(legal).toMatch(/確かめた日 \d{4}-\d{2}-\d{2}/u);
    expect(legal).toContain("All Rights Reserved");
    expect(legal).toContain("**未確認**");
    expect(legal).not.toMatch(/(併記|All Rights Reserved)[^\n]*(問題ない|問題なし|矛盾しない|解けた)/u);
  });

  it("README の外部のデータの表に行があり、未確認を隠さない", () => {
    const row = read("README.md")
      .split("\n")
      .find((l) => l.startsWith("| 環境省「渡り鳥の飛来状況」"));
    expect(row).toBeDefined();
    expect(row).toContain("PDL1.0");
    expect(row).toContain("未確認");
    expect(row).toContain("環境省が作成したものではありません");
    expect(row).toContain("data/migration/summary.json");
  });
});
