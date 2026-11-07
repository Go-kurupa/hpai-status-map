import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findBadRequires } from "../check-bundle";
import { copyWebData } from "../copy-web-data";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as Record<string, any>;
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const BUNDLE = path.join(ROOT, "functions", "scripts", "bundle.mjs");
const CHECK_BUNDLE = path.join(ROOT, "scripts", "check-bundle.ts");
const FUNCTIONS_PACKAGE = path.join(ROOT, "functions", "package.json");

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-skeleton-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function checkBundle(bundle: string, pkg: string) {
  return spawnSync(TSX, [CHECK_BUNDLE, bundle, pkg], { encoding: "utf8" });
}

describe("ルートの設定", () => {
  it("workspaces、engines、nvmrc", () => {
    const pkg = readJson("package.json");
    expect(pkg.workspaces).toEqual(["shared", "web", "functions", "evals", "scripts"]);
    expect(pkg.engines.node).toBe(">=24.12");
    expect(fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim()).toBe("24");
  });

  it("コマンド（取り決め 1.5）", () => {
    const { scripts } = readJson("package.json");
    expect(scripts.test).toBe("vitest run --project shared --project functions --project web --project scripts");
    expect(scripts["test:rules"]).toBe(
      'flock /tmp/hpai-emulators.lock firebase emulators:exec --only firestore,auth --project demo-hpai "vitest run --project rules"',
    );
    expect(scripts["test:emul"]).toBe(
      'flock /tmp/hpai-emulators.lock firebase emulators:exec --only firestore,auth,storage --project demo-hpai "vitest run --project functions-emul"',
    );
    expect(scripts.typecheck).toContain("typecheck");
    const build: string = scripts.build;
    expect(build.indexOf("copy-web-data")).toBeGreaterThanOrEqual(0);
    expect(build.indexOf("copy-web-data")).toBeLessThan(build.indexOf("-w web"));
    expect(build.indexOf("-w web")).toBeLessThan(build.indexOf("bundle -w functions"));
  });

  it("依存の版は exact（^ や ~ を使わない）", () => {
    for (const rel of ["package.json", "shared/package.json", "web/package.json", "functions/package.json"]) {
      const pkg = readJson(rel);
      for (const group of ["dependencies", "devDependencies"]) {
        for (const [name, version] of Object.entries<string>(pkg[group] ?? {})) {
          expect(version, `${rel} ${name}`).toMatch(/^\d+\.\d+\.\d+$/);
        }
      }
    }
  });

  it("tsconfig.base.json: 取り決めの設定で、baseUrl と paths がない", () => {
    const { compilerOptions: o } = readJson("tsconfig.base.json");
    expect(o).toMatchObject({
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
    });
    expect(o).not.toHaveProperty("baseUrl");
    expect(o).not.toHaveProperty("paths");
  });

  it("gitignore に生成物とローカルの設定がある", () => {
    const lines = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/);
    for (const line of [
      "functions/lib/",
      "web/public/geo/",
      "web/public/history/",
      "web/public/replay/",
      "web/public/evals/",
      "web/public/trends/",
      "web/public/migration/",
      ".firebase/",
      ".secret.local",
    ]) {
      expect(lines, line).toContain(line);
    }
  });
});

describe("functions の骨格", () => {
  it("functions/package.json: main、engines、bundle。type module と @hpai/shared がない", () => {
    const pkg = readJson("functions/package.json");
    expect(pkg.main).toBe("lib/index.js");
    expect(pkg.engines).toEqual({ node: "24" });
    expect(pkg.scripts.bundle).toBeTypeOf("string");
    expect(pkg).not.toHaveProperty("type");
    expect(JSON.stringify(pkg)).not.toContain("@hpai/shared");
  });

  it("shared の依存すべてが同じ版で functions にある", () => {
    const shared = readJson("shared/package.json").dependencies as Record<string, string>;
    const functions = readJson("functions/package.json").dependencies as Record<string, string>;
    for (const [name, version] of Object.entries(shared)) expect(functions[name], name).toBe(version);
  });

  it("shared は exports で ./* を src/*.ts に向ける", () => {
    const pkg = readJson("shared/package.json");
    expect(pkg.name).toBe("@hpai/shared");
    expect(pkg.exports).toEqual({ "./*": "./src/*.ts" });
  });

  it("barrel が 12 領域ぶんあり、index.ts が options を先に読んで全部を export * する", () => {
    const areas = ["probe", "ops", "watch", "read", "review", "usage", "notify", "farm", "drafts", "api", "mcp", "agent"];
    const index = fs.readFileSync(path.join(ROOT, "functions/src/index.ts"), "utf8");
    for (const area of areas) {
      expect(fs.existsSync(path.join(ROOT, `functions/src/${area}/index.ts`)), area).toBe(true);
      expect(index).toContain(`export * from "./${area}";`);
    }
    expect(index.indexOf('import "./options"')).toBeGreaterThanOrEqual(0);
    expect(index.indexOf('import "./options"')).toBeLessThan(index.search(/^export \* from/m));
    const options = fs.readFileSync(path.join(ROOT, "functions/src/options.ts"), "utf8");
    expect(options).toContain('region: "asia-northeast1"');
    expect(options).toContain("maxInstances: 5");
  });
});

describe("firebase.json", () => {
  const firebase = readJson("firebase.json");

  it("functions", () => {
    expect(firebase.functions).toMatchObject({
      runtime: "nodejs24",
      predeploy: ["npm run bundle -w functions"],
      ignore: ["node_modules", "src", "test", "scripts", "*.local", "tsconfig*.json"],
    });
  });

  it("hosting: web/dist、関数への rewrite、SPA の fallback、キャッシュ", () => {
    expect(firebase.hosting.public).toBe("web/dist");
    const region = "asia-northeast1";
    expect(firebase.hosting.rewrites).toEqual([
      { source: "/api/v1/**", function: { functionId: "api", region } },
      { source: "/mcp", function: { functionId: "mcp", region } },
      { source: "/unsubscribe", function: { functionId: "unsubscribe", region } },
      { source: "**", destination: "/index.html" },
    ]);
    const cache = (source: string) =>
      firebase.hosting.headers.find((h: any) => h.source === source)?.headers as Array<{ key: string; value: string }>;
    for (const source of ["/geo/**", "/history/**"]) {
      expect(cache(source)).toEqual([{ key: "Cache-Control", value: "public, max-age=86400" }]);
    }
  });

  it("N-7: 全ページに X-Frame-Options: DENY と X-Content-Type-Options: nosniff。ただし /__/ の下（Google ログインの iframe）は除く。既存の Cache-Control は残す", () => {
    const headers = firebase.hosting.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    // 「/__/ 以外のすべて」を表す glob。Firebase の予約パス /__/auth/iframe は、ログインの画面が自分の中に埋め込むので、DENY にすると Google ログインが壊れる
    const security = headers.find((h) => h.source === "!/__/**");
    expect(security?.headers).toEqual([
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]);
    // 他の項目は消えていない
    expect(headers.map((h) => h.source).sort()).toEqual(["!/__/**", "**/!(*.*)", "/assets/**", "/geo/**", "/history/**", "/index.html"]);
  });

  it("画面の入口の HTML は毎回確かめ（反映の後に古い版を出さない）、名前に版の入る assets は長く保存させる", () => {
    const headers = firebase.hosting.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    const cache = (source: string) => headers.find((h) => h.source === source)?.headers.find((x) => x.key === "Cache-Control")?.value;
    expect(cache("**/!(*.*)")).toBe("no-cache"); // /、/about など拡張子のない道筋（rewrite で index.html を返す）
    expect(cache("/index.html")).toBe("no-cache");
    expect(cache("/assets/**")).toBe("public, max-age=31536000, immutable");
    expect(cache("/geo/**")).toBe("public, max-age=86400"); // 前からの指定は変えない
  });

  it("emulators", () => {
    const { emulators } = firebase;
    expect(emulators.firestore.port).toBe(8080);
    expect(emulators.auth.port).toBe(9099);
    expect(emulators.storage.port).toBe(9199);
    expect(emulators.functions.port).toBe(5001);
    expect(emulators.hosting.port).toBe(5000);
    for (const name of ["firestore", "auth", "storage", "functions", "hosting"]) {
      expect(emulators[name].host, name).toBe("0.0.0.0");
    }
    expect(emulators.ui).toEqual({ enabled: false });
  });

  it(".firebaserc の既定は demo-hpai", () => {
    expect(readJson(".firebaserc").projects.default).toBe("demo-hpai");
  });

  it("Storage のルールは全拒否（Firestore のルールと索引は F-05 の試験が覆う）", () => {
    const text = fs.readFileSync(path.join(ROOT, "storage.rules"), "utf8");
    expect(text).toMatch(/allow read, write: if false;/);
    expect(text.match(/allow /g)).toHaveLength(1);
    expect(text).not.toMatch(/if true/);
  });
});

describe("findBadRequires", () => {
  const deps = new Set(["firebase-functions", "@google-cloud/storage", "zod"]);

  it("組み込みと dependencies の require は通す", () => {
    const code = [
      'const a = require("node:fs");',
      'const b = require("fs");',
      'const c = require("fs/promises");',
      'const d = require("firebase-functions/v2/https");',
      'const e = require("@google-cloud/storage/build/src");',
      "const f = require('zod');",
    ].join("\n");
    expect(findBadRequires(code, deps)).toEqual([]);
  });

  it("組み込みでも dependencies でもないものを返す", () => {
    const code = 'require("left-pad"); require("@hpai/shared/text"); require("./local"); require("zod");';
    expect(findBadRequires(code, deps)).toEqual(["left-pad", "@hpai/shared/text", "./local"]);
  });

  it("動的 import() も見る", () => {
    expect(findBadRequires('await import("not-installed");', deps)).toEqual(["not-installed"]);
  });
});

describe("check-bundle の終了コード", () => {
  it("通るときは 0", () => {
    const pkg = write("package.json", JSON.stringify({ dependencies: { zod: "4.6.7" } }));
    const bundle = write("lib/index.js", 'require("node:fs"); require("zod/v4");');
    expect(checkBundle(bundle, pkg).status).toBe(0);
  });

  it("組み込みでも dependencies でもない require があると 1", () => {
    const pkg = write("package.json", JSON.stringify({ dependencies: { zod: "4.6.7" } }));
    const bundle = write("lib/index.js", 'require("node:fs"); require("@hpai/shared/text");');
    const result = checkBundle(bundle, pkg);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@hpai/shared/text");
  });

  it("bundle が無いと 1", () => {
    const pkg = write("package.json", "{}");
    expect(checkBundle(path.join(tmp, "lib", "nothing.js"), pkg).status).toBe(1);
  });
});

describe("bundle.mjs", () => {
  const bundle = (args: string[]) => execFileSync(process.execPath, [BUNDLE, ...args], { encoding: "utf8" });

  it("shared を中に入れ、@hpai/shared を残さない。data/ が無くても通る", () => {
    const entry = write(
      "entry.ts",
      [
        'import { normalizeForMatch } from "@hpai/shared/text";',
        'import { FIXED_TEXT } from "@hpai/shared/wording";',
        'import { onRequest } from "firebase-functions/v2/https";',
        "export const probe = () => [normalizeForMatch('⻲岡市'), FIXED_TEXT.replayBanner, typeof onRequest];",
      ].join("\n"),
    );
    const outdir = path.join(tmp, "out");
    bundle(["--entry", entry, "--outdir", outdir, "--data-root", path.join(tmp, "no-data")]);
    const code = fs.readFileSync(path.join(outdir, "index.js"), "utf8");
    expect(code).not.toContain("@hpai/shared");
    // shared のコードが入っている（esbuild は日本語を \u の形に直すので、名前で見る）
    expect(code).toContain("function normalizeForMatch");
    expect(code).toContain("replayBanner");
    expect(code).toContain('require("firebase-functions/v2/https")'); // 外部は残る
    expect(fs.existsSync(path.join(outdir, "data"))).toBe(false);
    const checked = checkBundle(path.join(outdir, "index.js"), FUNCTIONS_PACKAGE);
    expect(checked.status, checked.stderr).toBe(0);
  });

  it("data/ があれば geo、history/cases.json、sources.json を lib/data/ へコピーする", () => {
    const dataRoot = path.join(tmp, "repo-data");
    write("repo-data/geo/pref/33.topo.json", "{}");
    write("repo-data/history/cases.json", "[]");
    write("repo-data/history/other.json", "[]"); // cases.json 以外は入れない
    write("repo-data/sources.json", "[]");
    write("repo-data/private/x.txt", "x"); // private/ は入れない
    const entry = write("entry.ts", "export const x = 1;");
    const outdir = path.join(tmp, "out");
    bundle(["--entry", entry, "--outdir", outdir, "--data-root", dataRoot]);
    expect(fs.existsSync(path.join(outdir, "data", "geo", "pref", "33.topo.json"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "data", "history", "cases.json"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "data", "history", "other.json"))).toBe(false);
    expect(fs.existsSync(path.join(outdir, "data", "sources.json"))).toBe(true);
    expect(fs.existsSync(path.join(outdir, "data", "private"))).toBe(false);
  });

  it("実際の functions/src/index.ts が同梱できて check-bundle を通る", () => {
    const outdir = path.join(tmp, "out");
    bundle(["--outdir", outdir, "--data-root", path.join(tmp, "no-data")]);
    const code = fs.readFileSync(path.join(outdir, "index.js"), "utf8");
    expect(code).not.toContain("@hpai/shared");
    const checked = checkBundle(path.join(outdir, "index.js"), FUNCTIONS_PACKAGE);
    expect(checked.status, checked.stderr).toBe(0);
  });
});

describe("copyWebData", () => {
  it("無い入力を飛ばし、あるものだけをコピーする", () => {
    expect(() => copyWebData(tmp)).not.toThrow();
    expect(fs.existsSync(path.join(tmp, "web", "public"))).toBe(false);
    write("data/history/cases.json", '["h"]');
    write("data/geo/pref/33.topo.json", "{}");
    write("evals/results/summary.json", '{"e":1}');
    copyWebData(tmp);
    expect(fs.readFileSync(path.join(tmp, "web/public/history/cases.json"), "utf8")).toBe('["h"]');
    expect(fs.existsSync(path.join(tmp, "web/public/geo/pref/33.topo.json"))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "web/public/evals/summary.json"), "utf8")).toBe('{"e":1}');
    expect(fs.existsSync(path.join(tmp, "web/public/replay"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "web/public/trends"))).toBe(false);
  });

  it("replay と trends をコピーし、history は cases.json だけ", () => {
    write("data/replay/a.json", "1");
    write("data/replay/sub/b.json", "2");
    write("data/trends/summary.json", "3");
    write("data/trends/other.json", "4");
    write("data/history/cases.json", "5");
    write("data/history/other.json", "6");
    write("data/private/x.json", "7");
    copyWebData(tmp);
    expect(fs.readFileSync(path.join(tmp, "web/public/replay/sub/b.json"), "utf8")).toBe("2");
    expect(fs.readFileSync(path.join(tmp, "web/public/trends/summary.json"), "utf8")).toBe("3");
    expect(fs.existsSync(path.join(tmp, "web/public/trends/other.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "web/public/history/other.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "web/public/private"))).toBe(false);
  });

  it("渡り鳥の集計（data/migration/summary.json だけ）を web/public/migration/ へコピーする", () => {
    write("data/migration/summary.json", "8");
    write("data/migration/other.json", "9");
    copyWebData(tmp);
    expect(fs.readFileSync(path.join(tmp, "web/public/migration/summary.json"), "utf8")).toBe("8");
    expect(fs.existsSync(path.join(tmp, "web/public/migration/other.json"))).toBe(false);
  });

  it("対策の相談のカード（data/consult/cards.json だけ）を web/public/consult/ へコピーする", () => {
    write("data/consult/cards.json", '{"c":1}');
    write("data/consult/verify.json", '{"v":1}');
    copyWebData(tmp);
    expect(fs.readFileSync(path.join(tmp, "web/public/consult/cards.json"), "utf8")).toBe('{"c":1}');
    expect(fs.existsSync(path.join(tmp, "web/public/consult/verify.json"))).toBe(false);
  });

  it("渡りの経路図（data/migration/routes/）を web/public/migration/routes/ へ、中身を変えずにコピーする", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x0a, 0xff, 0xd9]);
    fs.mkdirSync(path.join(tmp, "data/migration/routes"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "data/migration/routes/zu1.jpg"), bytes);
    write("data/migration/summary.json", "8");
    copyWebData(tmp);
    expect(fs.readFileSync(path.join(tmp, "web/public/migration/routes/zu1.jpg")).equals(bytes)).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "web/public/migration/summary.json"), "utf8")).toBe("8");
  });

  it("古いコピー先を残さず置き換える", () => {
    write("web/public/geo/stale.json", "old");
    write("data/geo/new.json", "new");
    copyWebData(tmp);
    expect(fs.existsSync(path.join(tmp, "web/public/geo/stale.json"))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, "web/public/geo/new.json"), "utf8")).toBe("new");
  });
});
