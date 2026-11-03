// 読み取りの試験の採点、検知の数え方、見積もり、Batch の依頼の形（I-06）。有料の API は呼ばない。
import type Anthropic from "@anthropic-ai/sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import type { ReadResult, SecondReadResult } from "@hpai/shared/read/types";
import { DEFAULT_RUNTIME_SETTINGS, type EvalMetricName, type EvalSummary } from "@hpai/shared/types";
import type { ReadAttempt } from "../../functions/src/read/claude";
import { loadScriptGeoStore } from "../lib/geoStore";
import path from "node:path";
import { describeFixture } from "../../functions/test/helpers/fixtures";
import { FIXTURE_DIR, type EvalAnswer } from "../../evals/types";
import { loadAnswers } from "../../evals/fetch";
import { ANSWERS_DIR } from "../../evals/types";
import { evalPasses, loadTamperBase, rerunNeeded, runCounts, runTamper, scoreDocument, summarize, tamperForSummary, toRunRecord, type DocScore } from "../../evals/score";
import {
  SEASON_TITLE_COUNTS,
  buildBackfillRequests,
  buildEvalRequests,
  chunkRequests,
  estimateRun,
  evalCustomIds,
  matchesSeasonTitleCounts,
  main,
  seasonMonths,
} from "../../evals/run";

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage;
const ok = <T>(value: T): ReadAttempt<T> => ({ ok: true, value, usage });
const fail = (reason: "refusal" | "format_error" | "max_tokens" | "api_error"): ReadAttempt<never> => ({ ok: false, reason, detail: reason, usage });

let geo: GeoStore;
let base: Awaited<ReturnType<typeof loadTamperBase>>;
beforeAll(async () => {
  geo = await loadScriptGeoStore();
  base = await loadTamperBase(geo);
});

const answers = loadAnswers(ANSWERS_DIR);
const answerOf = (id: string): EvalAnswer => answers.find((a) => a.id === id)!;

function score(over: { read?: Partial<ReadResult> | null; second?: Partial<SecondReadResult> | null; answer?: Partial<EvalAnswer>; auto?: boolean } = {}): DocScore {
  const read = over.read === null ? null : { ...base.goodRead, ...over.read };
  const second = over.second === null ? null : { ...base.goodSecond, ...over.second };
  return scoreDocument({
    answer: { ...base.answer, ...over.answer },
    text: base.text,
    hasTextLayer: true,
    primary: read ? ok(read as ReadResult) : fail("refusal"),
    second: second ? ok(second as SecondReadResult) : fail("format_error"),
    geo,
  });
}

describe("採点: 1 文書", () => {
  it("正しい読みは誤りなしで、自動で載る", () => {
    const s = score();
    expect(s.errors).toEqual({ muni: false, stage: false, date: false, headCount: false, kindClass: false });
    expect(s.decision.action).toBe("publish");
    expect(s.published).toBe(true);
    expect(s.publishedMandatoryError).toBe(false);
    expect(s.publishedHeadcountError).toBe(false);
  });

  it("表記の違い（ヶ/ケ、区、郡）は市町村の誤りにしない", () => {
    expect(score({ answer: { muniName: "朝倉市" }, read: { municipality: { value: "朝倉市", quote: base.goodRead.municipality.quote } } }).errors.muni).toBe(false);
    const ku = score({ answer: { muniName: "福岡市" }, read: { municipality: { value: "福岡市博多区", quote: "x" } } });
    expect(ku.errors.muni).toBe(false);
    const ke = score({ answer: { muniName: "金ヶ崎町" }, read: { municipality: { value: "金ケ崎町", quote: "x" } } });
    expect(ke.errors.muni).toBe(false);
  });

  it("市町村、段階、日付の読み違いを主の誤りに数える（日付は年が空なら月日で比べる）", () => {
    expect(score({ read: { municipality: { value: "久留米市", quote: base.goodRead.municipality.quote } } }).errors.muni).toBe(true);
    expect(score({ read: { primaryStage: "suspected", kind: "suspected" } }).errors.stage).toBe(true);
    expect(score({ read: { primaryDate: { year: 2025, month: 11, day: 9, time: null } } }).errors.date).toBe(true);
    expect(score({ read: { primaryDate: { year: 2024, month: 11, day: 8, time: null } } }).errors.date).toBe(true);
    expect(score({ read: { primaryDate: { year: null, month: 11, day: 8, time: null } } }).errors.date).toBe(false);
  });

  it("正解の段階が null（進捗の報）なら、日付は比べない", () => {
    const s = score({
      answer: { kind: "progress", primaryStage: null, primaryDate: null },
      read: { kind: "progress", primaryStage: null, primaryDate: { year: 2025, month: 11, day: 9, time: null } },
      second: { kind: "progress", primaryStage: null, primaryDate: null },
    });
    expect(s.errors.date).toBe(false);
  });

  it("羽数の誤りが照合で空欄になれば、公開の羽数の誤りに入らない（主の羽数の誤りには入る）", () => {
    const s = score({ read: { headCount: { value: 60000, quote: base.goodRead.headCount.quote } } });
    expect(s.errors.headCount).toBe(true);
    expect(s.verify!.droppedOptional).toContain("headCount");
    expect(s.published).toBe(true);
    expect(s.publishedHeadcountError).toBe(false);
  });

  it("引用にある羽数が正解と違えば、公開の羽数の誤りに数える", () => {
    const s = score({ answer: { headCount: 60000 } });
    expect(s.published).toBe(true);
    expect(s.publishedHeadcountError).toBe(true);
  });

  it("確認中に回った文書の誤りは、公開の誤りに入らない", () => {
    const s = score({ read: { municipality: { value: "久留米市", quote: base.goodRead.municipality.quote } } });
    expect(s.errors.muni).toBe(true);
    expect(s.published).toBe(false);
    expect(s.publishedMandatoryError).toBe(false);
  });

  it("公開した文書の必須の誤りは数える。対象外の文書を発生に読んで載せたときも", () => {
    // 引用の中に別の日付が実在する読み（照合は通るが正解と違う）
    const wrongDate = score({
      read: { primaryDate: { year: 2025, month: 11, day: 7, time: null }, primaryDateQuote: "令和7年11月7日（金曜日）、同市の農場から通報を受けて立入検査を実施し、簡易検査で陽性を確認しました。" },
      second: { primaryDate: { year: 2025, month: 11, day: 7, time: null } },
    });
    expect(wrongDate.published).toBe(true);
    expect(wrongDate.publishedMandatoryError).toBe(true);
    const falsePositive = score({ answer: { kind: "notice", prefCode: null, muniName: null, primaryStage: null, primaryDate: null, headCount: null, nationalNo: null, radiiKm: [] } });
    expect(falsePositive.published).toBe(true);
    expect(falsePositive.publishedMandatoryError).toBe(true);
  });

  it("読めなかった文書（拒否、形式エラー、打ち切り、API の失敗）は read が null で、誤りに数えない", () => {
    for (const reason of ["refusal", "format_error", "max_tokens", "api_error"] as const) {
      const s = scoreDocument({ answer: base.answer, text: base.text, hasTextLayer: true, primary: fail(reason), second: ok(base.goodSecond), geo });
      expect(s.read).toBeNull();
      expect(s.primaryFailure).toBe(reason);
      expect(s.primaryDetail).toBe(reason);
      expect(s.errors).toEqual({ muni: false, stage: false, date: false, headCount: false, kindClass: false });
      expect(s.published).toBe(false);
      expect(s.decision.action).toMatch(/review/);
    }
  });

  it("別の読み手だけの失敗は、比べられず確認中", () => {
    const s = scoreDocument({ answer: base.answer, text: base.text, hasTextLayer: true, primary: ok(base.goodRead), second: fail("api_error"), geo });
    expect(s.compare).toBeNull();
    expect(s.published).toBe(false);
    expect(s.secondFailure).toBe("api_error");
  });

  it("自動で載せる設定は試験の中では入にして測る（既定の false だと全件が確認中になり合否が甘くなる）", () => {
    expect(score().decision.action).toBe("publish");
  });

  it("野鳥は行ごとに、市町村、日付、検査の結果の誤りを数える", () => {
    const wild = answerOf("w-moe-kurihara-negative");
    const good: ReadResult = {
      ...base.goodRead,
      kind: "wild_bird",
      kindQuote: null,
      prefecture: { value: null, quote: null },
      municipality: { value: null, quote: null },
      primaryStage: null,
      primaryDate: null,
      primaryDateQuote: null,
      headCount: { value: null, quote: null },
      nationalNo: { value: null, quote: null },
      radiiKm: [],
      wildBirds: [{ date: { year: 2026, month: 10, day: 30, time: null }, prefecture: "宮城県", municipality: "栗原市", species: "マガン", test: "negative", quote: "x" }],
    };
    const s = scoreDocument({ answer: wild, text: "宮城県栗原市 10月30日 陰性", hasTextLayer: true, primary: ok(good), second: ok({ kind: "wild_bird", multipleCases: false, prefecture: null, municipality: null, primaryStage: null, primaryDate: null, wildBirds: [{ date: good.wildBirds[0]!.date, prefecture: "宮城県", municipality: "栗原市", test: "negative" }] }), geo });
    expect(s.errors).toEqual({ muni: false, stage: false, date: false, headCount: false, kindClass: false });
    const bad = scoreDocument({ answer: wild, text: "宮城県栗原市 10月30日 陰性", hasTextLayer: true, primary: ok({ ...good, wildBirds: [{ ...good.wildBirds[0]!, test: "screening_positive", municipality: "大崎市", date: { year: 2026, month: 10, day: 27, time: null } }] }), second: fail("api_error"), geo });
    expect(bad.errors).toMatchObject({ muni: true, stage: true, date: true });
  });
});

describe("入れ替えと誤った読み手", () => {
  it("正しい読みは載る（これが載らなければ、落ちた数は意味がない）", () => {
    const r = runTamper(base, geo);
    expect(r.control).toBe("publish");
  });

  it("わざと入れ替えた結果と誤った読み手がすべて落ちる（tamper_rejected）", () => {
    const r = runTamper(base, geo);
    expect(r.total).toBeGreaterThanOrEqual(12);
    expect(r.failures).toEqual([]);
    expect(r.rejected).toBe(r.total);
  });
});

function fake(over: Partial<DocScore> = {}): DocScore {
  return {
    id: "x",
    answerKind: "confirmed",
    read: base.goodRead,
    second: base.goodSecond,
    primaryFailure: null,
    secondFailure: null,
    primaryDetail: null,
    secondDetail: null,
    verify: null,
    compare: { match: true, mismatches: [] },
    decision: { action: "publish", negationCandidate: false },
    errors: { muni: false, stage: false, date: false, headCount: false, kindClass: false },
    radiusWrong: false,
    published: true,
    publishedMandatoryError: false,
    publishedHeadcountError: false,
    ...over,
  };
}
const many = (n: number, over: Partial<DocScore> = {}) => Array.from({ length: n }, (_, i) => fake({ ...over, id: `d${i}` }));
const NAMES: EvalMetricName[] = [
  "documents",
  "read_refusals",
  "format_errors",
  "primary_muni_errors",
  "primary_stage_errors",
  "primary_date_errors",
  "primary_headcount_errors",
  "published_mandatory_errors",
  "published_headcount_errors",
  "auto_published_documents",
  "review_documents",
  "second_reader_mismatches",
  "tamper_rejected",
  "detection_prev_season",
  "detection_title_classification",
];
const NOW = "2026-11-05T12:00:00+09:00";

describe("summarize と evalPasses", () => {
  it("指標の名前と順が決まりどおり。documents は試みた全文書", () => {
    const scores = [...many(28), fake({ read: null, primaryFailure: "refusal", published: false, decision: { action: "review_private", reasons: ["read_failed"] } }), fake({ read: null, primaryFailure: "max_tokens", published: false, decision: { action: "review_private", reasons: ["read_failed"] } })];
    const s = summarize(scores, { total: 15, rejected: 15 }, { prevSeason: 24, titles: 70 }, 1.5, NOW);
    expect(s.metrics.map((m) => m.name)).toEqual(NAMES);
    const get = (n: EvalMetricName) => s.metrics.find((m) => m.name === n)!;
    expect(get("documents").value).toBe(30);
    expect(get("read_refusals").value).toBe(1);
    expect(get("auto_published_documents").value).toBe(28);
    expect(get("review_documents").value).toBe(2);
    expect(get("tamper_rejected")).toMatchObject({ value: 15, denominator: 15 });
    expect(get("detection_prev_season")).toMatchObject({ value: 24, denominator: 24 });
    expect(get("detection_title_classification")).toMatchObject({ value: 70, denominator: 70 });
    expect(get("detection_title_classification").note).toContain("24/21/25");
    expect(s.unmeasured).toEqual([]);
    expect(s.costPerDocumentUsd).toBeCloseTo(0.05, 5);
    expect(s.measuredAt).toBe(NOW);
  });

  it("検知が測れなければ、その 2 行を出さず unmeasured に入れる（0 と書かない）", () => {
    const s = summarize(many(30), { total: 15, rejected: 15 }, null, 0, NOW);
    expect(s.metrics.map((m) => m.name)).toEqual(NAMES.slice(0, 13));
    expect(s.unmeasured).toEqual(["detection_prev_season", "detection_title_classification"]);
  });

  it("誤りと食い違いを数える", () => {
    const scores = [
      fake({ errors: { muni: true, stage: false, date: false, headCount: false, kindClass: false } }),
      fake({ errors: { muni: false, stage: true, date: true, headCount: true, kindClass: false } }),
      fake({ publishedMandatoryError: true, publishedHeadcountError: true }),
      fake({ compare: { match: false, mismatches: ["kind"] }, published: false, decision: { action: "review_private", reasons: [] } }),
      fake({ read: null, primaryFailure: "format_error", published: false, decision: { action: "review_private", reasons: [] } }),
    ];
    const s = summarize(scores, { total: 15, rejected: 14 }, null, 0, NOW);
    const get = (n: EvalMetricName) => s.metrics.find((m) => m.name === n)!.value;
    expect(get("primary_muni_errors")).toBe(1);
    expect(get("primary_stage_errors")).toBe(1);
    expect(get("primary_date_errors")).toBe(1);
    expect(get("primary_headcount_errors")).toBe(1);
    expect(get("published_mandatory_errors")).toBe(1);
    expect(get("published_headcount_errors")).toBe(1);
    expect(get("second_reader_mismatches")).toBe(1);
    expect(get("format_errors")).toBe(1);
    expect(get("tamper_rejected")).toBe(14);
  });

  const pass = (scores: DocScore[], tamper = { total: 15, rejected: 15 }): boolean => evalPasses(summarize(scores, tamper, { prevSeason: 24, titles: 70 }, 0, NOW), scores);

  it("読めた文書が 30 以上で、市町村、段階、日付、公開の誤りが 0 なら合格。読めた 29 は不合格", () => {
    expect(pass(many(30))).toBe(true);
    expect(pass(many(29))).toBe(false);
    expect(pass([...many(29), fake({ read: null, primaryFailure: "max_tokens" })])).toBe(false);
    expect(pass([...many(29), fake({ read: null, primaryFailure: "api_error" })])).toBe(false);
    expect(pass([...many(30), fake({ read: null, primaryFailure: "api_error" })])).toBe(true);
  });

  it("市町村、段階、日付、公開の誤りが 1 件でも不合格。主の羽数の誤りは合否に入れない", () => {
    expect(pass([...many(30), fake({ errors: { muni: true, stage: false, date: false, headCount: false, kindClass: false } })])).toBe(false);
    expect(pass([...many(30), fake({ errors: { muni: false, stage: true, date: false, headCount: false, kindClass: false } })])).toBe(false);
    expect(pass([...many(30), fake({ errors: { muni: false, stage: false, date: true, headCount: false, kindClass: false } })])).toBe(false);
    expect(pass([...many(30), fake({ publishedMandatoryError: true })])).toBe(false);
    expect(pass([...many(30), fake({ publishedHeadcountError: true })])).toBe(false);
    expect(pass([...many(30), fake({ errors: { muni: false, stage: false, date: false, headCount: true, kindClass: false } })])).toBe(true);
  });

  // 設計書 §16「読み取り」: 正解つきの発表 30 文書以上で、市町村、段階、日付の誤りが 0。羽数の誤りは照合か二重読みで落ちる。
  // 読めなかった文書の許容は書かれていないので、形式エラーと打ち切りは 0 件を合格の条件にする。
  it("形式エラーと打ち切り（主でも別の読み手でも）が 1 件でもあれば、読めた文書が 30 以上でも不合格", () => {
    expect(pass([...many(30), fake({ read: null, primaryFailure: "format_error" })])).toBe(false);
    expect(pass([...many(30), fake({ read: null, primaryFailure: "max_tokens" })])).toBe(false);
    expect(pass([...many(30), fake({ secondFailure: "format_error", second: null, compare: null })])).toBe(false);
    expect(pass([...many(30), fake({ secondFailure: "max_tokens", second: null, compare: null })])).toBe(false);
  });

  it("API の失敗は合否に入れず、やり直しが要る件数として別に出す（再実行で解消しうる）", () => {
    const scores = [...many(30), fake({ read: null, primaryFailure: "api_error" }), fake({ secondFailure: "api_error", second: null, compare: null })];
    expect(pass(scores)).toBe(true);
    expect(rerunNeeded(scores)).toBe(2);
    expect(rerunNeeded(many(30))).toBe(0);
  });

  it("対照（正しい読み）が載らないときは、入れ替えが落ちた数を合格に数えない", () => {
    const ok = { control: "publish", total: 17, rejected: 17, failures: [] } as const;
    expect(tamperForSummary(ok)).toEqual({ total: 17, rejected: 17 });
    const broken = tamperForSummary({ control: "review_private", total: 17, rejected: 17, failures: [] });
    expect(broken).toEqual({ total: 17, rejected: 0 });
    expect(pass(many(30), broken)).toBe(false);
  });

  it("種類の取り違えと半径の誤りは、合否に入れず、件数を summary の note と run record に出す", () => {
    const scores = [
      ...many(30),
      fake({ errors: { muni: false, stage: false, date: false, headCount: false, kindClass: true } }),
      fake({ radiusWrong: true }),
    ];
    expect(runCounts(scores)).toMatchObject({ kindClassErrors: 1, radiusWrong: 1 });
    expect(pass(scores)).toBe(true);
    const s = summarize(scores, { total: 15, rejected: 15 }, null, 0, NOW);
    expect(s.metrics.find((m) => m.name === "primary_stage_errors")!.note).toContain("種類の取り違え 1 件");
    expect(toRunRecord(scores).counts).toMatchObject({ kindClassErrors: 1, radiusWrong: 1 });
  });

  it("入れ替えが 1 件でも通れば不合格", () => {
    expect(pass(many(30), { total: 15, rejected: 14 })).toBe(false);
  });
});

describe("公開してよい結果（事実のみ）", () => {
  it("run record と summary に quote と text がない", () => {
    const scores = [score(), score({ read: { municipality: { value: "久留米市", quote: base.goodRead.municipality.quote } } })];
    const record = JSON.stringify(toRunRecord(scores));
    const summary = JSON.stringify(summarize(scores, { total: 1, rejected: 1 }, null, 0, NOW));
    for (const json of [record, summary]) {
      expect(json).not.toContain('"quote"');
      expect(json).not.toContain('"text"');
      expect(json).not.toContain(base.goodRead.municipality.quote!);
    }
    expect(JSON.parse(record).documents).toHaveLength(2);
  });
});

// ── 見積もりと Batch の依頼 ──
const inputsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `doc${i}`, title: `題${i}`, url: `https://example.test/${i}`, text: "あ".repeat(2000), pdfBase64: null }));

describe("Batch の依頼", () => {
  it("custom_id は ${id}__p と ${id}__s で、主と別の読み手の 2 件ずつ。英数字と - と _ で 64 字以内、重複なし", () => {
    expect(evalCustomIds("c-maff-okayama")).toEqual({ primary: "c-maff-okayama__p", second: "c-maff-okayama__s" });
    const reqs = buildEvalRequests(inputsOf(10), DEFAULT_RUNTIME_SETTINGS);
    expect(reqs).toHaveLength(20);
    const ids = reqs.map((r) => r.custom_id);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(reqs.filter((r) => r.custom_id.endsWith("__p")).every((r) => r.params.model === DEFAULT_RUNTIME_SETTINGS.primaryModel)).toBe(true);
    expect(reqs.filter((r) => r.custom_id.endsWith("__s")).every((r) => r.params.model === DEFAULT_RUNTIME_SETTINGS.secondModel)).toBe(true);
    // 別の読み手の依頼に、主の結果や正解が入らない（入力は題、URL、本文だけ。主と同じ user の内容で、引き写しの決めもない）
    expect(JSON.stringify(reqs[1]!.params.messages)).toBe(JSON.stringify(reqs[0]!.params.messages));
    expect(JSON.stringify(reqs[1]!.params.system)).not.toContain("引き写しの決め");
  });

  it("依頼は JSON にできる値だけ（parse 関数が入らない）", () => {
    for (const r of buildEvalRequests(inputsOf(2), DEFAULT_RUNTIME_SETTINGS)) {
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
      expect(JSON.stringify(r)).not.toMatch(/"parse"/);
      expect(Object.values(r.params).every((v) => typeof v !== "function")).toBe(true);
    }
  });

  it("1 バッチ 200MB ごとに分ける（上限 256MB）。順は保つ", () => {
    const mk = (n: number, bytes: number) => Array.from({ length: n }, (_, i) => ({ custom_id: `r${i}`, bytes }));
    const chunks = chunkRequests(mk(5, 90 * 1024 * 1024).map((r) => ({ custom_id: r.custom_id, params: {} as never, bytes: r.bytes })));
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunks.flat().map((r) => r.custom_id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    const one = chunkRequests(mk(3, 1000).map((r) => ({ custom_id: r.custom_id, params: {} as never, bytes: r.bytes })));
    expect(one).toHaveLength(1);
  });
});

describe("見積もり", () => {
  const reqs = buildEvalRequests(inputsOf(30), DEFAULT_RUNTIME_SETTINGS);

  it("--sync は Batch の 2 倍。件数、合計の大きさ、バッチの数を出す", () => {
    const batch = estimateRun(reqs, "batch");
    const sync = estimateRun(reqs, "sync");
    expect(batch.documents).toBe(30);
    expect(batch.requests).toBe(60);
    expect(batch.bytes).toBeGreaterThan(0);
    expect(batch.batches).toBe(1);
    expect(sync.usd).toBeCloseTo(batch.usd * 2, 8);
    expect(sync.upperBoundUsd).toBeCloseTo(batch.upperBoundUsd * 2, 8);
    expect(batch.upperBoundUsd).toBeGreaterThan(batch.usd);
    expect(batch.usd).toBeGreaterThan(0);
  });
});

describe("過去分（--backfill）", () => {
  it("シーズンの題の数は {2020:52,2021:25,2022:84,2023:11,2024:51,2025:24} のときだけ一致", () => {
    expect(SEASON_TITLE_COUNTS).toEqual({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51, 2025: 24 });
    expect(matchesSeasonTitleCounts({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51, 2025: 24 })).toBe(true);
    expect(matchesSeasonTitleCounts({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51, 2025: 23 })).toBe(false);
    expect(matchesSeasonTitleCounts({ 2020: 52, 2021: 25, 2022: 84, 2023: 11, 2024: 51 })).toBe(false);
  });

  it("シーズンの月は 6 月から翌年 5 月の 12 か月（西暦の下 2 桁と月の 4 桁）", () => {
    expect(seasonMonths(2025)).toEqual(["2506", "2507", "2508", "2509", "2510", "2511", "2512", "2601", "2602", "2603", "2604", "2605"]);
    expect(seasonMonths(2020)[0]).toBe("2006");
  });

  it("過去分の custom_id は英数字と - と _ で 64 字以内、重複なし、主と別の読み手で 2 件ずつ", () => {
    const docs = Array.from({ length: 52 }, (_, i) => ({ id: `bf2020-${i + 1}`, title: `題${i}`, url: `https://example.test/${i}`, text: "本文", pdfBase64: null }));
    const reqs = buildBackfillRequests(2020, docs, DEFAULT_RUNTIME_SETTINGS);
    expect(reqs).toHaveLength(104);
    expect(new Set(reqs.map((r) => r.custom_id)).size).toBe(104);
    for (const r of reqs) {
      expect(r.custom_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(JSON.stringify(r)).not.toMatch(/"parse"/);
    }
    expect(reqs.filter((r) => r.custom_id.endsWith("__p"))).toHaveLength(52);
    expect(reqs.filter((r) => r.custom_id.endsWith("__s"))).toHaveLength(52);
  });
});

describe("summary の型", () => {
  it("EvalSummary として X-09 が読める形（measuredAt、metrics、unmeasured、costPerDocumentUsd）", () => {
    const s: EvalSummary = summarize(many(30), { total: 15, rejected: 15 }, null, 3, NOW);
    expect(Object.keys(s).sort()).toEqual(["costPerDocumentUsd", "measuredAt", "metrics", "unmeasured"]);
    for (const m of s.metrics) expect(Object.keys(m).sort()).toEqual(["denominator", "name", "note", "unit", "value"]);
  });
});

// 有料の API を呼ぶ関門: --dry-run と --yes なしでは、API のクライアントを作らない
const constructed = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      constructed();
    }
  },
}));

describeFixture("run.ts の関門（クライアントを作らない）", [path.join(FIXTURE_DIR, "c-maff-okayama.html")], () => {
  const run = async (argv: string[]) => {
    constructed.mockClear();
    let out = "";
    const code = await main(argv, (s) => (out += s));
    return { code, out };
  };

  it("--dry-run は 0 で、クライアントを作らない（--sync と組んでも）", async () => {
    expect((await run(["--dry-run"])).code).toBe(0);
    expect((await run(["--sync", "--dry-run"])).code).toBe(0);
    expect(constructed).not.toHaveBeenCalled();
  });

  it("--yes がなければ 2 で止まり、クライアントを作らない（--sync、Batch、--resume）", async () => {
    for (const argv of [["--sync"], [], ["--resume", "msgbatch_x"]]) {
      const r = await run(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.out).toContain("--yes");
    }
    expect(constructed).not.toHaveBeenCalled();
  });
});

describe("run.ts の引数", () => {
  it("--backfill には --season が要る。effort の値は 5 つだけ", async () => {
    await expect(main(["--backfill"], () => {})).rejects.toThrow(/--season/);
    await expect(main(["--effort", "ultra"], () => {})).rejects.toThrow(/effort/);
  });
});
