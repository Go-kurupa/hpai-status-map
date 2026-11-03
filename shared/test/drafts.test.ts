// M-18: 声かけ文の雛形と検査。説明文（M-19）の検査も同じ部品を通す。
import { describe, expect, it } from "vitest";
import type { Case } from "../src/types";
import {
  checkNeighborText,
  checkWorkerMessage,
  dateNumbers,
  draftFactsOf,
  NEIGHBOR_TOPICS,
  neighborAllowedNumbers,
  neighborOfficialPart,
  neighborTemplate,
  ownOutbreakNoticeTemplate,
  workerMessageTemplate,
} from "../src/drafts";
import { isDraftBudgetStopped } from "../src/budget";
import { OFFICIAL_GUIDANCE, type OfficialGuidance } from "../src/guidance/official";
import { DEFAULT_RUNTIME_SETTINGS } from "../src/types";
import { findForbiddenPhrases } from "../src/wording";

const F = { muniName: "津山市", date: "2025-12-19", allowedNumbers: dateNumbers("2025-12-19") };
const OK = workerMessageTemplate({ muniName: "津山市", date: "2025-12-19", stage: "confirmed" });
const failures = (text: string) => checkWorkerMessage(text, F).failures;

describe("dateNumbers", () => {
  it("年、月、日を頭の 0 なしで返す", () => {
    expect(dateNumbers("2025-12-19")).toEqual(["2025", "12", "19"]);
    expect(dateNumbers("2026-01-05")).toEqual(["2026", "1", "5"]);
  });
  it("日付でなければ RangeError", () => {
    expect(() => dateNumbers("2025-02-30")).toThrow(RangeError);
  });
});

describe("workerMessageTemplate", () => {
  it("疑い: 確定ではないと書き、2 つの核を含む", () => {
    expect(workerMessageTemplate({ muniName: "津山市", date: "2025-12-19", stage: "suspected" })).toBe(
      "12月19日、津山市で鳥インフルエンザの疑いの発表がありました（確定ではありません）。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。",
    );
  });
  it("確定", () => {
    expect(workerMessageTemplate({ muniName: "津山市", date: "2025-12-19", stage: "confirmed" })).toBe(
      "12月19日、津山市で鳥インフルエンザの発生が確認されました。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。",
    );
  });
  it("頭の 0 のある月日でも、自分の検査に通る（1 月 5 日）", () => {
    for (const stage of ["suspected", "confirmed"] as const) {
      const f = { muniName: "津山市", date: "2026-01-05", stage };
      const t = workerMessageTemplate(f);
      expect(t).toContain("1月5日");
      expect(checkWorkerMessage(t, { muniName: f.muniName, date: f.date, allowedNumbers: dateNumbers(f.date) })).toEqual({ ok: true, failures: [] });
    }
  });
  it("2 つの雛形は、禁句も煽る語も持たず、自分の検査に通る", () => {
    for (const stage of ["suspected", "confirmed"] as const) {
      const t = workerMessageTemplate({ muniName: "津山市", date: "2025-12-19", stage });
      expect(findForbiddenPhrases(t)).toEqual([]);
      expect(checkWorkerMessage(t, F)).toEqual({ ok: true, failures: [] });
    }
  });
});

describe("checkWorkerMessage", () => {
  it("雛形は合格", () => {
    expect(checkWorkerMessage(OK, F)).toEqual({ ok: true, failures: [] });
  });
  it("全角数字と空白の混じった日付も日付として通る", () => {
    const t = OK.replace("12月19日", "１２ 月 １９ 日");
    expect(checkWorkerMessage(t, F)).toEqual({ ok: true, failures: [] });
  });
  it("別の月の日付に埋もれた同じ数字は日付と認めない（2月19日 と 12月19日）", () => {
    const f = { muniName: "津山市", date: "2026-02-19", allowedNumbers: dateNumbers("2026-02-19") };
    // 本文の「12月19日」は 2月19日 ではない。数字 12 も許されない
    const r = checkWorkerMessage(OK, f);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("missing_date");
    expect(r.failures).toContain("unknown_number:12");
  });
  it("市町村名が無い: missing_muni", () => {
    expect(failures(OK.replace("津山市", "この地域"))).toContain("missing_muni");
  });
  it("日付が無い: missing_date", () => {
    expect(failures(OK.replace("12月19日、", ""))).toContain("missing_date");
  });
  it("発生地に近づかない旨が無い: missing_core_avoid", () => {
    expect(failures(OK.replace("発生地の近くに行かないでください。", "気をつけてください。"))).toContain("missing_core_avoid");
    // 「近く」だけ、「行かない」だけでは足りない
    expect(failures(OK.replace("発生地の近くに行かないでください。", "近くの様子を見てください。"))).toContain("missing_core_avoid");
    expect(failures(OK.replace("発生地の近くに行かないでください。", "出かけないでください。"))).toContain("missing_core_avoid");
  });
  it("近づかない旨は 行かない／行かず／立ち寄らない／近づかない のどれでもよい", () => {
    for (const v of ["行かないでください", "行かずにください", "立ち寄らないでください", "近づかないでください"]) {
      expect(failures(OK.replace("行かないでください", v))).not.toContain("missing_core_avoid");
    }
  });
  it("消毒と着替えのどちらかが無い: missing_core_disinfect", () => {
    expect(failures(OK.replace("消毒と着替え", "消毒"))).toContain("missing_core_disinfect");
    expect(failures(OK.replace("消毒と着替え", "着替え"))).toContain("missing_core_disinfect");
  });
  it("事実にない数字: unknown_number", () => {
    const r = checkWorkerMessage("約43万羽です。", F);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("unknown_number:43");
  });
  it("許した数字は通る（年の言い方）", () => {
    expect(failures(OK.replace("12月19日", "2025年12月19日"))).toEqual([]);
  });
  it("漢数字の数と単位: unknown_kanji_number", () => {
    expect(failures("三キロ以内です。")).toContain("unknown_kanji_number:三キロ");
    expect(failures(`${OK}二人で来ます。`)).toContain("unknown_kanji_number:二人");
    expect(failures(`${OK}十分に気をつけてください。`)).not.toContain("unknown_kanji_number:十分");
  });
  it("煽る語: sensational", () => {
    expect(failures("大変危険です。")).toContain("sensational:危険");
    for (const w of ["危ない", "緊急事態", "非常事態", "パニック", "恐怖", "壊滅", "猛威", "爆発", "まん延", "蔓延", "大流行", "絶対", "ホットスポット", "また発生しやすい"]) {
      expect(failures(`${OK}${w}です。`)).toContain(`sensational:${w}`);
    }
  });
  it("禁句: forbidden", () => {
    expect(failures("卵は安全です。")).toContain("forbidden:安全");
    expect(failures(`${OK}安心してください。`)).toContain("forbidden:安心");
  });
  it("人の健康の断定: health", () => {
    for (const w of ["感染しません", "感染しない", "うつりません", "うつらない", "受診", "病院", "発症"]) {
      expect(failures(`${OK}${w}。`)).toContain(`health:${w}`);
    }
  });
  it("空の文は、核も市町村も日付も無い", () => {
    const r = checkWorkerMessage("", F);
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(expect.arrayContaining(["missing_muni", "missing_date", "missing_core_avoid", "missing_core_disinfect"]));
  });
});

describe("checkNeighborText", () => {
  const allowed = ["2025", "12", "19"];
  it("人の健康の断定を health で落とす", () => {
    expect(checkNeighborText("人には感染しません。", allowed).failures).toContain("health:感染しません");
    expect(checkNeighborText("心配なら受診してください。", allowed).failures).toContain("health:受診");
  });
  it("数字、漢数字、煽る語、禁句を落とす", () => {
    expect(checkNeighborText("約43万羽です。", allowed).failures).toContain("unknown_number:43");
    expect(checkNeighborText("三キロ以内です。", allowed).failures).toContain("unknown_kanji_number:三キロ");
    expect(checkNeighborText("大変危険です。", allowed).failures).toContain("sensational:危険");
    expect(checkNeighborText("卵は安全です。", allowed).failures).toContain("forbidden:安全");
  });
  it("声かけ文の核（市町村、日付、近づかない）は求めない", () => {
    expect(checkNeighborText("近所の農場で検査が行われています。", allowed)).toEqual({ ok: true, failures: [] });
  });
  it("許した数字は通る", () => {
    expect(checkNeighborText("12月19日に発表がありました。", allowed).ok).toBe(true);
  });
});

function mkCase(o: Partial<Case>): Case {
  return {
    id: "c1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-19", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2025-12-19T12:00:00+09:00",
    ...o,
  };
}

describe("draftFactsOf（下書きを作ってよい事例か）", () => {
  it("確定があれば確定の日、なければ疑いの日", () => {
    expect(draftFactsOf(mkCase({}))).toEqual({ muniName: "津山市", date: "2025-12-19", stage: "confirmed" });
    expect(
      draftFactsOf(mkCase({ stages: { suspected: { date: "2025-12-18", time: null } } })),
    ).toEqual({ muniName: "津山市", date: "2025-12-18", stage: "suspected" });
    expect(
      draftFactsOf(mkCase({ stages: { suspected: { date: "2025-12-18", time: null }, confirmed: { date: "2025-12-19", time: null } } })),
    ).toEqual({ muniName: "津山市", date: "2025-12-19", stage: "confirmed" });
  });
  it("確認中、再現、否定、市町村なし、段階なしは null", () => {
    expect(draftFactsOf(mkCase({ confirmState: "reviewing" }))).toBeNull();
    expect(draftFactsOf(mkCase({ confirmState: "replay" }))).toBeNull();
    expect(draftFactsOf(mkCase({ negation: "negated" }))).toBeNull();
    expect(draftFactsOf(mkCase({ muniCode: null }))).toBeNull();
    expect(draftFactsOf(mkCase({ muniName: null }))).toBeNull();
    expect(draftFactsOf(mkCase({ stages: { culling_done: { date: "2025-12-20", time: null } } }))).toBeNull();
  });
  it("国の過去の資料（national）と運営者の確定（operator）は対象", () => {
    expect(draftFactsOf(mkCase({ confirmState: "national" }))).not.toBeNull();
    expect(draftFactsOf(mkCase({ confirmState: "operator" }))).not.toBeNull();
  });
});

describe("近隣への説明文（M-19）の雛形と公式の部分", () => {
  it("話題は approach、human_infection、food、burial、rumor の順", () => {
    expect([...NEIGHBOR_TOPICS]).toEqual(["approach", "human_infection", "food", "burial", "rumor"]);
  });

  it("公式の部分は OFFICIAL_GUIDANCE の文を一字も変えずに、話題の順に並べる", () => {
    const part = neighborOfficialPart();
    const expected = NEIGHBOR_TOPICS.flatMap((t) => OFFICIAL_GUIDANCE.find((g) => g.topic === t)!.statements);
    expect(part.map(({ text, sourceTitle, sourceUrl, checkedOn }) => ({ text, sourceTitle, sourceUrl, checkedOn }))).toEqual(expected);
    // 死んだ鳥と数羽飼っている方は入れない
    const excluded = ["dead_bird", "small_flock"].flatMap((t) => OFFICIAL_GUIDANCE.find((g) => g.topic === t)!.statements.map((x) => x.text));
    for (const t of excluded) expect(part.map((x) => x.text)).not.toContain(t);
  });

  it("見出しが付く", () => {
    expect(neighborOfficialPart()[0]!.heading).toBe("農場に近づかないでください");
  });

  it("人への感染は公式の文のまま（差し替えた公式の文が先頭に来る）", () => {
    const fake: OfficialGuidance[] = [
      {
        topic: "human_infection",
        heading: "人への感染",
        statements: [{ text: "公式の文", sourceTitle: "題", sourceUrl: "https://example.test/a", checkedOn: "2026-11-04" }],
      },
    ];
    expect(neighborOfficialPart(fake)[0]).toMatchObject({ text: "公式の文", sourceTitle: "題", sourceUrl: "https://example.test/a", checkedOn: "2026-11-04" });
  });

  it("許す数字は入力の数字だけ（全角の数字も同じ数字。重複は 1 つ）", () => {
    expect(neighborAllowedNumbers("防鳥ネットは２重。見回りは 1 日3回、2回目は夕方")).toEqual(["2", "1", "3"]);
    expect(neighborAllowedNumbers("数字はありません")).toEqual([]);
  });

  it("農場の雛形は入力の文をそのまま入れ、検査に通る（全角の数字でも）", () => {
    const measures = "入口で長靴を履き替え、消毒しています。\n防鳥ネットは２重にしています。";
    for (const a of ["meeting", "circular"] as const) {
      const t = neighborTemplate(`  ${measures}  `, a);
      expect(t).toContain(measures);
      expect(checkNeighborText(t, neighborAllowedNumbers(measures))).toEqual({ ok: true, failures: [] });
    }
  });

  it("回覧の雛形にだけ問い合わせ先の空欄がある", () => {
    expect(neighborTemplate("消毒しています。", "circular")).toContain("問い合わせ先: （　");
    expect(neighborTemplate("消毒しています。", "meeting")).not.toContain("問い合わせ先");
  });

  it("入力の文が煽る語を含めば、雛形も検査に落ちる（落ちた理由は呼び手が入力の問題として示す）", () => {
    expect(checkNeighborText(neighborTemplate("安心してください。", "meeting"), []).failures).toContain("forbidden:安心");
  });

  it("発生時の雛形: 日付と疑い・確認の空欄、問い合わせ先の空欄、農場に近づかない。数字がなく、検査に通る", () => {
    const t = ownOutbreakNoticeTemplate();
    expect(t).toMatch(/（　+月　+日）/u);
    expect(t).toContain("【疑い／発生の確認】");
    expect(t).toMatch(/問い合わせ先: （　+）/u);
    expect(t).toContain("農場には、近づかないでください");
    expect(t).not.toContain("周りの道"); // 近所の方が暮らす道まで避けるよう頼まない
    expect(t).not.toMatch(/\d/u);
    expect(checkNeighborText(t, [])).toEqual({ ok: true, failures: [] });
    expect(findForbiddenPhrases(t)).toEqual([]);
  });
});

describe("近隣への説明文の検査: 入力にない言い切り（レビュー指摘 3）", () => {
  const IN = "入口で長靴を履き替え、消毒しています。";
  const fails = (text: string, input = IN) => checkNeighborText(text, neighborAllowedNumbers(input), { input }).failures;

  it.each([
    ["卵は食べても問題ありません。"],
    ["人体への影響はありません。"],
    ["ご心配には及びません。"],
    ["心配はいりません。"],
    ["どうぞ心配なさらないでください。 大丈夫です。"],
    ["鶏肉は召し上がっていただいて差し支えありません。"],
    ["人にうつることはありません。"],
    ["ウイルスが入る可能性はありません。"],
    ["健康への害はありません。"],
    ["卵も鶏肉も無害です。"],
    ["住民の皆さまへの影響は出ません。"],
    // レビュー 2: 助詞「が」と「ない」「ございません」「考えにくい」の言い換え
    ["問題がありません。"],
    ["問題がございません。"],
    ["問題ございません。"],
    ["問題なくお過ごしください。"],
    ["心配ないです。"],
    ["心配がいりません。"],
    ["ご心配はございません。"],
    ["ご安心ください。"],
    ["人への影響がありません。"],
    ["影響がございません。"],
    ["人にうつることがありません。"],
    ["人にうつることはないと考えられます。"],
    ["感染のおそれがありません。"],
    ["感染のおそれはほとんどありません。"],
    ["人に感染することは考えにくいです。"],
    ["感染の可能性が低いです。"],
    ["可能性がゼロです。"],
    ["リスクは低いと考えられます。"],
    ["健康への害がありません。"],
    ["支障がありません。"],
  ])("『%s』は雛形に戻す（落ちる）", (text) => {
    const f = fails(`${IN}${text}`);
    expect(f.length, text).toBeGreaterThan(0);
  });

  it("落ちた理由は符号で残り、出力の断片を含まない", () => {
    const f = fails(`${IN}卵は食べても問題ありません。`);
    expect(f.some((x) => x.startsWith("assurance:"))).toBe(true);
    expect(f.join(" ")).not.toContain("食べても");
  });

  it("入力にない卵、鶏肉、人体、健康、感染、うつるの話は、言い切りでなくても落ちる", () => {
    for (const w of ["卵", "鶏肉", "人体", "健康", "食べ", "感染", "うつる", "うつり"]) {
      expect(fails(`${IN}${w}についても気をつけています。`), w).toContain(`outside_topic:${w}`);
    }
  });

  it("入力に感染の語があれば通る。入力にあった言い回しは、返事でも通る", () => {
    const input = "感染を広げないために、車両の消毒をしています。";
    expect(fails("感染を広げないために、車両の消毒をしています。", input)).toEqual([]);
    const said = "心配ないですと言われたら、国の説明を示します。";
    expect(fails("心配ないですと言われたら、国の説明を示します。", said).some((x) => x.startsWith("assurance:"))).toBe(false);
  });

  it("入力にその語があれば、話題の語は通る（農場が自分で書いた対策）", () => {
    const input = "卵の出荷の前に、集卵の道具を消毒しています。";
    expect(fails("卵の出荷の前に、道具を消毒しています。", input)).toEqual([]);
  });

  it("対策の文として普通の文は通る（感染を広げない、問題を減らす、など）", () => {
    for (const ok of [
      "鶏舎の入口で長靴を履き替え、消毒をしています。",
      "ウイルスを持ち込まない、広げないために、野鳥が入らないようネットを張っています。",
      "気になることがあれば、いつでもお尋ねください。",
      "問題があれば、すぐ家畜保健衛生所に連絡します。",
      "消毒を徹底しています。",
      "ご協力をお願いします。",
      "ご不明な点は、お気軽にお尋ねください。",
      "病気が入らないよう、出入りする車両を消毒しています。",
      "鳥の害がないよう、ネットの破れを毎日見回っています。",
      "気になることや心配なことがあれば、いつでもご連絡ください。",
      "影響を減らすため、作業の時間を分けています。",
      "ウイルスを持ち込まないよう、靴を履き替えています。",
      "問題のある箇所は、見つけしだい直しています。",
      "ウイルスが入るリスクが低くなるよう、野鳥の対策をしています。",
    ]) {
      expect(fails(ok), ok).toEqual([]);
    }
  });

  it("入力の文に言い切りがあれば、入力の検査（opts なし）で知らせる。出力では入力にある言い回しは通す", () => {
    const input = "卵は食べても問題ありません。と聞かれたら、国の説明を示します。";
    expect(checkNeighborText(input, []).failures.some((x) => x.startsWith("assurance:"))).toBe(true);
    expect(fails("卵は食べても問題ありません。", input).some((x) => x.startsWith("assurance:"))).toBe(false);
  });

  it("従来の呼び方（opts なし）でも、数字、煽る語、禁止語、健康の断定は同じに落ちる", () => {
    expect(checkNeighborText("卵は安全です。", []).failures).toContain("forbidden:安全");
    expect(checkNeighborText("約43万羽です。", []).failures).toContain("unknown_number:43");
  });
});

describe("decideDraftBudget（説明文と声かけ文は soft で止める）", () => {
  const s = { ...DEFAULT_RUNTIME_SETTINGS, softLimitJpy: 8000, hardLimitJpy: 10000 };
  const m = (jpy: number) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedJpy: jpy });
  it("soft 未満は下書きする、soft 以上は止める（境界は含む）", () => {
    expect(isDraftBudgetStopped(m(7999.99), s)).toBe(false);
    expect(isDraftBudgetStopped(m(8000), s)).toBe(true);
    expect(isDraftBudgetStopped(m(10600), s)).toBe(true);
  });
});
