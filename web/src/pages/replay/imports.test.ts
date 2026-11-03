// 再現と見本の画面は、Firebase、本物のデータの口（data/live）、Claude の SDK を読み込まない（設計書 §17）。
// 直接の import だけでなく、相対 import をたどった先も調べる（MapPage が引き込むものを含む）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..", "..");
const FORBIDDEN = [/(^|\/)firebase(\/|$)/, /firebase\//, /(^|\/)data\/live(\.|$|\/)/, /@anthropic-ai\/sdk/, /(^|\/)data\/source(\.|$)/];
const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
/** 静的な import だけ（import("…") の動的なものは別の chunk になるので、載るかどうかの検査では数えない） */
const STATIC_IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p) : [p];
  });
}
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

function resolveRelative(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function specsOf(file: string, staticOnly = false): string[] {
  const text = fs.readFileSync(file, "utf8");
  if (staticOnly) return [...text.matchAll(STATIC_IMPORT)].map((m) => m[1]!);
  return [...text.matchAll(IMPORT)].map((m) => (m[1] ?? m[2])!);
}

/** file からたどれる全ての相対 import（と、そこに書かれた全ての指定）を集める */
function walk(entry: string, staticOnly = false): { files: Set<string>; specs: Array<{ file: string; spec: string }> } {
  const files = new Set<string>();
  const specs: Array<{ file: string; spec: string }> = [];
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of specsOf(f, staticOnly)) {
      specs.push({ file: f, spec });
      if (spec.startsWith(".")) {
        const r = resolveRelative(f, spec);
        if (r) stack.push(r);
      }
    }
  }
  return { files, specs };
}

describe("pages/replay と pages/sample の import", () => {
  const dirs = [path.join(SRC, "pages", "replay"), path.join(SRC, "pages", "sample")];
  const sources = dirs.flatMap(listFiles).filter(isSource);

  it("再現の画面のファイルがある", () => {
    expect(sources.some((f) => f.endsWith("ReplayFrame.tsx"))).toBe(true);
    expect(sources.some((f) => f.endsWith("ReplayDataSource.ts"))).toBe(true);
  });

  it("firebase、data/live、data/source（本物と E2E の口を選ぶ所）、@anthropic-ai/sdk を import していない", () => {
    for (const f of sources) {
      for (const spec of specsOf(f)) {
        for (const re of FORBIDDEN) expect(re.test(spec), `${path.relative(SRC, f)} → ${spec}`).toBe(false);
      }
    }
  });

  it("相対 import をたどった先（MapPage など）にも、禁じた import がない", () => {
    const entries = sources.filter((f) => /Replay(Page|Frame)\.tsx$/.test(f));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const { files, specs } = walk(entry);
      expect(files.size).toBeGreaterThan(5); // MapPage の中までたどれている
      for (const { file, spec } of specs) {
        for (const re of FORBIDDEN) expect(re.test(spec), `${path.relative(SRC, entry)} … ${path.relative(SRC, file)} → ${spec}`).toBe(false);
      }
    }
  });

  it("見本の画面の入口から静的にたどれる先（やること、記録、会員の案内を除く）に、禁じた import がない。Firebase が見本の chunk に載らない", () => {
    const entries = sources.filter((f) => /Sample(Frame|Layout|Page|TodoPage|RecordPage)\.tsx$/.test(f));
    expect(entries.map((f) => path.basename(f)).sort()).toEqual(["SampleFrame.tsx", "SampleLayout.tsx", "SamplePage.tsx", "SampleRecordPage.tsx", "SampleTodoPage.tsx"]);
    for (const entry of entries) {
      const { files, specs } = walk(entry, true);
      if (/Sample(Todo|Record)Page\.tsx$/.test(entry)) {
        expect(files.size).toBeGreaterThan(8); // やること・記録の画面の中までたどれている
        expect([...files].some((f) => f.endsWith("disinfectionLog.tsx"))).toBe(true);
        expect([...files].some((f) => f.endsWith("useAuthUser.ts"))).toBe(false);
      }
      for (const { file, spec } of specs) {
        for (const re of FORBIDDEN) expect(re.test(spec), `${path.relative(SRC, entry)} … ${path.relative(SRC, file)} → ${spec}`).toBe(false);
      }
    }
  });
});
