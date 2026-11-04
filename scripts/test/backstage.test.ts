// 舞台裏（X-07）の試験。有料の Claude API は呼ばない（偽の client だけ）。
// 公開の単体試験は、作った短い文書だけを使う（実在の発表の文を写さない）。
import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import { compareReads } from "@hpai/shared/read/compare";
import type { ReadResult, SecondReadResult } from "@hpai/shared/read/types";
import { verifyRead } from "@hpai/shared/read/verify";
import { tamperRadius, tamperSecondMuni, toBackstageEntry, type BackstageFile, type MeasuredUsage, type ReplayScenario } from "@hpai/shared/replay";
import { normalizeForMatch } from "@hpai/shared/text";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import {
  checkBackstageData,
  parseBackstageArgs,
  runBackstage,
  UNMEASURED_BACKSTAGE,
  UNMEASURED_USAGE,
  type BackstageDeps,
  type BackstageDoc,
} from "../lib/backstage";
import { loadScriptGeoStore } from "../lib/geoStore";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const S = DEFAULT_RUNTIME_SETTINGS;
let geo: GeoStore;
beforeAll(async () => {
  geo = await loadScriptGeoStore();
  await geo.ensurePrefs(["33"]);
});

// ── 作った文（実在の発表ではない）──
const SENT_A = "岡山県は、令和7年12月20日午前9時、津山市の採卵鶏農場（飼養羽数約43万羽）で、高病原性鳥インフルエンザの疑似患畜を確認しました。";
const RADIUS_SENT = "発生農場から半径3km以内を移動制限区域、半径3kmから10km以内を搬出制限区域とします。";
const TEXT_A = ["【試験用の作り文】津山市で疑似患畜を確認", SENT_A, RADIUS_SENT, "区域の外の農場には、野鳥の侵入を防ぐなど、飼養衛生管理の徹底をお願いします。"].join("\n");
const SENT_B = "岡山県は、令和7年12月19日、津山市の採卵鶏農場の鶏について、簡易検査で陽性を確認しました。";
const TEXT_B = ["【試験用の作り文】津山市で簡易検査陽性", SENT_B, "遺伝子検査の結果は、わかり次第お知らせします。"].join("\n");

const q = <T,>(value: T | null, quote: string | null) => ({ value, quote });
const NONE = { value: null, quote: null };

function readA(): ReadResult {
  return {
    kind: "confirmed",
    kindQuote: "高病原性鳥インフルエンザの疑似患畜を確認しました。",
    multipleCases: false,
    prefecture: q("岡山県", SENT_A),
    municipality: q("津山市", SENT_A),
    nationalNo: NONE,
    prefNo: NONE,
    birdUse: q("採卵鶏", SENT_A),
    housing: NONE,
    headCount: q(430000, SENT_A),
    negationBasis: NONE,
    primaryStage: "confirmed",
    primaryDate: { year: 2025, month: 12, day: 20, time: "09:00" },
    primaryDateQuote: "令和7年12月20日午前9時",
    stageEvents: [],
    radiiKm: [{ km: 3, quote: RADIUS_SENT }],
    estimates: [],
    wildBirds: [],
  };
}
const secondA = (): SecondReadResult => ({
  kind: "confirmed",
  multipleCases: false,
  prefecture: "岡山県",
  municipality: "津山市",
  primaryStage: "confirmed",
  primaryDate: { year: 2025, month: 12, day: 20, time: "09:00" },
  wildBirds: [],
});
function readB(): ReadResult {
  return {
    ...readA(),
    kind: "suspected",
    kindQuote: "簡易検査で陽性を確認しました。",
    prefecture: q("岡山県", SENT_B),
    municipality: q("津山市", SENT_B),
    birdUse: NONE,
    headCount: NONE,
    primaryStage: "suspected",
    primaryDate: { year: 2025, month: 12, day: 19, time: null },
    primaryDateQuote: "令和7年12月19日",
    radiiKm: [],
  };
}
const secondB = (): SecondReadResult => ({ ...secondA(), kind: "suspected", primaryStage: "suspected", primaryDate: { year: 2025, month: 12, day: 19, time: null } });

const verifyA = (r: ReadResult = readA()) => verifyRead(r, { text: TEXT_A, hasTextLayer: true, season: 2025 }, geo, null, {});

/** 本文の連続 n 字（正規化後）が json の中に出ていないか */
function hasRun(json: string, text: string, n = 20): boolean {
  const j = normalizeForMatch(json);
  const t = normalizeForMatch(text);
  for (let i = 0; i + n <= t.length; i++) if (j.includes(t.slice(i, i + n))) return true;
  return false;
}
function* keysOf(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keysOf(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keysOf(x);
    }
}

describe("toBackstageEntry", () => {
  const make = () => {
    const read = readA();
    const verify = verifyA(read);
    const second = secondA();
    return toBackstageEntry({ id: "t-a", url: "https://example.test/a", read, second, verify, compare: compareReads(read, second), docText: TEXT_A });
  };

  it("前提: 作った文は照合を通る", () => {
    expect(verifyA().pass).toBe(true);
    expect(verifyA().issues).toEqual([]);
  });

  it("quote のキーがなく、本文の連続 20 字以上を含まない", () => {
    const e = make();
    expect([...keysOf(e)]).not.toContain("quote");
    expect(hasRun(JSON.stringify(e), TEXT_A)).toBe(false);
    expect(e.documentUrl).toBe("https://example.test/a");
    expect(e.kind).toBe("confirmed");
  });

  it("matchedWord は 20 字以内か null。市町村は文書にある語", () => {
    const e = make();
    for (const r of e.primary) expect(r.matchedWord === null || r.matchedWord.length <= 20, r.field).toBe(true);
    const muni = e.primary.find((r) => r.field === "municipality")!;
    expect(muni.value).toBe("津山市");
    expect(muni.matchedWord).toBe("津山市");
    expect(e.primary.find((r) => r.field === "primaryDate")!.value).toContain("2025-12-20");
  });

  it("長い自由記述は連続 20 字以上を持ち込まない（その行を出さない）", () => {
    const read = readA();
    read.housing = q("ウインドレス鶏舎で飼養しており、鶏舎の数は合計で五棟あります。", SENT_A); // 本文に無くても長い値は出さない
    const text = `${TEXT_A}\nウインドレス鶏舎で飼養しており、鶏舎の数は合計で五棟あります。`;
    const e = toBackstageEntry({ id: "t", url: "https://example.test/a", read, second: secondA(), verify: verifyA(read), compare: null, docText: text });
    expect(hasRun(JSON.stringify(e), text)).toBe(false);
  });

  it("検査の行: 任意の項目が落ちても pass を true にしない行（radius_sentence）が出る。走らなかった検査は行にしない", () => {
    const e = make();
    expect(e.verifyPass).toBe(true);
    expect(e.checks.find((c) => c.check === "quote_exists")!.pass).toBe(true);
    expect(e.checks.find((c) => c.check === "radius_sentence")!.pass).toBe(true);
    // 前の事例を渡していないので chronology は走っていない
    expect(e.checks.map((c) => c.check)).not.toContain("chronology");
    expect(e.compare).toEqual({ match: true, mismatches: [] });
    expect(e.tamperedDemo).toBeNull();
  });

  it("引用に県名がなく、取得元の県で通した場合は『落ちた』にしない（注記つきで通過）", () => {
    const read = readA();
    read.prefecture = q("岡山県", "津山市の採卵鶏農場（飼養羽数約43万羽）で、");
    const verify = verifyRead(read, { text: TEXT_A, hasTextLayer: true, season: 2025 }, geo, null, { sourcePrefCode: "33" });
    expect(verify.pass).toBe(true);
    expect(verify.issues.some((i) => i.detail === "prefecture_from_source")).toBe(true);
    const e = toBackstageEntry({ id: "t", url: "https://example.test/a", read, second: secondA(), verify, compare: null, docText: TEXT_A });
    const c = e.checks.find((x) => x.check === "value_in_quote")!;
    expect(c.pass).toBe(true);
    expect(c.detail).toContain("取得元");
    expect(e.droppedOptional).toEqual([]);
  });

  it("都道府県が null で、取得元の県で補った場合も『落ちた』にしない（補った注記つきで通過）", () => {
    const read = readA();
    read.prefecture = q(null, null);
    const verify = verifyRead(read, { text: TEXT_A, hasTextLayer: true, season: 2025 }, geo, null, { sourcePrefCode: "33" });
    expect(verify.pass).toBe(true);
    expect(verify.issues.some((i) => i.detail === "prefecture_filled_from_source")).toBe(true);
    const e = toBackstageEntry({ id: "t", url: "https://example.test/a", read, second: secondA(), verify, compare: null, docText: TEXT_A });
    const c = e.checks.find((x) => x.check === "value_in_quote")!;
    expect(c.pass).toBe(true);
    expect(c.detail).toContain("補いました");
  });

  it("二重読みがない（失敗した）ときは second が空で compare は null", () => {
    const read = readA();
    const e = toBackstageEntry({ id: "t", url: "https://example.test/a", read, second: null, verify: verifyA(read), compare: null, docText: TEXT_A });
    expect(e.second).toEqual([]);
    expect(e.compare).toBeNull();
  });
});

describe("tamperRadius（農場数を半径にすり替える）", () => {
  it("半径が任意の項目なので pass は true のまま、radius_sentence が出て radiiKm が落ちる", () => {
    const base = verifyA();
    expect(base.droppedOptional).not.toContain("radiiKm");
    const tampered = tamperRadius(readA());
    expect(tampered).not.toBeNull();
    const v = verifyA(tampered!);
    expect(v.pass).toBe(true);
    expect(v.issues.map((i) => i.check)).toContain("radius_sentence");
    expect(v.issues.find((i) => i.check === "radius_sentence")!.mandatory).toBe(false);
    expect(v.droppedOptional).toContain("radiiKm");
    expect(v.normalized!.radiiKm).toEqual([]);
  });

  it("元を書き換えない。半径の行がなければ null", () => {
    const r = readA();
    const before = JSON.stringify(r);
    tamperRadius(r);
    expect(JSON.stringify(r)).toBe(before);
    expect(tamperRadius({ ...readA(), radiiKm: [] })).toBeNull();
  });

  it("すり替えた値は、その引用の中で半径の文にならない数（元の値と違う）", () => {
    const t = tamperRadius(readA())!;
    expect(t.radiiKm[0]!.km).not.toBe(3);
    expect(t.radiiKm[0]!.quote).toBe(readA().radiiKm[0]!.quote);
  });
});

describe("tamperSecondMuni（別の読み手の市町村を入れ替える）", () => {
  it("compare に municipality の食い違いが出る。元は一致", () => {
    expect(compareReads(readA(), secondA()).match).toBe(true);
    const t = tamperSecondMuni(secondA(), "米子市");
    expect(t.municipality).toBe("米子市");
    const c = compareReads(readA(), t);
    expect(c.match).toBe(false);
    expect(c.mismatches).toContain("municipality");
  });

  it("元を書き換えない", () => {
    const s = secondA();
    tamperSecondMuni(s, "米子市");
    expect(s.municipality).toBe("津山市");
  });
});

describe("parseBackstageArgs", () => {
  it("引数なしは何も許さない", () => {
    expect(parseBackstageArgs([])).toEqual({ yes: false, fetch: false, remeasure: false });
    expect(parseBackstageArgs(["--yes", "--fetch", "--remeasure"])).toEqual({ yes: true, fetch: true, remeasure: true });
  });
  it("知らない引数は throw（綴り違いで有料の実行にならない）", () => {
    expect(() => parseBackstageArgs(["--y"])).toThrow();
  });
});

// ── 実行（偽の client。有料の呼び出しはしない）──
const wirePrimary = (r: ReadResult) => ({
  kind: r.kind,
  kindQuote: r.kindQuote,
  multipleCases: r.multipleCases,
  facts: (["prefecture", "municipality", "birdUse", "headCount"] as const).flatMap((f) => {
    const x = r[f];
    return x.value === null ? [] : [{ field: f, value: String(x.value), quote: x.quote ?? "" }];
  }),
  primaryStage: r.primaryStage,
  primaryDate: r.primaryDate,
  primaryDateQuote: r.primaryDateQuote,
  stageEvents: [],
  radiiKm: r.radiiKm,
  estimates: [],
  wildBirds: [],
});

function docs(): BackstageDoc[] {
  return [
    {
      id: "t-confirmed",
      title: "【試験用】確定",
      url: "https://example.test/confirmed",
      contentType: "html",
      sourcePrefCode: "33",
      announcedOn: "2025-12-20",
      eventOrder: 5,
      expect: { kind: "confirmed", muniCode: "33203", primaryStage: "confirmed", primaryDate: "2025-12-20" },
    },
    {
      id: "t-suspected",
      title: "【試験用】疑い",
      url: "https://example.test/suspected",
      contentType: "html",
      sourcePrefCode: "33",
      announcedOn: "2025-12-19",
      eventOrder: 4,
      expect: { kind: "suspected", muniCode: "33203", primaryStage: "suspected", primaryDate: "2025-12-19" },
    },
  ];
}

interface Rig {
  dir: string;
  deps: BackstageDeps;
  create: ReturnType<typeof vi.fn>;
  makeClient: ReturnType<typeof vi.fn>;
  logs: string[];
  file: (name: string) => string;
  read: <T>(name: string) => T;
}

function rig(opts: { docs?: BackstageDoc[]; cache?: boolean } = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backstage-"));
  const cacheDir = path.join(dir, "cache");
  fs.mkdirSync(cacheDir);
  const files = { docs: path.join(dir, "docs.json"), backstage: path.join(dir, "backstage.json"), usage: path.join(dir, "measured-usage.json"), scenario: path.join(dir, "scenario.json") };
  fs.writeFileSync(files.docs, JSON.stringify({ docs: opts.docs ?? docs() }, null, 2));
  fs.writeFileSync(files.backstage, JSON.stringify(UNMEASURED_BACKSTAGE, null, 2) + "\n");
  fs.writeFileSync(files.usage, JSON.stringify(UNMEASURED_USAGE, null, 2) + "\n");
  fs.copyFileSync(path.join(ROOT, "data", "replay", "scenario.json"), files.scenario);
  if (opts.cache !== false) {
    fs.writeFileSync(path.join(cacheDir, "t-confirmed.html"), `<html><head><title>x</title></head><body><main>${TEXT_A.split("\n").map((l) => `<p>${l}</p>`).join("")}</main></body></html>`);
    fs.writeFileSync(path.join(cacheDir, "t-suspected.html"), `<html><head><title>x</title></head><body><main>${TEXT_B.split("\n").map((l) => `<p>${l}</p>`).join("")}</main></body></html>`);
  }
  const usageOf = (model: string) => ({ input_tokens: model === S.primaryModel ? 1000 : 400, output_tokens: model === S.primaryModel ? 300 : 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    const content = JSON.stringify(params.messages);
    const isA = content.includes("【試験用】確定");
    const primary = params.model === S.primaryModel;
    const body = primary ? wirePrimary(isA ? readA() : readB()) : isA ? secondA() : secondB();
    return { id: "m", type: "message", role: "assistant", model: params.model, stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(body) }], usage: usageOf(params.model) } as unknown as Anthropic.Message;
  });
  const makeClient = vi.fn(() => ({ messages: { create } }) as unknown as Anthropic);
  const logs: string[] = [];
  const deps: BackstageDeps = {
    files,
    cacheDir,
    log: (l) => logs.push(l),
    makeClient,
    loadGeo: async () => geo,
    now: () => new Date("2026-11-06T01:00:00Z"),
  };
  return { dir, deps, create, makeClient, logs, file: (n) => path.join(dir, n), read: <T,>(n: string) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as T };
}

describe("runBackstage: --yes がなければ有料の client を作らない", () => {
  it("引数なし: client を作らず、何も書かず、exit 2。計画（文書数と呼び出し回数）を出す", async () => {
    const r = rig();
    const before = fs.readFileSync(r.file("backstage.json"), "utf8");
    const code = await runBackstage([], r.deps);
    expect(code).toBe(2);
    expect(r.makeClient).not.toHaveBeenCalled();
    expect(r.create).not.toHaveBeenCalled();
    expect(fs.readFileSync(r.file("backstage.json"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(r.deps.cacheDir, "t-confirmed.reads.json"))).toBe(false);
    expect(r.logs.join("\n")).toContain("--yes");
    expect(r.logs.join("\n")).toMatch(/4 回/); // 2 文書 × 2 つの読み手
  });

  it("--yes でも控え（原本）がなければ、client を作る前に止まり、足りない id だけを出す", async () => {
    const r = rig({ cache: false });
    const code = await runBackstage(["--yes"], r.deps);
    expect(code).toBe(1);
    expect(r.makeClient).not.toHaveBeenCalled();
    const out = r.logs.join("\n");
    expect(out).toContain("t-confirmed");
    expect(out).toContain("t-suspected");
  });

  it("--fetch だけなら原本の控えを取るが（無料）、client は作らず、読みもしない。取れないものは再試行しない", async () => {
    const r = rig({ cache: false });
    const fetchOne = vi.fn(async (d: BackstageDoc) => (d.id === "t-confirmed" ? Buffer.from(`<main><p>${TEXT_A}</p></main>`) : null));
    const code = await runBackstage(["--fetch"], { ...r.deps, fetchOne });
    expect(code).toBe(2);
    expect(fetchOne).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(r.deps.cacheDir, "t-confirmed.html"))).toBe(true);
    expect(fs.existsSync(path.join(r.deps.cacheDir, "t-suspected.html"))).toBe(false);
    expect(r.makeClient).not.toHaveBeenCalled();
    expect(r.logs.join("\n")).toContain("t-suspected");
  });

  it("知らない引数は throw で、client を作らない", async () => {
    const r = rig();
    await expect(runBackstage(["--yse"], r.deps)).rejects.toThrow();
    expect(r.makeClient).not.toHaveBeenCalled();
  });

  it("実際の入口（scripts/build-backstage.ts）を引数なしで動かすと、鍵がなくても何もせず exit 2", async () => {
    const { spawnSync } = await import("node:child_process");
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const before = fs.readFileSync(path.join(ROOT, "data", "replay", "backstage.json"), "utf8");
    const res = spawnSync("npx", ["tsx", "scripts/build-backstage.ts"], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
    expect(res.status).toBe(2);
    expect(res.stdout).toContain("--yes");
    expect(fs.readFileSync(path.join(ROOT, "data", "replay", "backstage.json"), "utf8")).toBe(before);
  }, 130_000);
});

describe("runBackstage --yes（偽の client）", () => {
  it("読み、検査し、tamper を掛けて、本当に落ちた結果だけを tamperedDemo に書く", async () => {
    const r = rig();
    const code = await runBackstage(["--yes"], r.deps);
    expect(r.logs.join("\n")).not.toContain("エラー");
    expect(code).toBe(0);
    expect(r.makeClient).toHaveBeenCalledTimes(1);
    expect(r.create).toHaveBeenCalledTimes(4);

    const file = r.read<BackstageFile>("backstage.json");
    expect(file.status).toBe("measured");
    expect(file.measuredAt).toBe("2026-11-06T10:00:00+09:00");
    expect(file.entries.map((e) => e.id)).toEqual(["t-confirmed", "t-suspected"]);
    const [a, b] = file.entries;
    expect(a!.tamperedDemo).toMatchObject({ field: "radiiKm", rejectedBy: "radius_sentence" });
    expect(a!.tamperedDemo!.before).not.toBe(a!.tamperedDemo!.after);
    expect(b!.tamperedDemo).toMatchObject({ field: "municipality", rejectedBy: "compare", before: "津山市", after: "米子市" });
    for (const e of file.entries) {
      expect([...keysOf(e)]).not.toContain("quote");
      expect(hasRun(JSON.stringify(e), TEXT_A) || hasRun(JSON.stringify(e), TEXT_B)).toBe(false);
    }
  });

  it("実測の使用量を合算する（文書数、モデルごとの 4 つのトークン）", async () => {
    const r = rig();
    await runBackstage(["--yes"], r.deps);
    const u = r.read<MeasuredUsage>("measured-usage.json");
    expect(u.status).toBe("measured");
    expect(u.documents).toBe(2);
    expect(u.measuredAt).toBe("2026-11-06T10:00:00+09:00");
    expect(u.byModel[S.primaryModel]).toEqual({ inputTokens: 2000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(u.byModel[S.secondModel]).toEqual({ inputTokens: 800, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("scenario の backstageId を、その文書の出来事にだけ入れる。ほかの項目は変えない", async () => {
    const r = rig();
    const before = r.read<ReplayScenario>("scenario.json");
    await runBackstage(["--yes"], r.deps);
    const after = r.read<ReplayScenario>("scenario.json");
    expect(after.events.find((e) => e.order === 5)!.backstageId).toBe("t-confirmed");
    expect(after.events.find((e) => e.order === 4)!.backstageId).toBe("t-suspected");
    expect(after.events.filter((e) => e.backstageId !== null)).toHaveLength(2);
    expect(after.events.map((e) => ({ ...e, backstageId: null }))).toEqual(before.events.map((e) => ({ ...e, backstageId: null })));
  });

  it("書いたデータは検査器（checkBackstageData）を通る", async () => {
    const r = rig();
    await runBackstage(["--yes"], r.deps);
    const problems = checkBackstageData({
      docs: { docs: docs() },
      backstage: r.read<BackstageFile>("backstage.json"),
      usage: r.read<MeasuredUsage>("measured-usage.json"),
      scenario: r.read<ReplayScenario>("scenario.json"),
    });
    expect(problems).toEqual([]);
  });

  it("読みの結果は控え（*.reads.json）に残り、再実行は支払わない。測り済みは --remeasure がなければ上書きしない", async () => {
    const r = rig();
    await runBackstage(["--yes"], r.deps);
    expect(fs.existsSync(path.join(r.deps.cacheDir, "t-confirmed.reads.json"))).toBe(true);
    r.create.mockClear();
    r.makeClient.mockClear();
    const code = await runBackstage(["--yes"], r.deps);
    expect(code).toBe(2);
    expect(r.makeClient).not.toHaveBeenCalled();
    const again = await runBackstage(["--yes", "--remeasure"], r.deps);
    expect(again).toBe(0);
    expect(r.create).not.toHaveBeenCalled(); // 控えを使う
  });

  it("scenario と違えば、項目名だけを出して exit 1。ファイルは書かない。直した後の再実行は支払わない", async () => {
    const bad = docs();
    bad[1] = { ...bad[1]!, expect: { ...bad[1]!.expect, muniCode: "31202" } };
    const r = rig({ docs: bad });
    const code = await runBackstage(["--yes"], r.deps);
    expect(code).toBe(1);
    const out = r.logs.join("\n");
    expect(out).toContain("t-suspected");
    expect(out).toContain("muniCode");
    expect(out).not.toContain("津山市で簡易検査陽性"); // 本文を出さない
    expect(r.read<BackstageFile>("backstage.json").status).toBe("unmeasured");
    expect(r.read<MeasuredUsage>("measured-usage.json").status).toBe("unmeasured");
    expect(r.create).toHaveBeenCalledTimes(4);
    // 直して再実行
    fs.writeFileSync(r.file("docs.json"), JSON.stringify({ docs: docs() }));
    r.create.mockClear();
    expect(await runBackstage(["--yes"], r.deps)).toBe(0);
    expect(r.create).not.toHaveBeenCalled();
  });

  it("出来事に結びつかない文書の食い違いは止めない（項目名を知らせて書く）。結びつく文書の食い違いは止める", async () => {
    const loose = docs();
    loose[1] = { ...loose[1]!, eventOrder: null, expect: { ...loose[1]!.expect, muniCode: "31202" } };
    const r = rig({ docs: loose });
    const code = await runBackstage(["--yes"], r.deps);
    expect(code).toBe(0);
    const out = r.logs.join("\n");
    expect(out).toContain("t-suspected");
    expect(out).toContain("muniCode");
    const file = r.read<BackstageFile>("backstage.json");
    expect(file.entries.map((e) => e.id)).toEqual(["t-confirmed", "t-suspected"]);
    expect(r.read<ReplayScenario>("scenario.json").events.filter((e) => e.backstageId !== null)).toHaveLength(1);
  });

  it("拒否や形式の誤りが出たらそこで止まり、書かない", async () => {
    const r = rig();
    r.create.mockImplementationOnce(async (params: Anthropic.MessageCreateParamsNonStreaming) => ({ id: "m", type: "message", role: "assistant", model: params.model, stop_reason: "refusal", stop_details: { category: "x" }, content: [], usage: { input_tokens: 10, output_tokens: 0 } }) as unknown as Anthropic.Message);
    const code = await runBackstage(["--yes"], r.deps);
    expect(code).toBe(1);
    expect(r.read<BackstageFile>("backstage.json").status).toBe("unmeasured");
    expect(r.logs.join("\n")).toContain("refusal");
  });
});

describe("checkBackstageData", () => {
  const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "replay", "scenario.json"), "utf8")) as ReplayScenario;
  const base = (): Parameters<typeof checkBackstageData>[0] => ({
    docs: { docs: docs() },
    backstage: { ...UNMEASURED_BACKSTAGE },
    usage: { ...UNMEASURED_USAGE },
    scenario,
  });

  it("測っていない状態: entries が空、measuredAt が null、使用量が 0 のときだけ問題なし", () => {
    expect(checkBackstageData(base())).toEqual([]);
    const b = base();
    b.backstage = { ...UNMEASURED_BACKSTAGE, measuredAt: "2026-11-06T10:00:00+09:00" };
    expect(checkBackstageData(b).length).toBeGreaterThan(0);
    const c = base();
    c.usage = { ...UNMEASURED_USAGE, documents: 3 };
    expect(checkBackstageData(c).length).toBeGreaterThan(0);
  });

  it("測っていない状態で backstageId が入っていれば問題（指す先がない）", () => {
    const b = base();
    const events = scenario.events.map((e) => (e.order === 5 ? { ...e, backstageId: "t-confirmed" } : e));
    b.scenario = { ...scenario, events };
    expect(checkBackstageData(b).join("\n")).toContain("backstageId");
  });

  it("測った状態の規則: 全文書に項目、backstageId、2 行以上の tamperedDemo（radius_sentence と compare）、市町村と日付の一致", () => {
    const r = JSON.parse(JSON.stringify(scenario)) as ReplayScenario;
    r.events.find((e) => e.order === 5)!.backstageId = "t-confirmed";
    r.events.find((e) => e.order === 4)!.backstageId = "t-suspected";
    const mk = (id: string, muni: string, date: string, demo: BackstageFile["entries"][number]["tamperedDemo"]): BackstageFile["entries"][number] => ({
      id,
      documentUrl: `https://example.test/${id}`,
      kind: "confirmed",
      primary: [
        { field: "municipality", value: muni, matchedWord: muni },
        { field: "primaryDate", value: date, matchedWord: null },
      ],
      second: [],
      checks: [],
      verifyPass: true,
      droppedOptional: [],
      compare: { match: true, mismatches: [] },
      tamperedDemo: demo,
    });
    const good: Parameters<typeof checkBackstageData>[0] = {
      docs: { docs: docs() },
      scenario: r,
      backstage: {
        status: "measured",
        measuredAt: "2026-11-06T10:00:00+09:00",
        entries: [
          mk("t-confirmed", "津山市", "2025-12-20 09:00", { field: "radiiKm", before: "3km", after: "1km", rejectedBy: "radius_sentence" }),
          mk("t-suspected", "津山市", "2025-12-19", { field: "municipality", before: "津山市", after: "米子市", rejectedBy: "compare" }),
        ],
      },
      usage: { status: "measured", documents: 2, byModel: { m: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }, measuredAt: "2026-11-06T10:00:00+09:00" },
    };
    expect(checkBackstageData(good)).toEqual([]);

    const noRadius = JSON.parse(JSON.stringify(good)) as typeof good;
    noRadius.backstage.entries[0]!.tamperedDemo = null;
    expect(checkBackstageData(noRadius).join("\n")).toMatch(/tamperedDemo/);

    const wrongMuni = JSON.parse(JSON.stringify(good)) as typeof good;
    wrongMuni.backstage.entries[1]!.primary[0]!.value = "米子市";
    expect(checkBackstageData(wrongMuni).join("\n")).toMatch(/municipality/);

    const wrongDate = JSON.parse(JSON.stringify(good)) as typeof good;
    wrongDate.backstage.entries[1]!.primary[1]!.value = "2025-12-21";
    expect(checkBackstageData(wrongDate).join("\n")).toMatch(/primaryDate/);

    const noId = JSON.parse(JSON.stringify(good)) as typeof good;
    noId.scenario.events.find((e) => e.order === 4)!.backstageId = null;
    expect(checkBackstageData(noId).join("\n")).toMatch(/backstageId/);

    const noUsage = JSON.parse(JSON.stringify(good)) as typeof good;
    noUsage.usage = { ...UNMEASURED_USAGE };
    expect(checkBackstageData(noUsage).join("\n")).toMatch(/usage|使用量/);
  });
});
