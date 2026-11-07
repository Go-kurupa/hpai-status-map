import { describe, expect, it } from "vitest";
import { NOT_POULTRY_KINDS, decidePublication, hasOutbreakWords, notPoultryHereReasons } from "../src/read/publish";
import type { CompareReport, DocumentKind, ReadResult, SecondReadResult, VerifyReport } from "../src/read/types";

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

// second は既定で null（別の読み手の結果がない＝自動で外す条件に当たらない）。外す条件の試験は下の describe で渡す
const base = { read: read("confirmed"), second: null, verify: okVerify, compare: okCompare, hasTextLayer: true, bodyAvailable: true, docText: OUTBREAK, autoPublishEnabled: true };
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
    expect(decide({ hasTextLayer: false, bodyAvailable: true, docText: QUIET })).toEqual({ action: "review_private", reasons: ["no_text_layer_match"] });
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

// ── 公開の確認中を自動で外す（その県の家きんの発生・疑いでないことがはっきりしたとき） ──

const second = (kind: DocumentKind, patch: Partial<SecondReadResult> = {}): SecondReadResult => ({
  kind, multipleCases: false, prefecture: null, municipality: null, primaryStage: null, primaryDate: null, wildBirds: [], ...patch,
});
// 県の常設ページに、他県の野鳥の知らせが足された形（作った文）。否定の文に「家きん」があるので、発生を示す語の判定は true になる
const WILD_NEWS = [
  "高病原性鳥インフルエンザの発生状況",
  "A県B市で回収された死亡野鳥から、高病原性鳥インフルエンザウイルス（H5亜型）が検出されました。",
  "C県D市の死亡野鳥の簡易検査陽性の事例は、確定検査で陰性となりました。",
  "県内の家きんでの発生はありません。",
].join("\n");
const kindMismatch: CompareReport = { match: false, mismatches: ["kind"] };

describe("notPoultryHereReasons: 自動で外してよいか", () => {
  it("前提: 野鳥の知らせの作った文は、今の判定では発生を示す語がある（だから公開の確認中になっていた）", () => {
    expect(hasOutbreakWords(WILD_NEWS)).toBe(true);
  });
  it("外してよい種類は 5 つ。家きんの事例の種類（否定を含む）は入れない", () => {
    expect([...NOT_POULTRY_KINDS].sort()).toEqual(["drill", "irrelevant", "notice", "other_pref", "wild_bird"]);
    for (const k of ["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"] as const) expect(NOT_POULTRY_KINDS.has(k)).toBe(false);
  });
  it("二人とも野鳥と読めば外す。理由は語だけ（引用や値を入れない）", () => {
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toEqual([
      "not_poultry_here", "both_read:wild_bird", "outbreak_words_present",
    ]);
  });
  it("種類の名前が違っても、二人とも家きんでない種類なら外す（野鳥とお知らせ、他県と野鳥）", () => {
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("notice"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toEqual([
      "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present",
    ]);
    expect(notPoultryHereReasons({ read: read("other_pref"), second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: QUIET })).toEqual([
      "not_poultry_here", "both_read:other_pref+wild_bird",
    ]);
  });
  it.each(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"] as const)(
    "どちらかが家きんの事例の種類（%s）と読めば外さない（主でも別の読み手でも）",
    (k) => {
      expect(notPoultryHereReasons({ read: read(k), second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
      expect(notPoultryHereReasons({ read: read("wild_bird"), second: second(k), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    },
  );
  it("読めなかった（主か別の読み手が無い）、文字層がないときは外さない", () => {
    expect(notPoultryHereReasons({ read: null, second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: null, hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("wild_bird"), hasTextLayer: false, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
  });
  it("野鳥以外と読んだ読み手が段階を読んでいれば外さない。野鳥と読んだ読み手の「疑い」「確定」だけは見ない", () => {
    expect(notPoultryHereReasons({ read: read("notice", { primaryStage: "suspected" }), second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("other_pref", { primaryStage: "confirmed" }), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    expect(notPoultryHereReasons({ read: read("wild_bird", { primaryStage: "suspected" }), second: second("wild_bird", { primaryStage: "confirmed" }), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).not.toBeNull();
  });
  it.each(["culling_done", "control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"] as const)(
    "野鳥と読んだ読み手でも、家きんにしかない段階（%s）を読んでいれば外さない",
    (stage) => {
      expect(notPoultryHereReasons({ read: read("wild_bird", { primaryStage: stage }), second: second("wild_bird"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
      expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("wild_bird", { primaryStage: stage }), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).toBeNull();
    },
  );
  it("本文を読めない（空、または取れず題だけ）ときは外さない（家きんの語を題だけで見ることになる）", () => {
    const title = "高病原性鳥インフルエンザの疑い事例の発生について\n";
    expect(notPoultryHereReasons({ read: read("notice"), second: second("irrelevant"), hasTextLayer: true, bodyAvailable: false, docText: title })).toBeNull();
    expect(decide({ read: read("notice"), second: second("irrelevant"), compare: kindMismatch, bodyAvailable: false, docText: title })).toMatchObject({ action: "review_public" });
  });
  it.each([
    "県内の農場で疑似患畜が確認されました。",
    "飼養鶏の殺処分を進めています。",
    "移動制限区域を設定しました。",
    "搬出制限区域を設定しました。",
    "発生農場の消毒を行いました。",
    "E市の養鶏場で簡易検査の陽性を確認しました。",
    "E市の採卵鶏の農場で、高病原性鳥インフルエンザが疑われる事例がありました。",
    "Ｅ市の養鶏場で 簡易 検査 の陽性を確認しました。", // 全角と空白は正規化して見る
    // 点検で見つかった抜け（作った文）
    "県内の農場から死亡羽数の増加の通報があり、簡易検査を実施したところ陽性でした。",
    "E市のあひる農場で簡易検査の陽性を確認しました。",
    "E市のうずら飼養施設で簡易検査の陽性を確認しました。",
    "E市の養鶏農家で、高病原性鳥インフルエンザが疑われる事例がありました。",
    "E市の鶏舎で簡易検査陽性となりました。",
    "E市のブロイラー農場で遺伝子検査を行っています。",
    "E市の養鶏場で高病原性鳥インフルエンザが発生しました。",
    "E市の家きんが患畜と判定されました。",
  ])("二人とも家きんでないと読んでも、家きんの事例にしか出ない語があれば外さない: %s", (line) => {
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("notice"), hasTextLayer: true, bodyAvailable: true, docText: `${WILD_NEWS}\n${line}` })).toBeNull();
  });
  it("飼養の場の語だけ（飼養者への注意）、段階の語だけ（野鳥の簡易検査）は外す妨げにしない", () => {
    const care = "高病原性鳥インフルエンザの発生状況\nA県B市の死亡野鳥からウイルスが検出されました。\n養鶏場の皆様へ。防鳥ネットの点検をお願いします。";
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("notice"), hasTextLayer: true, bodyAvailable: true, docText: care })).not.toBeNull();
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("notice"), hasTextLayer: true, bodyAvailable: true, docText: WILD_NEWS })).not.toBeNull();
  });
  it("飼養の場の語と段階の語は文書のどこにあっても組で見る（疑いの発表は「採卵鶏」と「簡易検査」が別の行に書かれる。迷ったら外さない）", () => {
    const split = `${WILD_NEWS}\n養鶏場の皆様へ。防鳥ネットの点検をお願いします。`;
    expect(notPoultryHereReasons({ read: read("wild_bird"), second: second("notice"), hasTextLayer: true, bodyAvailable: true, docText: split })).toBeNull();
  });
});

describe("decidePublication: 家きんの発生でないものを人の確認に回さない", () => {
  it("自動で載せる設定が入: 野鳥とお知らせで種類が食い違い、発生の語がある（今までは公開の確認中）→ 捨てる。理由を残す", () => {
    expect(decide({ read: read("notice"), second: second("wild_bird"), compare: kindMismatch, docText: WILD_NEWS })).toEqual({
      action: "discard",
      reasons: ["compare:kind", "not_poultry_here", "both_read:notice+wild_bird", "outbreak_words_present"],
    });
  });
  it("入: 今まで非公開の確認中だったもの（発生の語がない食い違い、野鳥の行の食い違い、野鳥の照合の不合格）も捨てる", () => {
    expect(decide({ read: read("notice"), second: second("irrelevant"), compare: kindMismatch, docText: QUIET })).toEqual({
      action: "discard", reasons: ["compare:kind", "not_poultry_here", "both_read:notice+irrelevant"],
    });
    expect(decide({ read: read("wild_bird"), second: second("wild_bird"), compare: { match: false, mismatches: ["wildBirds"] }, docText: WILD_NEWS })).toMatchObject({
      action: "discard", reasons: expect.arrayContaining(["compare:wildBirds", "not_poultry_here", "both_read:wild_bird"]),
    });
    expect(decide({ read: read("wild_bird"), second: second("wild_bird"), verify: failedVerify("wildBirds", "quote_exists"), docText: WILD_NEWS })).toMatchObject({
      action: "discard", reasons: expect.arrayContaining(["wildBirds:quote_exists", "not_poultry_here"]),
    });
  });
  it("入: 同じ種類で multipleCases だけ食い違ったときも捨てる", () => {
    expect(decide({ read: read("other_pref", { multipleCases: true }), second: second("other_pref"), compare: kindMismatch, docText: WILD_NEWS })).toMatchObject({
      action: "discard",
      reasons: expect.arrayContaining(["not_poultry_here", "both_read:other_pref"]),
    });
  });
  it("入: 載せる向きは変えない（二人とも野鳥と読み、一致し、照合に通れば今までどおり publish）", () => {
    expect(decide({ read: read("wild_bird"), second: second("wild_bird"), docText: WILD_NEWS })).toEqual({ action: "publish", negationCandidate: false });
  });
  it("切（試験の前）: 公開の確認中だけを非公開の確認中に下げ、理由を足す（箱には残す）", () => {
    expect(decide({ read: read("wild_bird"), second: second("notice"), compare: kindMismatch, docText: WILD_NEWS, autoPublishEnabled: false })).toEqual({
      action: "review_private",
      reasons: ["compare:kind", "auto_publish_off", "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present"],
    });
  });
  it("切: もともと非公開の確認中は変えない（理由も足さない）", () => {
    expect(decide({ read: read("notice"), second: second("irrelevant"), compare: kindMismatch, docText: QUIET, autoPublishEnabled: false })).toEqual({
      action: "review_private", reasons: ["compare:kind", "auto_publish_off"],
    });
  });
  it("両者が同じ対象外の種類と読んで一致したときは今までどおり（入: discard、切: auto_publish_off の非公開）", () => {
    expect(decide({ read: read("other_pref"), second: second("other_pref"), docText: WILD_NEWS })).toEqual({ action: "discard", reasons: ["both_read:other_pref", "outbreak_words_present"] });
    expect(decide({ read: read("other_pref"), second: second("other_pref"), docText: WILD_NEWS, autoPublishEnabled: false })).toEqual({ action: "review_private", reasons: ["auto_publish_off"] });
  });
  it("迷うときは今のまま公開の確認中: 否定と野鳥の食い違い、家きんの種類との食い違い、別の読み手の失敗、主の失敗、文字層なし、家きんの事例の語", () => {
    expect(decide({ read: read("negated"), second: second("wild_bird"), compare: kindMismatch, docText: WILD_NEWS })).toMatchObject({ action: "review_public" });
    expect(decide({ read: read("wild_bird"), second: second("negated"), compare: kindMismatch, docText: WILD_NEWS })).toMatchObject({ action: "review_public" });
    expect(decide({ read: read("wild_bird"), second: second("suspected"), compare: kindMismatch, docText: WILD_NEWS })).toMatchObject({ action: "review_public" });
    expect(decide({ read: read("wild_bird"), second: null, compare: null, docText: WILD_NEWS })).toMatchObject({ action: "review_public" });
    expect(decide({ read: null, second: second("wild_bird"), verify: null, compare: null, docText: WILD_NEWS })).toEqual({ action: "review_public", reasons: ["read_failed"] });
    expect(decide({ read: read("wild_bird"), second: second("notice"), hasTextLayer: false, compare: kindMismatch, docText: WILD_NEWS })).toMatchObject({ action: "review_public" });
    expect(decide({ read: read("wild_bird"), second: second("notice"), compare: kindMismatch, docText: `${WILD_NEWS}\n発生農場の消毒を行いました。` })).toMatchObject({ action: "review_public" });
  });
  it("家きんの発生の文書（二人とも確定と読む）は外さない", () => {
    expect(decide({ second: second("confirmed"), autoPublishEnabled: false })).toEqual({ action: "review_public", reasons: ["auto_publish_off"] });
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
