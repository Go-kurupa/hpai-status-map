// 舞台裏のデータを作る（X-07）。去年 12 月の再現の文書を Claude で読み、照合と二重読みの結果と使用量を data/replay/ に置く。
//
//   npx tsx scripts/build-backstage.ts            … 計画を出すだけ（何も呼ばず、何も書かない。exit 2）
//   npx tsx scripts/build-backstage.ts --fetch    … 足りない原本の控えを取る（無料。国・県・市のサイトへ。Claude は呼ばない）
//   npx tsx scripts/build-backstage.ts --yes      … **有料の Claude API を呼ぶ**。人が支払いの上限を置いた後にだけ
//   npx tsx scripts/build-backstage.ts --yes --remeasure … 測り済みを書き直す（読みの結果の控えを使うので、支払いは増えない）
//
// 控えは data/private/replay-cache/（公開しない）。実行の本体は scripts/lib/backstage.ts。鍵は SDK が環境から読む。ここでは読まず、表示もしない。
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { politeFetch } from "../functions/src/watch/politeFetch";
import { runBackstage, type BackstageDoc } from "./lib/backstage";
import { loadScriptGeoStore } from "./lib/geoStore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPLAY = path.join(ROOT, "data", "replay");

/** 原本を取る。その文書のホストの外へは出ない（リダイレクトの先も同じ）。取れなければ null */
async function fetchOne(doc: BackstageDoc): Promise<Buffer | null> {
  const host = new URL(doc.url).hostname;
  const r = await politeFetch(doc.url, { allowUrl: (u) => u.protocol === "https:" && u.hostname === host, maxBytes: 30 * 1024 * 1024 });
  return r.kind === "ok" ? r.body : null;
}

runBackstage(process.argv.slice(2), {
  files: {
    docs: path.join(REPLAY, "docs.json"),
    backstage: path.join(REPLAY, "backstage.json"),
    usage: path.join(REPLAY, "measured-usage.json"),
    scenario: path.join(REPLAY, "scenario.json"),
  },
  cacheDir: path.join(ROOT, "data", "private", "replay-cache"),
  log: (line) => console.log(line),
  makeClient: () => new Anthropic(),
  loadGeo: () => loadScriptGeoStore(),
  now: () => new Date(),
  fetchOne,
}).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.name : "unknown"); // 本文や鍵を出さない
    process.exit(1);
  },
);
