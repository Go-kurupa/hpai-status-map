import { describe, expect, it } from "vitest";
import { decidePublication, hasOutbreakWords } from "../src/read/publish";
import type { CompareReport, DocumentKind, ReadResult, VerifyReport } from "../src/read/types";

const none = { value: null, quote: null };
const read = (kind: DocumentKind, patch: Partial<ReadResult> = {}): ReadResult => ({
  kind, kindQuote: "k", multipleCases: false, prefecture: none, municipality: none,
  nationalNo: none, prefNo: none, birdUse: none, housing: none, headCount: none, negationBasis: none,
  primaryStage: null, primaryDate: null, primaryDateQuote: null, stageEvents: [], radiiKm: [], estimates: [], wildBirds: [], ...patch,
});
const okVerify: VerifyReport = { pass: true, issues: [], droppedOptional: [], normalized: null };
const okCompare: CompareReport = { match: true, mismatches: [] };
const OUTBREAK = "高病原性鳥インフルエンザの疑似患畜の確認について\n津山市の農場で確認しました。";
const QUIET = "お知らせ\n県内の取り組みについて。";

const base = { read: read("confirmed"), verify: okVerify, compare: okCompare, hasTextLayer: true, docText: OUTBREAK, autoPublishEnabled: true };
const decide = (patch: Partial<Parameters<typeof decidePublication>[0]> = {}) => decidePublication({ ...base, ...patch });
const failedVerify = (field: string, check: VerifyReport["issues"][number]["check"]): VerifyReport => ({
  pass: false, issues: [{ field, check, mandatory: true, detail: "d" }], droppedOptional: [], normalized: null,
});

describe("decidePublication: 載せる", () => {
  it("合格、一致、自動の載せるが入、複数の事例でなければ publish", () => {
    expect(decide()).toEqual({ action: "publish", negationCandidate: false });
  });
  it("否定は negationCandidate: true", () => {
    expect(decide({ read: read("negated") })).toEqual({ action: "publish", negationCandidate: true });
  });
  it("野鳥は複数の事例でも publish", () => {
    expect(decide({ read: read("wild_bird", { multipleCases: true }) })).toEqual({ action: "publish", negationCandidate: false });
  });
  it("任意の項目の不合格（issues だけ）は止めない", () => {
    const v: VerifyReport = { ...okVerify, issues: [{ field: "radiiKm", check: "radius_sentence", mandatory: false, detail: "d" }], droppedOptional: ["radiiKm"] };
    expect(decide({ verify: v })).toEqual({ action: "publish", negationCandidate: false });
  });
});

describe("decidePublication: 自動で載せる設定が切れている", () => {
  it("全件が確認中（発生の語あり review_public、なし review_private）で auto_publish_off", () => {
    expect(decide({ autoPublishEnabled: false })).toEqual({ action: "review_public", reasons: ["auto_publish_off"] });
    expect(decide({ autoPublishEnabled: false, docText: QUIET })).toEqual({ action: "review_private", reasons: ["auto_publish_off"] });
  });
  it("野鳥と否定は review_private", () => {
    expect(decide({ autoPublishEnabled: false, read: read("wild_bird") })).toEqual({ action: "review_private", reasons: ["auto_publish_off"] });
    expect(decide({ autoPublishEnabled: false, read: read("negated") })).toEqual({ action: "review_private", reasons: ["auto_publish_off"] });
  });
});

describe("decidePublication: 確認中", () => {
  it("必須の不合格は理由を集める（引用を入れない）", () => {
    const d = decide({ verify: failedVerify("municipality", "value_in_quote") });
    expect(d).toEqual({ action: "review_public", reasons: ["municipality:value_in_quote"] });
    expect(decide({ verify: failedVerify("primaryDate", "chronology"), docText: QUIET })).toEqual({
      action: "review_private", reasons: ["primaryDate:chronology"],
    });
  });
  it("任意の不合格は reasons に入れない", () => {
    const v: VerifyReport = {
      pass: false,
      issues: [
        { field: "radiiKm", check: "radius_sentence", mandatory: false, detail: "d" },
        { field: "municipality", check: "muni_exists", mandatory: true, detail: "d" },
      ],
      droppedOptional: [], normalized: null,
    };
    expect(decide({ verify: v })).toEqual({ action: "review_public", reasons: ["municipality:muni_exists"] });
  });
  it("食い違いは compare:項目", () => {
    const c: CompareReport = { match: false, mismatches: ["municipality", "primaryStage"] };
    expect(decide({ compare: c })).toEqual({ action: "review_public", reasons: ["compare:municipality", "compare:primaryStage"] });
    expect(decide({ compare: c, docText: QUIET })).toMatchObject({ action: "review_private" });
  });
  it("理由は重ねて集める", () => {
    const c: CompareReport = { match: false, mismatches: ["kind"] };
    const d = decide({ verify: failedVerify("kind", "stage_word"), compare: c, read: read("confirmed", { multipleCases: true }), autoPublishEnabled: false });
    expect(d).toEqual({ action: "review_public", reasons: ["kind:stage_word", "compare:kind", "multiple_cases", "auto_publish_off"] });
  });
  it("複数の事例は確認中", () => {
    expect(decide({ read: read("confirmed", { multipleCases: true }) })).toEqual({ action: "review_public", reasons: ["multiple_cases"] });
  });
  it("野鳥と否定の不合格は review_private（発生の語があっても）", () => {
    expect(decide({ read: read("wild_bird"), verify: failedVerify("wildBirds", "quote_exists") })).toEqual({
      action: "review_private", reasons: ["wildBirds:quote_exists"],
    });
    expect(decide({ read: read("negated"), verify: failedVerify("kind", "stage_word") })).toMatchObject({ action: "review_private" });
  });
  it("主が否定で二重読みと食い違うとき、鳥インフルの語が文書にあれば公開の確認中、なければ review_private（§9.6）", () => {
    const c: CompareReport = { match: false, mismatches: ["kind"] };
    expect(decide({ read: read("negated"), compare: c })).toEqual({ action: "review_public", reasons: ["compare:kind"] });
    expect(decide({ read: read("negated"), compare: c, docText: QUIET })).toEqual({ action: "review_private", reasons: ["compare:kind"] });
    // 一致していて検証だけ落ちた否定は今までどおり review_private
    expect(decide({ read: read("negated"), verify: failedVerify("kind", "stage_word") })).toMatchObject({ action: "review_private" });
  });
  it("否定で二重読みが無い（compare が null）ときも、鳥インフルの語があれば公開の確認中", () => {
    expect(decide({ read: read("negated"), compare: null })).toEqual({ action: "review_public", reasons: ["compare_missing"] });
    expect(decide({ read: read("negated"), compare: null, docText: QUIET })).toMatchObject({ action: "review_private" });
  });
  it("野鳥で種類が食い違い（または二重読みなし）、発生を示す語と農場の語があれば公開の確認中", () => {
    const farm = "高病原性鳥インフルエンザの疑似患畜の確認について\n野鳥ではなく養鶏場の農場で確認しました。";
    const kindMismatch: CompareReport = { match: false, mismatches: ["kind"] };
    expect(decide({ read: read("wild_bird"), compare: kindMismatch, docText: farm })).toEqual({ action: "review_public", reasons: ["compare:kind"] });
    expect(decide({ read: read("wild_bird"), compare: null, docText: farm })).toMatchObject({ action: "review_public" });
    // 農場の語がない野鳥の文書、日付や市町村だけの食い違い、検証だけの不合格は review_private
    const birdOnly = "野鳥における高病原性鳥インフルエンザの疑似患畜の確認について";
    expect(decide({ read: read("wild_bird"), compare: kindMismatch, docText: birdOnly })).toMatchObject({ action: "review_private" });
    expect(decide({ read: read("wild_bird"), compare: { match: false, mismatches: ["wildBirds"] }, docText: farm })).toMatchObject({ action: "review_private" });
    expect(decide({ read: read("wild_bird"), verify: failedVerify("wildBirds", "quote_exists"), docText: farm })).toMatchObject({ action: "review_private" });
  });
  it("verify か compare が無いときは一致していない側に倒す", () => {
    expect(decide({ verify: null })).toMatchObject({ action: "review_public" });
    expect(decide({ compare: null })).toMatchObject({ action: "review_public" });
    expect(decide({ compare: null, docText: QUIET })).toMatchObject({ action: "review_private" });
  });
});

describe("decidePublication: 読めなかった、文字層がない", () => {
  it("read が null なら read_failed（発生の語で public/private）", () => {
    expect(decide({ read: null, verify: null, compare: null })).toEqual({ action: "review_public", reasons: ["read_failed"] });
    expect(decide({ read: null, verify: null, compare: null, docText: QUIET })).toEqual({ action: "review_private", reasons: ["read_failed"] });
  });
  it("文字層なしは一致でも載せない。題に語があれば review_public", () => {
    expect(decide({ hasTextLayer: false })).toEqual({ action: "review_public", reasons: ["no_text_layer_match"] });
    expect(decide({ hasTextLayer: false, docText: QUIET })).toEqual({ action: "review_private", reasons: ["no_text_layer_match"] });
    expect(decide({ hasTextLayer: false, compare: { match: false, mismatches: ["kind"] } })).toEqual({
      action: "review_public", reasons: ["no_text_layer_mismatch"],
    });
    expect(decide({ hasTextLayer: false, compare: null })).toEqual({ action: "review_public", reasons: ["no_text_layer_mismatch"] });
  });
  it("文字層なしは自動で載せる設定が入でも publish にしない", () => {
    expect(decide({ hasTextLayer: false, autoPublishEnabled: true })).not.toMatchObject({ action: "publish" });
  });
});

describe("decidePublication: 対象外の種類", () => {
  it.each(["drill", "notice", "irrelevant", "other_pref"] as const)("%s は両者一致で discard", (kind) => {
    expect(decide({ read: read(kind) })).toEqual({ action: "discard", reasons: [`both_read:${kind}`, "outbreak_words_present"] });
    expect(decide({ read: read(kind), docText: QUIET })).toEqual({ action: "discard", reasons: [`both_read:${kind}`] });
  });
  it("試験の前（自動で載せる設定が切れ）は review_private、auto_publish_off", () => {
    expect(decide({ read: read("drill"), autoPublishEnabled: false })).toEqual({ action: "review_private", reasons: ["auto_publish_off"] });
  });
  it("食い違いは discard にしない", () => {
    const c: CompareReport = { match: false, mismatches: ["kind"] };
    expect(decide({ read: read("irrelevant"), compare: c })).toEqual({ action: "review_public", reasons: ["compare:kind"] });
    expect(decide({ read: read("irrelevant"), compare: c, docText: QUIET })).toEqual({ action: "review_private", reasons: ["compare:kind"] });
    expect(decide({ read: read("irrelevant"), compare: null })).not.toMatchObject({ action: "discard" });
  });
});

describe("hasOutbreakWords（題）", () => {
  it.each([
    "高病原性鳥インフルエンザが疑われる事例に係る遺伝子検査の結果及び今後の対応について",
    "県内の養鶏農場における高病原性鳥インフルエンザ疑い事例の確認に伴う緊急防疫会議の開催について",
    "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）",
    "高病原性鳥インフルエンザの⾼病原性ウイルスの発生を確認しました",
  ])("true: %s", (t) => {
    expect(hasOutbreakWords(t)).toBe(true);
  });
  it.each([
    "インフルエンザ様疾患による学校の臨時休業について（第23報）",
    "野鳥における高病原性鳥インフルエンザ（疑い事例、宮城県栗原市）",
    "鳥インフルエンザに関する相談窓口",
    "高病原性鳥インフルエンザの防疫演習を実施しました",
    "兵庫県姫路市で発生した高病原性鳥インフルエンザに係る本県で実施した防疫措置の完了について",
    "岡山県高病原性鳥インフルエンザ対策本部の開催について",
  ])("false: %s", (t) => {
    expect(hasOutbreakWords(t)).toBe(false);
  });
  it("題に語がなくても本文に「高病原性」と「簡易検査」があれば true", () => {
    expect(hasOutbreakWords("お知らせ\n津山市の養鶏場で高病原性鳥インフルエンザの簡易検査で陽性となりました。")).toBe(true);
  });
  it("野鳥でも家きんや農場の語があれば false にしない", () => {
    expect(hasOutbreakWords("野鳥と農場に係る高病原性鳥インフルエンザの疑似患畜の確認について")).toBe(true);
  });
  it("発生を示す語だけ、鳥インフルの語だけ、はどちらも false", () => {
    expect(hasOutbreakWords("疑似患畜の確認について")).toBe(true); // 疑似患畜は両方を満たす
    expect(hasOutbreakWords("簡易検査の結果について")).toBe(false);
    expect(hasOutbreakWords("高病原性鳥インフルエンザ")).toBe(false);
  });
});
