// 読み取りの試験の正解（evals/answers/*.json）の検査（I-06、設計書 §16）。
// 公開の試験は answers と作った文書だけを読む。原文の控え（data/private/fixtures/eval/）が要る検査は describeFixture を通す。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPrefDomainHost } from "@hpai/shared/pref";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import { muniCoreName } from "@hpai/shared/read/names";
import { headCountInQuote, radiusInQuote } from "@hpai/shared/read/quote";
import { normalizeForMatch } from "@hpai/shared/text";
import type { HistoryCase } from "@hpai/shared/types";
import { decodeBody, extractHtml } from "../../functions/src/watch/extract";
import { describeFixture } from "../../functions/test/helpers/fixtures";
import { ANSWERS_DIR, FABRICATED_DIR, FIXTURE_DIR, type EvalAnswer } from "../../evals/types";
import { answerFilePath, loadAnswers, loadEvalDocument } from "../../evals/fetch";
import { measureDetection } from "../../evals/detection";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CASES_JSON = path.join(ROOT, "data", "history", "cases.json");
const answers = loadAnswers(ANSWERS_DIR);
const count = (k: EvalAnswer["kind"]) => answers.filter((a) => a.kind === k).length;

/** 県の代表。野鳥の文書は行の県。県のない文書は null。 */
const prefOf = (a: EvalAnswer) => a.prefCode ?? a.wildBirds?.[0]?.prefCode ?? null;

describe("正解の量と偏り", () => {
  it("30 文書以上", () => {
    expect(answers.length).toBeGreaterThanOrEqual(30);
  });

  it("種類ごとの最低数", () => {
    expect(count("suspected")).toBeGreaterThanOrEqual(4);
    expect(count("confirmed")).toBeGreaterThanOrEqual(5);
    expect(count("progress")).toBeGreaterThanOrEqual(5);
    expect(count("control_done")).toBeGreaterThanOrEqual(4);
    expect(count("zone_lifted")).toBeGreaterThanOrEqual(5);
    expect(count("wild_bird")).toBeGreaterThanOrEqual(3);
    expect(count("other_pref")).toBeGreaterThanOrEqual(2);
    expect(count("negated")).toBeGreaterThanOrEqual(2);
    expect(count("notice") + count("drill") + count("irrelevant")).toBeGreaterThanOrEqual(2);
  });

  it("4 都道府県以上で、1 県は全体の半分以下（正解の県と、取得元の県の両方で数える）", () => {
    const byPref = new Map<string, number>();
    for (const a of answers) {
      const p = prefOf(a);
      if (p) byPref.set(p, (byPref.get(p) ?? 0) + 1);
    }
    expect(byPref.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...byPref.values())).toBeLessThanOrEqual(answers.length / 2);
    // 岡山のページから取った姫路の 2 本は、正解の県が空でも取得元は岡山として数える
    const byHost = new Map<string, number>();
    for (const a of answers) {
      if (a.url) byHost.set(new URL(a.url).hostname, (byHost.get(new URL(a.url).hostname) ?? 0) + 1);
    }
    expect(Math.max(...byHost.values())).toBeLessThanOrEqual(answers.length / 2);
  });

  it("京都、埼玉、茨城、宮崎、岐阜、三重のうち 3 県以上と岡山がある", () => {
    const prefs = new Set(answers.map(prefOf));
    expect(prefs.has("33")).toBe(true);
    const others = ["26", "11", "08", "45", "21", "24"].filter((p) => prefs.has(p));
    expect(others.length).toBeGreaterThanOrEqual(3);
  });

  it("環境省の栗原の疑いと陰性確定、岡山のページの姫路に係る 2 本、特報 2 本がある", () => {
    const ids = answers.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["w-moe-kurihara-suspected", "w-moe-kurihara-negative"]));
    expect(answers.filter((a) => a.kind === "other_pref" && a.url?.includes("pref.okayama.jp")).length).toBeGreaterThanOrEqual(2);
    expect(ids).toEqual(expect.arrayContaining(["p-okayama-culling", "d-okayama-special"]));
  });

  it("野鳥の否定の実例がある。家きんの否定は実例がなければ作った文書", () => {
    const wild = answers.filter((a) => a.kind === "wild_bird").flatMap((a) => a.wildBirds ?? []);
    expect(wild.some((w) => w.test === "negative")).toBe(true);
    expect(wild.some((w) => w.test === "screening_positive")).toBe(true);
    expect(wild.some((w) => w.test === "hpai_confirmed")).toBe(true);
    for (const a of answers.filter((x) => x.kind === "negated")) expect(a.fabricated).toBe(true);
  });
});

describe("正解の形", () => {
  it("id は英数字と - と _ で 40 字以内、重複なし。file は id で始まる", () => {
    const ids = answers.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of answers) {
      expect(a.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      expect(a.file).toMatch(new RegExp(`^${a.id}\\.(pdf|html|txt)$`));
    }
  });

  it("quote、text、body のキーがなく、各ファイルは短い（本文を持たない）", () => {
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          expect(["quote", "text", "body"], `${where}.${k}`).not.toContain(k);
          walk(x, `${where}.${k}`);
        }
      }
    };
    for (const a of answers) {
      walk(a, a.id);
      expect(fs.statSync(path.join(ANSWERS_DIR, `${a.id}.json`)).size, a.id).toBeLessThan(2000);
      expect(a.title.length, a.id).toBeLessThanOrEqual(120);
    }
  });

  it("県コード、日付、種類と段階の組み合わせ、野鳥の行が決まりどおり", () => {
    const stagesOf: Record<string, Array<string | null>> = {
      suspected: ["suspected"],
      confirmed: ["confirmed"],
      control_done: ["control_done"],
      zone_lifted: ["shipment_lifted", "movement_lifted", "surveillance_lifted"],
      negated: [null],
      progress: ["culling_done", null],
      wild_bird: [null],
      other_pref: [null],
      drill: [null],
      notice: [null],
      irrelevant: [null],
    };
    for (const a of answers) {
      if (a.prefCode !== null) expect(a.prefCode, a.id).toMatch(/^(0[1-9]|[1-3]\d|4[0-7])$/);
      if (a.primaryDate !== null) expect(a.primaryDate, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stagesOf[a.kind], `${a.id} の kind と段階`).toContain(a.primaryStage);
      expect(a.primaryStage === null, `${a.id}: 段階と日付は一緒に入れるか、一緒に空にする`).toBe(a.primaryDate === null);
      expect(a.wildBirds !== null, a.id).toBe(a.kind === "wild_bird");
      for (const w of a.wildBirds ?? []) {
        expect(w.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["screening_positive", "hpai_confirmed", "negative"]).toContain(w.test);
      }
      if (["suspected", "confirmed", "control_done", "zone_lifted", "negated"].includes(a.kind)) {
        expect(a.prefCode, `${a.id} は県を持つ`).not.toBeNull();
        expect(a.muniName, `${a.id} は市町村を持つ`).not.toBeNull();
      }
      if (["other_pref", "drill", "notice", "irrelevant", "wild_bird"].includes(a.kind)) {
        expect([a.prefCode, a.muniName, a.headCount, a.nationalNo], a.id).toEqual([null, null, null, null]);
      }
    }
  });

  it("作った文書は url なし、冒頭に断りがあり、実在の連絡先や社名を含まない。実在の文書は公式のホストの https", () => {
    for (const a of answers) {
      if (a.fabricated) {
        expect(a.url, a.id).toBeNull();
        const text = fs.readFileSync(path.join(FABRICATED_DIR, a.file!), "utf8");
        expect(text.split("\n")[0], a.id).toContain("試験のために作った文書です");
        expect(text, a.id).not.toMatch(/https?:\/\/|@|\d{2,4}-\d{2,4}-\d{3,4}|株式会社|有限会社|合同会社/u);
      } else {
        const u = new URL(a.url!);
        expect(u.protocol, a.id).toBe("https:");
        expect(u.hostname.endsWith(".go.jp") || u.hostname.endsWith(".lg.jp") || isPrefDomainHost(u.hostname), `${a.id} のホスト ${u.hostname}`).toBe(true);
      }
    }
  });

  it("作った文書のファイルがすべてあり、answers のない文書がない", () => {
    const made = answers.filter((a) => a.fabricated).map((a) => a.file);
    expect(fs.readdirSync(FABRICATED_DIR).sort()).toEqual([...made].sort());
  });
});

describe("正解の中身", () => {
  it("京都の型（区域の外の自粛の半径）の文書があり、正解の radiiKm に自粛の値を入れない", () => {
    const doc = fs.readFileSync(path.join(FABRICATED_DIR, "f-kyoto-type.txt"), "utf8");
    expect(doc).toMatch(/半径10km圏内.*自粛/u);
    const a = answers.find((x) => x.id === "f-kyoto-type")!;
    expect(a.radiiKm).toEqual([]);
    expect(radiusInQuote(10, doc)).toBe(false);
    // 実物にも同じ型（岐阜の半径 3km の自粛、京都の 10km 圏内の自粛）がある
    expect(answers.find((x) => x.id === "s-gifu-pref")!.radiiKm).toEqual([]);
    expect(answers.find((x) => x.id === "s-kyoto-meeting")!.radiiKm).toEqual([]);
  });

  it("作った文書の radiiKm は、文書の区域の文から取れる（検証と同じ規則）", () => {
    for (const a of answers.filter((x) => x.fabricated)) {
      const text = fs.readFileSync(path.join(FABRICATED_DIR, a.file!), "utf8");
      for (const km of a.radiiKm) expect(radiusInQuote(km, text), `${a.id} ${km}km`).toBe(true);
    }
  });

  it("作った文書の市町村と日付は、文書に書いてある", () => {
    for (const a of answers.filter((x) => x.fabricated && x.muniName)) {
      const text = normalizeForMatch(fs.readFileSync(path.join(FABRICATED_DIR, a.file!), "utf8"));
      expect(text, a.id).toContain(normalizeForMatch(a.muniName!));
    }
  });

  it("confirmed の正解は cases.json の市町村と日付に一致する（実在の文書）", () => {
    const history = (JSON.parse(fs.readFileSync(CASES_JSON, "utf8")) as HistoryCase[]).filter((h) => !h.related);
    const real = answers.filter((a) => a.kind === "confirmed" && !a.fabricated);
    expect(real.length).toBeGreaterThanOrEqual(5);
    for (const a of real) {
      const hit = history.find((h) => h.season === a.season && h.prefCode === a.prefCode && muniCoreName(h.muniNameThen) === muniCoreName(a.muniName!) && h.date === a.primaryDate);
      expect(hit, `${a.id} が cases.json にない`).toBeDefined();
      if (a.nationalNo !== null) expect(hit!.no, a.id).toBe(a.nationalNo);
    }
  });
});

// 原文の控え（evals/fetch.ts が data/private/fixtures/eval/ に置く）と正解を見比べる
const MAFF_FIXTURES = path.join(ROOT, "data/private/fixtures/maff");
const realFiles = [...["2510", "2511", "2512", "2601", "2602", "2603", "2604"].map((m) => path.join(MAFF_FIXTURES, `arc-${m}.html`)), ...answers.filter((a) => !a.fabricated).map((a) => answerFilePath(a))];
describeFixture("正解と原文の控え", realFiles as string[], () => {
  const docs = new Map<string, NonNullable<Awaited<ReturnType<typeof loadEvalDocument>>>>();
  it("控えがすべて読める（PDF は文字層あり）", async () => {
    for (const a of answers) {
      const d = await loadEvalDocument(a);
      expect(d, a.id).not.toBeNull();
      expect(d!.hasTextLayer, a.id).toBe(true);
      docs.set(a.id, d!);
    }
  });

  it("正解の市町村、日付、羽数、半径は、原文に書いてある", () => {
    for (const a of answers) {
      const text = normalizeForMatch(docs.get(a.id)!.fullText);
      if (a.muniName) expect(text.replace(/ヶ/gu, "ケ"), `${a.id} の市町村`).toContain(normalizeForMatch(a.muniName).replace(/^.*郡/u, "").replace(/ヶ/gu, "ケ"));
      if (a.primaryDate) {
        const [, m, d] = a.primaryDate.split("-");
        expect(text, `${a.id} の日付`).toContain(`${Number(m)}月${Number(d)}日`);
      }
      for (const w of a.wildBirds ?? []) {
        const [, m, d] = w.date.split("-");
        expect(text, `${a.id} の野鳥の日付`).toMatch(new RegExp(`${Number(m)}(月|/)${Number(d)}`, "u"));
      }
      if (a.headCount !== null) expect(headCountInQuote(a.headCount, text) || text.includes(String(a.headCount)), `${a.id} の羽数`).toBe(true);
      for (const km of a.radiiKm) expect(radiusInQuote(km, docs.get(a.id)!.fullText) || radiusInQuote(km, text), `${a.id} の半径 ${km}`).toBe(true);
      if (a.nationalNo !== null) expect(text, `${a.id} の国内何例目`).toContain(`${a.nationalNo}例目`);
    }
  });

  it("国の発表の title は、月別一覧のリンクの文字列（本番の題）と同じ", () => {
    const links = ["2510", "2511", "2512", "2601", "2602", "2603", "2604"].flatMap((m) =>
      extractHtml(decodeBody(fs.readFileSync(path.join(MAFF_FIXTURES, `arc-${m}.html`)), "text/html"), `https://www.maff.go.jp/j/press/arc/${m}.html`).links,
    );
    const maff = answers.filter((a) => a.url && new URL(a.url).hostname === "www.maff.go.jp");
    expect(maff.length).toBeGreaterThanOrEqual(10);
    for (const a of maff) expect(links.find((l) => l.href === a.url)?.text, a.id).toBe(a.title);
  });

  it("京都の型の実物（岐阜、京都）に、自粛の文があり、その値を radiiKm に入れていない", () => {
    expect(normalizeForMatch(docs.get("s-gifu-pref")!.fullText)).toMatch(/半径3km以内の区域の農場に対して、鶏等の移動自粛/u);
    expect(normalizeForMatch(docs.get("s-kyoto-meeting")!.fullText)).toMatch(/10km圏内の周辺農場2農場に鶏・卵の移動自粛を要請/u);
  });

  it("発生の語の判定（題 + 本文）: 津山の会議資料と疑似患畜の確認は true、学校の臨時休業と栗原の陰性確定は false", () => {
    const has = (id: string) => hasOutbreakWords(`${answers.find((a) => a.id === id)!.title}\n${docs.get(id)!.text}`);
    expect(has("s-okayama-meeting")).toBe(true);
    expect(has("c-maff-okayama")).toBe(true);
    expect(has("i-gunma-school")).toBe(false);
    expect(has("w-moe-kurihara-negative")).toBe(false);
  });
});

// 国の月別一覧の控え（I-01）で検知の数字を測る
describeFixture("検知の数字（国の月別一覧の控え）", [path.join(ROOT, "data/private/fixtures/maff/arc-2510.html"), CASES_JSON], () => {
  it("題 70 件の分類と前季 24 件の一致を測る", async () => {
    const d = await measureDetection(path.join(ROOT, "data/private/fixtures/maff"), CASES_JSON);
    expect(d).toEqual({ prevSeason: 24, titles: 70 });
  });
});

describe("検知の数字（控えがなければ測らない）", () => {
  it("控えのない場所では null（0 にしない）", async () => {
    expect(await measureDetection(path.join(ROOT, "no-such-dir"), CASES_JSON)).toBeNull();
  });
});

describe("置き場所", () => {
  it("原文の控えの置き場所は公開しない data/private/ の下", () => {
    expect(path.relative(ROOT, FIXTURE_DIR)).toBe(path.join("data", "private", "fixtures", "eval"));
  });
});
