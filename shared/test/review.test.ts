import { describe, expect, it } from "vitest";
import { actionsFor, ALERT_TEXT, parseCorrectStageRequest, parseResolveRequest, reviewDetailOf } from "../src/read/review";
import type { DocumentRecord, ReadResult, ReviewItem } from "../src/read/types";
import { findForbiddenPhrases } from "../src/wording";

const values = {
  prefCode: "33",
  muniCode: "33203",
  stage: "suspected",
  date: "2025-12-20",
  time: "09:30",
  nationalNo: null,
  prefNo: 1,
  birdUse: "採卵鶏",
  housing: null,
  headCount: 12000,
  radiiKm: [3, 10],
};

describe("parseResolveRequest", () => {
  it("値つきの載せるを受け取る", () => {
    const r = parseResolveRequest({ itemId: "doc-d1", action: "publish_corrected", values });
    expect(r).toEqual({ ok: true, request: { itemId: "doc-d1", action: "publish_corrected", values } });
  });
  it.each(["mark_irrelevant", "confirm_negation", "reject_negation", "approve_entrance", "reject_entrance", "dismiss_alert"])("%s は値なしで受け取る", (action) => {
    expect(parseResolveRequest({ itemId: "x", action })).toMatchObject({ ok: true, request: { itemId: "x", action } });
  });
  it.each([
    ["オブジェクトでない", null],
    ["itemId がない", { action: "dismiss_alert" }],
    ["itemId が空", { itemId: "", action: "dismiss_alert" }],
    ["itemId に /", { itemId: "a/b", action: "dismiss_alert" }],
    ["未知の操作", { itemId: "x", action: "delete_everything" }],
    ["載せるに values がない", { itemId: "x", action: "publish_corrected" }],
    ["県のコードが違う", { itemId: "x", action: "publish_corrected", values: { ...values, prefCode: "99" } }],
    ["市町村のコードが 5 桁でない", { itemId: "x", action: "publish_corrected", values: { ...values, muniCode: "3320" } }],
    ["段階が違う", { itemId: "x", action: "publish_corrected", values: { ...values, stage: "negated" } }],
    ["実在しない日付", { itemId: "x", action: "publish_corrected", values: { ...values, date: "2025-02-30" } }],
    ["時刻の形が違う", { itemId: "x", action: "publish_corrected", values: { ...values, time: "25:00" } }],
    ["羽数が負", { itemId: "x", action: "publish_corrected", values: { ...values, headCount: -1 } }],
    ["羽数が小数", { itemId: "x", action: "publish_corrected", values: { ...values, headCount: 1.5 } }],
    ["半径が負", { itemId: "x", action: "publish_corrected", values: { ...values, radiiKm: [-3] } }],
    ["半径が文字", { itemId: "x", action: "publish_corrected", values: { ...values, radiiKm: ["3"] } }],
    ["用途が長すぎる", { itemId: "x", action: "publish_corrected", values: { ...values, birdUse: "あ".repeat(101) } }],
    ["用途が空の文字", { itemId: "x", action: "publish_corrected", values: { ...values, birdUse: "" } }],
  ])("%s は受け取らない", (_name, data) => {
    const r = parseResolveRequest(data);
    expect(r.ok).toBe(false);
  });
  it("values を必要としない操作に values が付いても、読み捨てる", () => {
    const r = parseResolveRequest({ itemId: "x", action: "dismiss_alert", values: { evil: true } });
    expect(r).toEqual({ ok: true, request: { itemId: "x", action: "dismiss_alert" } });
  });
});

describe("actionsFor（種類ごとの許す操作。1 項目 2 つまで）", () => {
  const base = { id: "i", createdAt: "2025-12-20T09:00:00+09:00", resolvedAt: null } as const;
  const alert = (a: Extract<ReviewItem, { kind: "alert" }>["alert"]): ReviewItem => ({ ...base, kind: "alert", alert: a, prefCode: null, caseId: null, message: "m" });
  it("文書は載せる／無関係", () => {
    const doc: ReviewItem = { ...base, kind: "document", documentId: "d", url: "https://example.test/", prefCode: null, title: "t", reasons: [], hasOutbreakWords: false };
    expect(actionsFor(doc)).toEqual(["publish_corrected", "mark_irrelevant"]);
  });
  it("入口の提案は承認／退ける", () => {
    const p: ReviewItem = { ...base, kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: "https://example.test/", sourceKind: "pref_fixed", rationale: "r" };
    expect(actionsFor(p)).toEqual(["approve_entrance", "reject_entrance"]);
  });
  it("否定の候補は確定／退ける、他の知らせは確認した", () => {
    expect(actionsFor(alert("negation_candidate"))).toEqual(["confirm_negation", "reject_negation"]);
    for (const a of ["case_stalled", "national_missing", "app_only_confirmed", "watch_failing", "agent_run_failed", "mail_failing"] as const) {
      expect(actionsFor(alert(a))).toEqual(["dismiss_alert"]);
    }
  });
});

describe("ALERT_TEXT", () => {
  it("知らせの言葉は決まった文で、禁止の語を含まない", () => {
    expect(ALERT_TEXT.case_stalled).toBe("疑いの続報がありません");
    expect(ALERT_TEXT.negation_candidate).toBe("否定の発表があるようです");
    expect(ALERT_TEXT.national_missing).toBe("国の一覧にあり、作品になかった事例を載せました");
    expect(ALERT_TEXT.app_only_confirmed).toBe("確定が 48 時間たっても国の一覧にありません");
    expect(ALERT_TEXT.watch_failing).toBe("24 時間以上読めていません");
    expect(ALERT_TEXT.agent_run_failed).toBe("入口を直すエージェントの実行に失敗しました");
    expect(ALERT_TEXT.mail_failing).toBe("メールを送れていません。アプリパスワードと 1 日の上限を確かめてください");
    for (const t of Object.values(ALERT_TEXT)) expect(findForbiddenPhrases(t)).toEqual([]);
  });
});

describe("reviewDetailOf", () => {
  const quote = "令和7年12月20日、岡山県津山市の養鶏場で簡易検査の陽性を確認しました。";
  const q = <T>(value: T | null): { value: T | null; quote: string | null } => ({ value, quote: value === null ? null : quote });
  const primary: ReadResult = {
    kind: "suspected",
    kindQuote: quote,
    multipleCases: false,
    prefecture: q("岡山県"),
    municipality: q("津山市"),
    nationalNo: q(null),
    prefNo: q(2),
    birdUse: q("採卵鶏"),
    housing: q(null),
    headCount: q(12000),
    negationBasis: q(null),
    primaryStage: "suspected",
    primaryDate: { year: null, month: 12, day: 20, time: "09:30" },
    primaryDateQuote: quote,
    stageEvents: [],
    radiiKm: [{ km: 3, quote }, { km: 10, quote }],
    estimates: [],
    wildBirds: [],
  };
  const doc = (o: Partial<DocumentRecord> = {}): DocumentRecord => ({
    id: "d1",
    sourceId: "s",
    prefCode: "33",
    url: "https://example.test/d1",
    title: "題",
    contentType: "html",
    storagePath: "raw/d1.html",
    fetchedAt: "2025-12-20T12:00:00+09:00",
    fingerprint: "f",
    hasTextLayer: true,
    kind: "suspected",
    readState: "review_public",
    primary,
    second: null,
    verify: { pass: false, issues: [{ field: "municipality", check: "muni_exists", mandatory: true, detail: `津山市 ${quote}` }], droppedOptional: [], normalized: null },
    compare: { match: false, mismatches: ["primaryDate"] },
    caseId: null,
    error: null,
    ...o,
  });

  it("読んだ値、不合格の検査、食い違った項目を返し、引用を含めない", () => {
    const d = reviewDetailOf(doc());
    expect(d).toEqual({
      kind: "suspected",
      prefecture: "岡山県",
      municipality: "津山市",
      primaryStage: "suspected",
      primaryDate: { year: null, month: 12, day: 20, time: "09:30" },
      nationalNo: null,
      birdUse: "採卵鶏",
      housing: null,
      headCount: 12000,
      radiiKm: [3, 10],
      issues: [{ field: "municipality", check: "muni_exists", mandatory: true }],
      mismatches: ["primaryDate"],
      error: null,
    });
    const json = JSON.stringify(d);
    expect(json).not.toContain("quote");
    expect(json).not.toContain("簡易検査");
    expect(json).not.toContain("detail");
  });
  it("読めなかった文書は空の値とエラーの符号を返す", () => {
    const d = reviewDetailOf(doc({ kind: null, primary: null, verify: null, compare: null, error: "refusal:cyber" }));
    expect(d).toMatchObject({ kind: null, prefecture: null, municipality: null, primaryStage: null, primaryDate: null, radiiKm: [], issues: [], mismatches: [], error: "refusal:cyber" });
  });
  it("長すぎる文字は切る", () => {
    const d = reviewDetailOf(doc({ primary: { ...primary, birdUse: q("あ".repeat(500)) } }));
    expect(d.birdUse!.length).toBeLessThanOrEqual(100);
  });
});

describe("parseCorrectStageRequest（段階の日付を直す入力）", () => {
  const ok = { caseId: "33203-2025-12-18-1", stage: "confirmed", expectedDate: "2025-12-19", newDate: "2025-12-20", reason: "県の発表を見直した" };
  it("正しい入力を通し、理由の前後の空白を除き、余計な項目を読み捨てる", () => {
    expect(parseCorrectStageRequest({ ...ok, reason: "  県の発表を見直した \n", extra: 1 })).toEqual({ ok: true, request: ok });
  });
  it("形が違えば理由つきで拒む", () => {
    for (const bad of [null, [], "x", { ...ok, caseId: "" }, { ...ok, caseId: "a/b" }, { ...ok, caseId: "." }, { ...ok, caseId: ".." }, { ...ok, caseId: "__x__" }, { ...ok, stage: "x" }, { ...ok, expectedDate: "2025-13-01" }, { ...ok, newDate: "2025-02-30" }, { ...ok, newDate: 20251220 }, { ...ok, reason: "" }, { ...ok, reason: "  " }, { ...ok, reason: undefined }, { ...ok, reason: "あ".repeat(201) }]) {
      const r = parseCorrectStageRequest(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).not.toBe("");
    }
  });
  it("理由の上限ちょうどは通る", () => {
    expect(parseCorrectStageRequest({ ...ok, reason: "あ".repeat(200) }).ok).toBe(true);
  });
});
