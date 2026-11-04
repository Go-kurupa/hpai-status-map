import { describe, expect, it } from "vitest";
import { verifyRead } from "../src/read/verify";
import type { ReadDate, ReadResult, VerifyReport } from "../src/read/types";
import type { Case, CaseStage } from "../src/types";
import { makeGeo } from "./fixtures/geo";

// 作った本文。実在の発表の文は写さない（「津山、確定」の型）。
const S1 = "令和7年12月20日午前9時、岡山県津山市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。";
const S2 = "当該農場は採卵鶏を飼養し、ウインドレス鶏舎で約43万羽です。";
const S3 = "国内8例目、県内1例目です。";
const S4 = "農場から半径3km以内の区域について移動制限区域の設定、半径3kmから10km以内の区域について搬出制限区域の設定を行いました。";
const TEXT = [S1, S2, S3, S4].join("\n");

const geo = makeGeo([
  { code: "33203", name: "津山市" },
  { code: "33606", name: "鏡野町" },
  { code: "33100", name: "岡山市" },
  { code: "13103", name: "港区" },
  { code: "07203", name: "郡山市" },
  { code: "04213", name: "栗原市" },
  { code: "31201", name: "鳥取市" },
  { code: "34100", name: "広島市" },
  { code: "01234", name: "北広島市" },
  { code: "29203", name: "大和郡山市" },
  { code: "07213", name: "伊達市" },
  { code: "01236", name: "伊達市" },
  { code: "26100", name: "京都市" },
  { code: "13101", name: "千代田区" },
]);

const q = <T,>(value: T | null, quote: string | null) => ({ value, quote });
const none = { value: null, quote: null };
const date = (year: number | null, month: number, day: number, time: string | null = null): ReadDate => ({ year, month, day, time });
/** 任意の項目をすべて空にする。 */
const bare = { nationalNo: none, prefNo: none, birdUse: none, housing: none, headCount: none, radiiKm: [] as ReadResult["radiiKm"] };

const good: ReadResult = {
  kind: "confirmed",
  kindQuote: S1,
  multipleCases: false,
  prefecture: q("岡山県", S1),
  municipality: q("津山市", S1),
  nationalNo: q(8, S3),
  prefNo: q(1, S3),
  birdUse: q("採卵鶏", S2),
  housing: q("ウインドレス鶏舎", S2),
  headCount: q(430000, S2),
  negationBasis: none,
  primaryStage: "confirmed",
  primaryDate: date(2025, 12, 20, "09:00"),
  primaryDateQuote: S1,
  stageEvents: [],
  radiiKm: [
    { km: 3, quote: S4 },
    { km: 10, quote: S4 },
  ],
  estimates: [],
  wildBirds: [],
};

type Extra = Partial<{ hasTextLayer: boolean; season: number }>;
const run = (read: ReadResult, text = TEXT, previous: Case | null = null, extra: Extra = {}): VerifyReport =>
  verifyRead(read, { text, hasTextLayer: true, season: 2025, ...extra }, geo, previous);
const withRead = (patch: Partial<ReadResult>): ReadResult => ({ ...good, ...patch });
const issueOf = (r: VerifyReport, field: string, check?: string) => r.issues.find((i) => i.field === field && (!check || i.check === check));

/** 1 文の本文で、県と市町村と種類の引用を同じ文にした ReadResult。 */
function oneSentence(s: string, patch: Partial<ReadResult>): ReadResult {
  return withRead({
    kindQuote: s,
    primaryDateQuote: s,
    prefecture: q("岡山県", s),
    municipality: q("津山市", s),
    ...bare,
    ...patch,
  });
}

const caseOf = (stages: Case["stages"]): Case => ({
  id: "x", season: 2025, nationalNo: null, prefNo: null, prefCode: "33", muniCode: "33203", muniName: "津山市",
  birdUse: null, housing: null, headCount: null, stages, radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none", negatedAt: null, confirmState: "auto", sourceUrls: [], updatedAt: "2025-12-20T09:00:00+09:00",
});

describe("verifyRead: 合格", () => {
  it("good は pass で、都道府県と市町村のコード、段階、日時が出る", () => {
    const r = run(good);
    expect(r.pass).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.droppedOptional).toEqual([]);
    expect(r.normalized).toMatchObject({
      kind: "confirmed",
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      primaryStage: "confirmed",
      primaryStamp: { date: "2025-12-20", time: "09:00" },
      nationalNo: 8,
      prefNo: 1,
      birdUse: "採卵鶏",
      housing: "ウインドレス鶏舎",
      headCount: 430000,
      radiiKm: [3, 10],
      yearCompleted: false,
      stages: { confirmed: { date: "2025-12-20", time: "09:00" } },
    });
  });
  it("部首用の文字の本文と、普通の字の引用は一致する", () => {
    const text = TEXT.replace("高病原性", "⾼病原性").replace("鳥インフルエンザ", "⿃インフルエンザ").replace("岡山県", "岡⼭県");
    expect(text).not.toBe(TEXT);
    expect(run(good, text).pass).toBe(true);
  });
});

describe("verifyRead: 必須の不合格", () => {
  it("本文にない引用は quote_exists で不合格", () => {
    const r = run(withRead({ municipality: q("津山市", "津山市で発生しました（本文にない文）") }));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "municipality", "quote_exists")).toMatchObject({ mandatory: true });
    expect(r.normalized?.muniCode).toBeNull();
  });
  it("市町村の値が引用にないと value_in_quote で不合格", () => {
    const r = run(withRead({ municipality: q("鏡野町", S1) }));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "municipality", "value_in_quote")?.mandatory).toBe(true);
  });
  it("都道府県と市町村の入れ替え（引用はそのまま）は不合格", () => {
    const r = run(withRead({ prefecture: q("津山市", S1), municipality: q("岡山県", S1) }));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "prefecture")?.mandatory).toBe(true);
    expect(issueOf(r, "municipality")?.mandatory).toBe(true);
    expect(r.normalized).toMatchObject({ prefCode: null, muniCode: null, muniName: null, primaryStamp: expect.anything() });
  });
  it("確定の日付に殺処分の日付を入れる（値だけ入れ替え、引用はそのまま）は不合格", () => {
    const r = run(withRead({ primaryDate: date(2025, 12, 21, "09:00") }));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "primaryDate", "value_in_quote")?.mandatory).toBe(true);
  });
  it("日付の時刻が引用と合わないのも不合格（必須の日付に含める）", () => {
    const r = run(withRead({ primaryDate: date(2025, 12, 20, "10:00") }));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "primaryDate", "value_in_quote")).toBeDefined();
  });
  it("引用のない日付、段階があるのに日付が null は不合格", () => {
    expect(run(withRead({ primaryDateQuote: null })).pass).toBe(false);
    expect(run(withRead({ primaryDate: null, primaryDateQuote: null })).pass).toBe(false);
  });
  it("その都道府県にない市町村は不合格（鳥取県に津山市はない）", () => {
    const s = S1.replace("岡山県", "鳥取県");
    const r = run(oneSentence(s, { prefecture: q("鳥取県", s) }), s);
    expect(r.pass).toBe(false);
    expect(issueOf(r, "municipality", "muni_exists")?.mandatory).toBe(true);
  });
  it("detail に引用や値の文を入れない", () => {
    const r = run(withRead({ municipality: q("鏡野町", S1), prefecture: q("津山市", S1), kindQuote: "本文にない 疑似患畜 の文" }));
    expect(r.issues.length).toBeGreaterThan(0);
    for (const i of r.issues) {
      for (const leaked of [S1, S2, S3, S4, "鏡野町", "疑似患畜", "津山市"]) expect(i.detail).not.toContain(leaked);
    }
  });
});

describe("verifyRead: 任意の項目は落として pass（§16 欄の入れ替え）", () => {
  it("羽数と国内何例目の入れ替えは、両方空欄で pass、droppedOptional に入る", () => {
    const r = run(withRead({ nationalNo: q(430000, S3), headCount: q(8, S2) }));
    expect(r.pass).toBe(true);
    expect(r.normalized?.nationalNo).toBeNull();
    expect(r.normalized?.headCount).toBeNull();
    expect(r.droppedOptional).toEqual(expect.arrayContaining(["nationalNo", "headCount"]));
    expect(r.issues.every((i) => !i.mandatory)).toBe(true);
  });
  it("同じ文に両方ある引用でも、羽と例目の型が違えば入れ替えは落ちる", () => {
    const both = "国内8例目で、約43万羽です。";
    const r = run(withRead({ nationalNo: q(430000, both), headCount: q(8, both) }), `${TEXT}\n${both}`);
    expect(r.pass).toBe(true);
    expect(r.normalized?.nationalNo).toBeNull();
    expect(r.normalized?.headCount).toBeNull();
  });
  it("農場数を半径にすると半径だけ空欄で pass、issues に radius_sentence", () => {
    const farms = "半径3km以内の農場は12戸です。";
    const r = run(withRead({ radiiKm: [{ km: 12, quote: farms }, { km: 3, quote: S4 }] }), `${TEXT}\n${farms}`);
    expect(r.pass).toBe(true);
    expect(r.normalized?.radiiKm).toEqual([3]);
    expect(issueOf(r, "radiiKm", "radius_sentence")).toMatchObject({ mandatory: false });
    expect(r.droppedOptional).toContain("radiiKm");
  });
  it("自粛の要請の 10 を半径にしない", () => {
    const q10 = "発生農場から半径10km圏内の農場に出荷の自粛を要請しました。";
    const r = run(withRead({ radiiKm: [{ km: 10, quote: q10 }] }), `${TEXT}\n${q10}`);
    expect(r.pass).toBe(true);
    expect(r.normalized?.radiiKm).toEqual([]);
    expect(issueOf(r, "radiiKm", "radius_sentence")).toBeDefined();
  });
  it("任意の引用が本文になければ、その項目だけ空欄", () => {
    const r = run(withRead({ birdUse: q("肉用鶏", "肉用鶏を飼養しています。") }));
    expect(r.pass).toBe(true);
    expect(r.normalized?.birdUse).toBeNull();
    expect(issueOf(r, "birdUse", "quote_exists")?.mandatory).toBe(false);
  });
  it("値が引用にない任意の項目も空欄", () => {
    const r = run(withRead({ housing: q("開放鶏舎", S2) }));
    expect(r.pass).toBe(true);
    expect(r.normalized?.housing).toBeNull();
    expect(r.droppedOptional).toContain("housing");
  });
});

describe("verifyRead: 段階の語", () => {
  it("confirmed に「簡易検査で陽性」だけの引用は不合格、「疑似患畜と確認」は合格", () => {
    const s = "令和7年12月20日午前9時、岡山県津山市の農場で簡易検査で陽性となりました。";
    const bad = run(oneSentence(s, {}), `${s}\n${TEXT}`);
    expect(bad.pass).toBe(false);
    expect(issueOf(bad, "kind", "stage_word")?.mandatory).toBe(true);
    expect(run(good).pass).toBe(true);
  });
  it("疑似患畜を含めば、「疑われた事例」の語が同じ文にあっても confirmed は合格", () => {
    const s = "令和7年12月20日午前9時、岡山県津山市で疑われた事例が疑似患畜と確定されました。";
    expect(run(oneSentence(s, {}), s).pass).toBe(true);
  });
  it("kindQuote が null なら語を見る種類は不合格", () => {
    expect(run(withRead({ kindQuote: null })).pass).toBe(false);
  });
  it("suspected / suspected は「簡易検査で陽性」で合格", () => {
    const s = "令和7年12月19日、岡山県津山市の農場で簡易検査で陽性となりました。";
    const read = oneSentence(s, { kind: "suspected", primaryStage: "suspected", primaryDate: date(2025, 12, 19) });
    expect(run(read, s).pass).toBe(true);
  });
  it("zone_lifted / movement_lifted は「区域を設定」で不合格、「移動制限を解除」で合格", () => {
    const set = "令和7年12月31日、岡山県津山市の移動制限区域を設定しました。";
    const lift = "令和7年12月31日、岡山県津山市の発生農場に係る移動制限を解除しました。";
    const mk = (s: string) => oneSentence(s, { kind: "zone_lifted", primaryStage: "movement_lifted", primaryDate: date(2025, 12, 31) });
    expect(run(mk(set), set).pass).toBe(false);
    expect(run(mk(lift), lift).pass).toBe(true);
  });
  it.each([
    ["令和7年12月20日、岡山県津山市の件は遺伝子検査の結果、陰性でした。", true],
    ["令和7年12月20日、岡山県津山市の件は高病原性ではないことを確認しました。", true],
    ["令和7年12月20日、岡山県津山市の件で検査を実施しました。", false],
  ])("negated / null の「%s」→ %s", (s, ok) => {
    const read = oneSentence(s, { kind: "negated", primaryStage: null, primaryDate: null, primaryDateQuote: null });
    const r = run(read, s);
    expect(r.pass).toBe(ok);
    if (ok) expect(r.normalized?.primaryStage).toBeNull();
  });
  it.each([
    ["negated", "令和7年12月20日、岡山県津山市の件は、疑いが否定できない状況です。"],
    ["confirmed", "令和7年12月20日、岡山県津山市の件は、疑似患畜ではないことを確認しました。"],
    ["zone_lifted", "令和7年12月31日、岡山県津山市の移動制限区域の解除は見込みです。"],
    ["zone_lifted", "令和7年12月31日、岡山県津山市の移動制限区域は解除予定です。"],
  ] as const)("%s の語の否定形や見込みの形（%s）では通らない", (kind, s) => {
    const stage = kind === "zone_lifted" ? "movement_lifted" : kind === "confirmed" ? "confirmed" : null;
    const date_ = kind === "zone_lifted" ? date(2025, 12, 31) : date(2025, 12, 20);
    const read = oneSentence(s, { kind, primaryStage: stage, primaryDate: stage ? date_ : null, primaryDateQuote: stage ? s : null });
    const r = run(read, s);
    expect(r.pass).toBe(false);
    expect(issueOf(r, "kind", "stage_word")?.mandatory).toBe(true);
  });
  it("progress と control_done は kindQuote の語を見ない", () => {
    const s = "令和7年12月21日、岡山県津山市の農場で殺処分が完了しました。";
    const mk = (kind: ReadResult["kind"], stage: CaseStage | null) =>
      oneSentence(s, { kind, primaryStage: stage, primaryDate: stage ? date(2025, 12, 21) : null, primaryDateQuote: stage ? s : null });
    expect(run(mk("progress", "culling_done"), s).pass).toBe(true);
    expect(run(mk("progress", null), s).pass).toBe(true);
    expect(run(mk("control_done", "control_done"), s).pass).toBe(true);
  });
  const combos: Array<[ReadResult["kind"], CaseStage | null, boolean]> = [
    ["suspected", "suspected", true], ["suspected", "confirmed", false], ["suspected", null, false],
    ["confirmed", "confirmed", true], ["confirmed", "suspected", false], ["confirmed", null, false],
    ["control_done", "control_done", true], ["control_done", "culling_done", false],
    ["zone_lifted", "shipment_lifted", true], ["zone_lifted", "movement_lifted", true], ["zone_lifted", "surveillance_lifted", true],
    ["zone_lifted", "confirmed", false], ["zone_lifted", null, false],
    ["negated", null, true], ["negated", "suspected", false],
    ["progress", "culling_done", true], ["progress", null, true], ["progress", "confirmed", false],
  ];
  it.each(combos)("kind %s と primaryStage %s の組み合わせ → %s", (kind, stage, ok) => {
    // 語は全部入れた引用で、組み合わせの表だけを見る
    const s = "令和7年12月20日、岡山県津山市の農場で疑似患畜と簡易検査と移動制限の解除と陰性を確認しました。";
    const read = oneSentence(s, { kind, primaryStage: stage, primaryDate: stage ? date(2025, 12, 20) : null, primaryDateQuote: stage ? s : null });
    const r = run(read, s);
    expect(r.pass).toBe(ok);
    if (!ok) expect(issueOf(r, "primaryStage", "stage_word")?.mandatory).toBe(true);
  });
});

describe("verifyRead: 時系列と年の補完", () => {
  const sLater = "令和7年12月21日、岡山県津山市の農場で殺処分が完了しました。";
  const culling = (d: ReadDate) => oneSentence(sLater, { kind: "progress", primaryStage: "culling_done", primaryDate: d });
  it("前の段階より前の日付は必須で不合格", () => {
    const prev = caseOf({ confirmed: { date: "2025-12-22", time: null } });
    const r = run(culling(date(2025, 12, 21)), sLater, prev);
    expect(r.pass).toBe(false);
    expect(issueOf(r, "primaryDate", "chronology")?.mandatory).toBe(true);
    expect(run(culling(date(2025, 12, 21)), sLater, caseOf({ confirmed: { date: "2025-12-20", time: null } })).pass).toBe(true);
  });
  it("前の事例がなければ時系列は見ない", () => {
    expect(run(culling(date(2025, 12, 21)), sLater, null).pass).toBe(true);
  });
  it("搬出の解除と移動の解除の間は比べない", () => {
    const s = "令和7年12月25日、岡山県津山市の発生農場に係る移動制限を解除しました。";
    const read = oneSentence(s, { kind: "zone_lifted", primaryStage: "movement_lifted", primaryDate: date(2025, 12, 25) });
    const prev = caseOf({ confirmed: { date: "2025-12-20", time: null }, shipment_lifted: { date: "2025-12-30", time: null } });
    expect(run(read, s, prev).pass).toBe(true);
  });
  it("stageEvents の順の誤りは任意の行として落とす（pass のまま）", () => {
    const ev = "令和7年12月19日に殺処分が完了しました。";
    const evOk = "令和7年12月21日に殺処分が完了しました。";
    const r = run(
      withRead({
        stageEvents: [
          { stage: "culling_done", date: date(2025, 12, 19), quote: ev },
          { stage: "culling_done", date: date(2025, 12, 21), quote: evOk },
        ],
      }),
      `${TEXT}\n${ev}\n${evOk}`,
    );
    expect(r.pass).toBe(true);
    expect(issueOf(r, "stageEvents", "chronology")).toMatchObject({ mandatory: false });
    expect(r.droppedOptional).toContain("stageEvents");
    expect(r.normalized?.stages).toEqual({
      confirmed: { date: "2025-12-20", time: "09:00" },
      culling_done: { date: "2025-12-21", time: null },
    });
  });
  it("年のない日付はシーズンから補う（12 月は 2025 年、1 月は 2026 年）", () => {
    const s = "12月20日午前9時、岡山県津山市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。";
    const r = run(oneSentence(s, { primaryDate: date(null, 12, 20, "09:00") }), s);
    expect(r.pass).toBe(true);
    expect(r.normalized?.primaryStamp).toEqual({ date: "2025-12-20", time: "09:00" });
    expect(r.normalized?.yearCompleted).toBe(true);
    const s2 = s.replace("12月20日", "1月5日");
    const r2 = run(oneSentence(s2, { primaryDate: date(null, 1, 5, "09:00") }), s2);
    expect(r2.normalized?.primaryStamp?.date).toBe("2026-01-05");
    expect(r2.normalized?.yearCompleted).toBe(true);
  });
  it("年が書いてあれば補完でなく yearCompleted は false", () => {
    expect(run(good).normalized?.yearCompleted).toBe(false);
  });
  it("シーズンの範囲外（2024 年、2026-06-01 以降）は必須で不合格", () => {
    const mk = (y: number, m: number, dd: number) => {
      const s = `${y}年${m}月${dd}日午前9時、岡山県津山市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。`;
      return run(oneSentence(s, { primaryDate: date(y, m, dd, "09:00") }), s);
    };
    const old = mk(2024, 12, 20);
    expect(old.pass).toBe(false);
    expect(issueOf(old, "primaryDate", "year_completion")?.mandatory).toBe(true);
    expect(mk(2026, 6, 1).pass).toBe(false);
    expect(mk(2026, 5, 31).pass).toBe(true);
    expect(mk(2025, 6, 1).pass).toBe(true);
    expect(mk(2025, 2, 30).pass).toBe(false);
  });
  it("見込み日は estimates に入り、引用にない日付の行は落とす", () => {
    const e1 = "搬出制限区域の解除は令和7年12月30日の見込みです。";
    const r = run(
      withRead({
        estimates: [
          { target: "shipment", date: date(2025, 12, 30), quote: e1 },
          { target: "movement", date: date(2025, 12, 29), quote: e1 },
        ],
      }),
      `${TEXT}\n${e1}`,
    );
    expect(r.pass).toBe(true);
    expect(r.normalized?.estimates).toEqual({ shipment: "2025-12-30", movement: null, surveillance: null });
    expect(r.droppedOptional).toContain("estimates");
  });
});

describe("verifyRead: 文書の種類と文字層", () => {
  it("文字層なしは pass false、normalized null", () => {
    const r = run(good, "", null, { hasTextLayer: false });
    expect(r.pass).toBe(false);
    expect(r.normalized).toBeNull();
  });
  it.each(["other_pref", "drill", "notice", "irrelevant"] as const)("%s は pass true で値は空", (kind) => {
    const r = run({
      ...good, kind, kindQuote: null, prefecture: none, municipality: none, primaryStage: null, primaryDate: null, primaryDateQuote: null, ...bare,
    });
    expect(r.pass).toBe(true);
    expect(r.normalized).toMatchObject({ kind, prefCode: null, muniCode: null, primaryStage: null, primaryStamp: null, wildBirds: [], radiiKm: [], stages: {} });
  });
});

describe("verifyRead: 野鳥", () => {
  const row = "10/27 回収 宮城県 栗原市 死亡野鳥 カモ 簡易検査で陽性、遺伝子検査の結果、高病原性ではない";
  const wtext = `野鳥における鳥インフルエンザの検査結果\n${row}`;
  type Bird = ReadResult["wildBirds"][number];
  const bird = (patch: Partial<Bird> = {}): Bird => ({
    date: date(null, 10, 27), prefecture: "宮城県", municipality: "栗原市", species: "カモ", test: "negative", quote: row, ...patch,
  });
  const wild = (birds: Bird[]): ReadResult => ({
    ...good, kind: "wild_bird", kindQuote: null, prefecture: none, municipality: none, primaryStage: null, primaryDate: null, primaryDateQuote: null,
    ...bare, wildBirds: birds,
  });
  it("行ごとに検査して合格、年は補う", () => {
    const r = run(wild([bird()]), wtext);
    expect(r.pass).toBe(true);
    expect(r.normalized?.wildBirds).toEqual([
      { date: "2025-10-27", prefCode: "04", muniCode: "04213", muniName: "栗原市", species: "カモ", test: "negative" },
    ]);
    expect(r.normalized?.yearCompleted).toBe(true);
  });
  it("0 行は不合格", () => {
    const r = run(wild([]), wtext);
    expect(r.pass).toBe(false);
    expect(issueOf(r, "wildBirds")?.mandatory).toBe(true);
  });
  it("日付、都道府県、引用が違う行があれば不合格", () => {
    expect(run(wild([bird({ date: date(null, 10, 28) })]), wtext).pass).toBe(false);
    expect(run(wild([bird({ prefecture: "北海道" })]), wtext).pass).toBe(false);
    expect(run(wild([bird({ quote: "本文にない行" })]), wtext).pass).toBe(false);
    expect(run(wild([bird(), bird({ date: date(null, 10, 28) })]), wtext).pass).toBe(false);
  });
  it("N-3: 市町村が引用にない行は muniCode も muniName も null にして（読み手の出力を公開に残さない）、pass のまま", () => {
    const r = run(wild([bird({ municipality: "鳥取市" })]), wtext);
    expect(r.pass).toBe(true);
    expect(r.normalized?.wildBirds[0]).toMatchObject({ muniCode: null, muniName: null });
    const issue = r.issues.find((i) => i.field.startsWith("wildBirds"));
    expect(issue?.mandatory).toBe(false);
    expect(issue?.detail).toBe("row0:muni_value_not_in_quote");
    expect(issue?.detail).not.toContain("鳥取市");
    expect(JSON.stringify(r.normalized)).not.toContain("鳥取市");
  });
  it("N-3: 市町村が引用にはあるが、その県の索引にない行も muniName を null にする（引用にある名前を、索引で確かめられないまま出さない）", () => {
    // 引用には書かれている名前だが、宮城県の索引にない（実在しない市）
    const quote = "10/27 回収 宮城県 架空市 死亡野鳥 カモ 陰性";
    const r = run(wild([bird({ municipality: "架空市", quote })]), quote);
    expect(r.pass).toBe(true);
    expect(r.normalized?.wildBirds[0]).toMatchObject({ muniCode: null, muniName: null });
    expect(r.issues.find((i) => i.field.startsWith("wildBirds"))?.detail).toBe("row0:muni_not_in_prefecture");
  });
  it("市町村が null の行は muniCode も muniName も null", () => {
    const r = run(wild([bird({ municipality: null })]), wtext);
    expect(r.pass).toBe(true);
    expect(r.normalized?.wildBirds[0]).toMatchObject({ muniCode: null, muniName: null });
  });
  it("test の語が引用にない行は不合格（陰性の行を確定にしない）", () => {
    expect(run(wild([bird({ test: "hpai_confirmed" })]), wtext).pass).toBe(false);
    const unsure = "10/27 回収 宮城県 栗原市 死亡野鳥 カモ 簡易検査で陽性、確定は否定できない";
    expect(run(wild([bird({ test: "negative", quote: unsure })]), unsure).pass).toBe(false);
    expect(run(wild([bird({ test: "negative" })]), wtext).pass).toBe(true);
    const pos = "10/27 回収 宮城県 栗原市 死亡野鳥 カモ 簡易検査で陽性";
    expect(run(wild([bird({ test: "screening_positive", quote: pos })]), pos).pass).toBe(true);
    expect(run(wild([bird({ test: "negative", quote: pos })]), pos).pass).toBe(false);
  });
});

describe("verifyRead: 市町村名の書き方", () => {
  const pass = (name: string) => {
    const s = `令和7年12月20日午前9時、岡山県${name}の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。`;
    return run(oneSentence(s, { municipality: q(name, s) }), s);
  };
  it("郡と区を付けても、市町村は index の名前で引く", () => {
    const r1 = pass("苫田郡鏡野町");
    expect(r1.pass).toBe(true);
    expect(r1.normalized).toMatchObject({ muniCode: "33606", muniName: "鏡野町" });
    const r2 = pass("岡山市北区");
    expect(r2.pass).toBe(true);
    expect(r2.normalized).toMatchObject({ muniCode: "33100", muniName: "岡山市" });
  });
});

// 裁定（I-04 懸念 1、2）: 県の発表で引用に県名がない、確定の文が「本日」だけ。実物の岡山の確定の文の形を写した小さな文字列。
describe("verifyRead: 取得元の県と文書の発表日（省略可の引数）", () => {
  const head = "令和7年12月20日";
  const mq = "12月19日、津山市において高病原性鳥インフルエンザが疑われた事例について";
  const kq = "本日９時に国において高病原性鳥インフルエンザの疑似患畜と確定されました。";
  const text = `${head}\n${mq}は、遺伝子検査を実施した結果、${kq}`;
  const read = withRead({
    kindQuote: kq,
    prefecture: q("岡山県", mq),
    municipality: q("津山市", mq),
    primaryDate: date(2025, 12, 20, "09:00"),
    primaryDateQuote: kq,
    ...bare,
  });
  const go = (r: ReadResult, opts?: { sourcePrefCode?: string | null; announcedOn?: string | null }) =>
    verifyRead(r, { text, hasTextLayer: true, season: 2025 }, geo, null, opts);

  it("引数がなければ、県名も日付もない引用は不合格（今までどおり）", () => {
    const r = go(read);
    expect(r.pass).toBe(false);
    expect(issueOf(r, "prefecture", "value_in_quote")?.mandatory).toBe(true);
    expect(issueOf(r, "primaryDate", "value_in_quote")?.mandatory).toBe(true);
    expect(go(read, { sourcePrefCode: null, announcedOn: null }).pass).toBe(false);
  });
  it("取得元の県が読みの県と一致すれば都道府県は合格、一致しなければ不合格", () => {
    const only = withRead({ ...read, primaryDate: date(2025, 12, 20, "09:00") });
    const ok = go(only, { sourcePrefCode: "33", announcedOn: "2025-12-20" });
    expect(ok.pass).toBe(true);
    expect(ok.normalized).toMatchObject({ prefCode: "33", muniCode: "33203", primaryStamp: { date: "2025-12-20", time: "09:00" } });
    const other = go(only, { sourcePrefCode: "31", announcedOn: "2025-12-20" });
    expect(other.pass).toBe(false);
    expect(issueOf(other, "prefecture", "value_in_quote")?.mandatory).toBe(true);
  });
  it("県の取得元でも、市町村は引用に必要（取得元の県は市町村を救わない）", () => {
    const r = go(withRead({ ...read, municipality: q("鏡野町", mq) }), { sourcePrefCode: "33", announcedOn: "2025-12-20" });
    expect(r.pass).toBe(false);
    expect(issueOf(r, "municipality", "value_in_quote")?.mandatory).toBe(true);
  });
  it("「本日」で年月日のない引用は、発表日と同じ日なら合格。発表日が違うと不合格", () => {
    expect(go(read, { sourcePrefCode: "33", announcedOn: "2025-12-20" }).pass).toBe(true);
    const wrongDay = go(read, { sourcePrefCode: "33", announcedOn: "2025-12-22" });
    expect(wrongDay.pass).toBe(false);
    expect(issueOf(wrongDay, "primaryDate", "value_in_quote")?.mandatory).toBe(true);
  });
  it("時刻は引用で照合する（本日10時と読むと不合格）、「本日」がなければ発表日で救わない", () => {
    const o = { sourcePrefCode: "33", announcedOn: "2025-12-20" };
    expect(go(withRead({ ...read, primaryDate: date(2025, 12, 20, "10:00") }), o).pass).toBe(false);
    const noToday = "９時に国において高病原性鳥インフルエンザの疑似患畜と確定されました。";
    const t2 = `${head}\n${mq}は、${noToday}`;
    const r2 = verifyRead(withRead({ ...read, kindQuote: noToday, primaryDateQuote: noToday }), { text: t2, hasTextLayer: true, season: 2025 }, geo, null, o);
    expect(r2.pass).toBe(false);
  });
  it("引用に年月日があるときは、「本日」があっても発表日で救わない", () => {
    const explicit = "12月19日に簡易検査で陽性、本日９時に国において疑似患畜と確定されました。";
    const t3 = `${head}\n${mq}は、${explicit}`;
    const r = verifyRead(withRead({ ...read, kindQuote: explicit, primaryDateQuote: explicit }), { text: t3, hasTextLayer: true, season: 2025 }, geo, null, {
      sourcePrefCode: "33", announcedOn: "2025-12-20",
    });
    expect(r.pass).toBe(false);
  });
  it("detail に引用を入れない", () => {
    for (const i of go(read).issues) expect(i.detail).not.toContain("本日");
  });
});

// レビュー（Important 1、2）: 取得元の県の救済は引用にどの都道府県名もないときだけ。地名は部分一致にしない。
describe("verifyRead: 取得元の県の救済の範囲と、地名の部分一致", () => {
  const sentence = (prefix: string, muni: string) =>
    `令和7年12月20日午前9時、${prefix}${muni}の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。`;
  const go = (s: string, patch: Partial<ReadResult>, opts?: { sourcePrefCode?: string | null }) =>
    verifyRead(oneSentence(s, patch), { text: s, hasTextLayer: true, season: 2025 }, geo, null, opts);

  it("引用が別の県名を明記していれば、取得元の県が読みの県と一致しても救わない（福島の取得元、北海道伊達市）", () => {
    const s = sentence("北海道", "伊達市");
    const r = go(s, { prefecture: q("福島県", s), municipality: q("伊達市", s) }, { sourcePrefCode: "07" });
    expect(r.pass).toBe(false);
    expect(issueOf(r, "prefecture", "value_in_quote")?.mandatory).toBe(true);
    expect(r.normalized?.prefCode).toBeNull();
  });
  it("引用にどの県名もなければ、取得元の県の一致で救う", () => {
    const s = sentence("", "津山市");
    const r = go(s, { prefecture: q("岡山県", s), municipality: q("津山市", s) }, { sourcePrefCode: "33" });
    expect(r.pass).toBe(true);
    expect(r.normalized?.prefCode).toBe("33");
  });
  it("引用が null の都道府県は、取得元の県の一致で救う。不一致や取得元なしは不合格", () => {
    const s = sentence("", "津山市");
    const read = { prefecture: q("岡山県", null), municipality: q("津山市", s) };
    expect(go(s, read, { sourcePrefCode: "33" }).pass).toBe(true);
    expect(go(s, read, { sourcePrefCode: "31" }).pass).toBe(false);
    expect(go(s, read).pass).toBe(false);
  });
  it("市町村: 広島市は北広島市の一部でも、郡山市は大和郡山市の一部でも不合格", () => {
    const s1 = sentence("広島県", "北広島市");
    const r1 = go(s1, { prefecture: q("広島県", s1), municipality: q("広島市", s1) });
    expect(r1.pass).toBe(false);
    expect(issueOf(r1, "municipality", "value_in_quote")?.mandatory).toBe(true);
    const s2 = sentence("福島県", "大和郡山市");
    const r2 = go(s2, { prefecture: q("福島県", s2), municipality: q("郡山市", s2) });
    expect(r2.pass).toBe(false);
    expect(issueOf(r2, "municipality", "value_in_quote")?.mandatory).toBe(true);
  });
  it("市町村: 長い名前の一部でない出現が別にあれば合格、区や郡つきの書き方も合格", () => {
    const s = `令和7年12月20日午前9時、広島県広島市と北広島市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。`;
    const r = go(s, { prefecture: q("広島県", s), municipality: q("広島市", s) });
    expect(r.pass).toBe(true);
    expect(r.normalized?.muniCode).toBe("34100");
    const s2 = sentence("岡山県", "岡山市北区");
    expect(go(s2, { municipality: q("岡山市北区", s2) }).pass).toBe(true);
  });
  it("都道府県: 京都は東京都の一部でも通らない。正式名なら合格", () => {
    const s = sentence("東京都", "千代田区");
    const bad = go(s, { prefecture: q("京都", s), municipality: q("千代田区", s) });
    expect(bad.pass).toBe(false);
    expect(bad.normalized?.prefCode).toBeNull();
    const s2 = sentence("京都府", "京都市");
    const ok = go(s2, { prefecture: q("京都府", s2), municipality: q("京都市", s2) });
    expect(ok.pass).toBe(true);
    expect(ok.normalized?.prefCode).toBe("26");
    expect(go(s2, { prefecture: q("京都", s2), municipality: q("京都市", s2) }).pass).toBe(true); // 値は短くても、引用に正式名がある
  });
});

// 裁定 Q-a の続き: 県の発表で都道府県が null と読まれたとき、本文に別の県名がなければ取得元の県で補う。
describe("verifyRead: 都道府県が null のとき取得元の県で補う", () => {
  const s = "令和7年12月20日午前9時、津山市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。";
  const nullPref = { prefecture: none, municipality: q("津山市", s) };
  const go = (text: string, opts?: { sourcePrefCode?: string | null }) =>
    verifyRead(oneSentence(s, nullPref), { text, hasTextLayer: true, season: 2025 }, geo, null, opts);
  const filled = (r: VerifyReport) => r.issues.find((i) => i.field === "prefecture" && i.detail === "prefecture_filled_from_source");

  it("本文に県名がなく、取得元の県があれば補って合格。補った印が任意の注記で残る", () => {
    const r = go(s, { sourcePrefCode: "33" });
    expect(r.pass).toBe(true);
    expect(r.normalized).toMatchObject({ prefCode: "33", muniCode: "33203", muniName: "津山市" });
    expect(filled(r)?.mandatory).toBe(false);
  });
  it("本文にある県名が取得元の県だけなら補う（部署名などに県名がある県の発表）", () => {
    const r = go(`岡山県農林水産部\n${s}`, { sourcePrefCode: "33" });
    expect(r.pass).toBe(true);
    expect(r.normalized?.prefCode).toBe("33");
  });
  it("本文に別の県名があれば補わず不合格", () => {
    for (const text of [`鳥取県と連携します。\n${s}`, `岡山県農林水産部\n${s}\n鳥取県と連携します。`]) {
      const r = go(text, { sourcePrefCode: "33" });
      expect(r.pass).toBe(false);
      expect(issueOf(r, "prefecture", "value_in_quote")).toMatchObject({ mandatory: true, detail: "missing_value" });
      expect(r.normalized?.prefCode).toBeNull();
      expect(filled(r)).toBeUndefined();
    }
  });
  it("国や市のページ（取得元の県なし）は補わない", () => {
    for (const opts of [undefined, { sourcePrefCode: null }]) {
      const r = go(s, opts);
      expect(r.pass).toBe(false);
      expect(issueOf(r, "prefecture", "value_in_quote")).toMatchObject({ mandatory: true, detail: "missing_value" });
      expect(r.normalized?.prefCode).toBeNull();
    }
  });
  it("市町村は補った県の中で照合する（鳥取県の取得元に津山市はない）", () => {
    const r = go(s, { sourcePrefCode: "31" });
    expect(r.pass).toBe(false);
    expect(issueOf(r, "municipality", "muni_exists")?.mandatory).toBe(true);
    expect(r.normalized?.muniCode).toBeNull();
  });
  it("値が null でも、本文にない引用があれば補わない", () => {
    const r = verifyRead(oneSentence(s, { ...nullPref, prefecture: q(null, "どこにもない文") }), { text: s, hasTextLayer: true, season: 2025 }, geo, null, {
      sourcePrefCode: "33",
    });
    expect(r.pass).toBe(false);
    expect(issueOf(r, "prefecture")?.mandatory).toBe(true);
  });
});

// 指示文は題などから年を補うことを許す。引用が月日だけでも、値の年がシーズンから決まる年と同じなら合格。
describe("verifyRead: 月日だけの引用と、年のある値", () => {
  const mk = (md: string) => `${md}午前9時、岡山県津山市の養鶏場で、高病原性鳥インフルエンザの疑似患畜を確認しました。`;
  const primary = (md: string, d: ReadDate, opts?: { announcedOn?: string | null }) => {
    const s = mk(md);
    return verifyRead(oneSentence(s, { primaryDate: d }), { text: s, hasTextLayer: true, season: 2025 }, geo, null, opts);
  };

  it("主の日付: 年がシーズンと合えば合格（12 月は 2025 年、1 月は 2026 年）。年は補った扱い", () => {
    const r = primary("12月20日", date(2025, 12, 20, "09:00"));
    expect(r.pass).toBe(true);
    expect(r.normalized?.primaryStamp).toEqual({ date: "2025-12-20", time: "09:00" });
    expect(r.normalized?.yearCompleted).toBe(true);
    const r2 = primary("1月5日", date(2026, 1, 5, "09:00"));
    expect(r2.pass).toBe(true);
    expect(r2.normalized?.primaryStamp?.date).toBe("2026-01-05");
  });
  it("主の日付: 年がシーズンと合わなければ不合格", () => {
    for (const d of [date(2026, 12, 20, "09:00"), date(2024, 12, 20, "09:00"), date(2025, 1, 5, "09:00")]) {
      const r = primary(d.month === 1 ? "1月5日" : "12月20日", d);
      expect(r.pass).toBe(false);
      expect(issueOf(r, "primaryDate", "value_in_quote")).toMatchObject({ mandatory: true, detail: "date_not_in_quote" });
    }
  });
  it("主の日付: 引用に別の年が書いてあれば、月日が合っても不合格", () => {
    const r = primary("令和6年12月20日", date(2025, 12, 20, "09:00"));
    expect(r.pass).toBe(false);
    expect(issueOf(r, "primaryDate", "value_in_quote")?.mandatory).toBe(true);
  });
  it("主の日付: 月日だけの引用でも、時刻が合わなければ不合格", () => {
    expect(primary("12月20日", date(2025, 12, 20, "10:00")).pass).toBe(false);
  });
  it("「本日」だけの引用と、時刻だけの引用は、今までどおり不合格", () => {
    const today = "本日９時に国において高病原性鳥インフルエンザの疑似患畜と確定されました。";
    const timeOnly = "９時に国において高病原性鳥インフルエンザの疑似患畜と確定されました。";
    for (const kq of [today, timeOnly]) {
      const text = `津山市において疑われた事例について\n${kq}`;
      const read = withRead({
        kindQuote: kq,
        prefecture: q("岡山県", null),
        municipality: q("津山市", text.split("\n")[0]!),
        primaryDate: date(2025, 12, 20, "09:00"),
        primaryDateQuote: kq,
        ...bare,
      });
      const r = verifyRead(read, { text, hasTextLayer: true, season: 2025 }, geo, null, { sourcePrefCode: "33" });
      expect(r.pass).toBe(false);
      expect(issueOf(r, "primaryDate", "value_in_quote")?.mandatory).toBe(true);
    }
  });
  it("段階の出来事と見込み日: 年がシーズンと合えば採り、合わなければ落とす", () => {
    const ev = "12月21日に殺処分を完了しました。";
    const es = "1月10日に搬出制限区域を解除する見込みです。";
    const base = mk("令和7年12月20日");
    const text = [base, ev, es].join("\n");
    const go = (evYear: number, esYear: number) =>
      verifyRead(
        oneSentence(base, {
          stageEvents: [{ stage: "culling_done", date: date(evYear, 12, 21), quote: ev }],
          estimates: [{ target: "shipment", date: date(esYear, 1, 10), quote: es }],
        }),
        { text, hasTextLayer: true, season: 2025 },
        geo,
        null,
      );
    const ok = go(2025, 2026);
    expect(ok.pass).toBe(true);
    expect(ok.normalized?.stages.culling_done).toEqual({ date: "2025-12-21", time: null });
    expect(ok.normalized?.estimates.shipment).toBe("2026-01-10");
    expect(ok.droppedOptional).toEqual([]);
    const bad = go(2026, 2025);
    expect(bad.pass).toBe(true);
    expect(bad.normalized?.stages.culling_done).toBeUndefined();
    expect(bad.normalized?.estimates.shipment).toBeNull();
    expect(bad.droppedOptional.sort()).toEqual(["estimates", "stageEvents"]);
    expect(bad.issues.filter((i) => i.detail === "row0:date_not_in_quote").length).toBe(2);
  });
});

// 処分した羽の数は、飼っている羽数（headCount）として採らない。両方の語がある引用も採らない側に倒す。
describe("verifyRead: 羽数の引用が処分の数", () => {
  const go = (quote: string, value: number) => {
    const text = `${TEXT}\n${quote}`;
    return verifyRead(withRead({ headCount: q(value, quote) }), { text, hasTextLayer: true, season: 2025 }, geo, null);
  };
  it("処分の数の引用（殺処分、処分、とう汰）は採らず、任意の項目として落とす", () => {
    for (const quote of ["12月21日に殺処分を完了しました（75,137羽）。", "処分羽数 75,137羽（羽数精査中）", "とう汰した羽数は75,137羽です。"]) {
      const r = go(quote, 75137);
      expect(r.pass).toBe(true);
      expect(r.normalized?.headCount).toBeNull();
      expect(r.droppedOptional).toContain("headCount");
      expect(issueOf(r, "headCount")?.mandatory).toBe(false);
    }
  });
  it("飼養の引用は今までどおり採る", () => {
    for (const quote of [S2, "飼養羽数 約7.5万羽", "約7万5千羽を飼養しています。"]) {
      const value = quote === S2 ? 430000 : 75000;
      const r = go(quote, value);
      expect(r.normalized?.headCount).toBe(value);
      expect(r.droppedOptional).not.toContain("headCount");
    }
  });
  it("処分と飼養の両方がある引用は採らない", () => {
    const r = go("飼養羽数約7.5万羽のうち、75,000羽の殺処分を完了しました。", 75000);
    expect(r.normalized?.headCount).toBeNull();
    expect(r.droppedOptional).toContain("headCount");
  });
});
