// 同梱の後に lib/index.js の require を点検する。
// 組み込みでも functions/package.json の dependencies でもないものが残っていたら exit 1。
//   tsx scripts/check-bundle.ts [bundle] [package.json]
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRE_PATTERN = /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;
const BUILTINS = new Set(builtinModules);

/** "firebase-functions/v2/https" → "firebase-functions"、"@scope/pkg/sub" → "@scope/pkg" */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** 通らない require の指定子を、現れた順に重複なしで返す。 */
export function findBadRequires(code: string, dependencies: ReadonlySet<string>): string[] {
  const bad: string[] = [];
  for (const match of code.matchAll(REQUIRE_PATTERN)) {
    const specifier = match[1]!;
    if (specifier.startsWith("node:")) continue;
    const name = packageNameOf(specifier);
    if (BUILTINS.has(specifier) || BUILTINS.has(name)) continue;
    if (!specifier.startsWith(".") && dependencies.has(name)) continue;
    if (!bad.includes(specifier)) bad.push(specifier);
  }
  return bad;
}

function main(argv: string[]): number {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = path.resolve(argv[0] ?? path.join(root, "functions", "lib", "index.js"));
  const pkgPath = path.resolve(argv[1] ?? path.join(root, "functions", "package.json"));
  if (!fs.existsSync(bundle)) {
    console.error(`check-bundle: 同梱が見つかりません: ${bundle}`);
    return 1;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string> };
  const bad = findBadRequires(fs.readFileSync(bundle, "utf8"), new Set(Object.keys(pkg.dependencies ?? {})));
  if (bad.length > 0) {
    console.error(`check-bundle: 組み込みでも dependencies でもない require が残っています: ${bad.join(", ")}`);
    return 1;
  }
  console.log("check-bundle: OK");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
