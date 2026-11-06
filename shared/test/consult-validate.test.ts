import { describe, expect, it } from "vitest";
import { OUT_OF_SCOPE_TEXT } from "../src/consult/scope";
import { stripCardRefs, validateFollowup } from "../src/consult/validate";
import type { ConsultCard } from "../src/consult/types";

function makeCard(over: Partial<ConsultCard> & { id: string }): ConsultCard {
  return {
    origin: `出どころ-${over.id}`,
    action: "対策",
    appliesTo: "条件",
    evidence: "recommendation",
    evidenceNote: "メモ",
    quote: "引用",
    sourceId: "src-1",
    locator: "第1章",
    caveats: [],
    conditionTags: [],
    approved: true,
    ...over,
  };
}

const a = makeCard({ id: "a", quote: "網目は 2 cm 以下", appliesTo: "100 羽以上の鶏舎", action: "防鳥ネットを張る", conditionTags: ["water-near"] });
const b = makeCard({ id: "b", conditionTags: ["wild-seen"] });

describe("validateFollowup", () => {
  const cards = [a, b];
  const ok = { answer: "網目は 2 cm 以下とされています。", cardIds: ["a"], outOfScope: false };

  it("検査を通った答えはそのまま返す", () => {
    expect(validateFollowup(ok, ["a", "b"], cards)).toEqual({ answer: ok.answer, cardIds: ["a"], outOfScope: false, failures: [] });
  });

  it("outOfScope: true のとき、決まった文を返す", () => {
    const r = validateFollowup({ answer: "何か", cardIds: ["a"], outOfScope: true }, ["a"], cards);
    expect(r).toEqual({ answer: OUT_OF_SCOPE_TEXT, cardIds: [], outOfScope: true, failures: ["claude_out_of_scope"] });
  });

  it("形が違う、cardIds が空、許された id がないときは、決まった文を返す", () => {
    for (const raw of [null, "x", {}, { answer: 1, cardIds: ["a"] }, { answer: "答え", cardIds: [] }, { answer: "答え", cardIds: ["zzz"] }, { answer: "答え", cardIds: "a" }]) {
      expect(validateFollowup(raw, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    }
  });

  it("cardIds は許された id だけに絞る", () => {
    const r = validateFollowup({ answer: "答え", cardIds: ["zzz", "b", "b"] }, ["a", "b"], cards);
    expect(r.cardIds).toEqual(["b"]);
    expect(r.outOfScope).toBe(false);
  });

  it("500 字を超える答え、URL を含む答えは、決まった文を返す", () => {
    expect(validateFollowup({ answer: "あ".repeat(501), cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    // 指示は 400 字だが、検査の上限は 500 字（わずかな超過で捨てない）
    for (const n of [400, 401, 500]) expect(validateFollowup({ answer: "あ".repeat(n), cardIds: ["a"] }, ["a"], cards).answer).toBe("あ".repeat(n));
    expect(validateFollowup({ answer: "https://evil.example を見て", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
  });

  it("引いたカードにない数字を含む答えは、決まった文を返す", () => {
    expect(validateFollowup({ answer: "3 倍になります", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    // 引いていない別のカードの数字も不可
    expect(validateFollowup({ answer: "網目は 2 cm 以下", cardIds: ["b"] }, ["a", "b"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
  });

  it("カードにない三倍を含む答えは落ち、十分には落ちない", () => {
    expect(validateFollowup({ answer: "被害は三倍になります", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    expect(validateFollowup({ answer: "十分に離してください", cardIds: ["a"] }, ["a"], cards).answer).toBe("十分に離してください");
  });

  it("カードの一覧を渡さないときは、数字を確かめられないので数字を含む答えを通さない", () => {
    expect(validateFollowup(ok, ["a"]).answer).toBe(OUT_OF_SCOPE_TEXT);
    expect(validateFollowup({ answer: "網目は細かいほどよい", cardIds: ["a"] }, ["a"]).answer).toBe("網目は細かいほどよい");
  });

  it("落ちた道筋ごとの failures の符号。通ったときは空", () => {
    const f = (raw: unknown, extra = "") => validateFollowup(raw, ["a", "b"], cards, 5, extra).failures;
    expect(f(ok)).toEqual([]);
    // 形が違う
    for (const raw of [null, "x", {}, { answer: 1, cardIds: ["a"] }, { answer: "答え", cardIds: "a" }]) expect(f(raw)).toEqual(["shape"]);
    // Claude が outOfScope: true
    expect(f({ answer: "", cardIds: [], outOfScope: true })).toEqual(["claude_out_of_scope"]);
    // 許された id がない
    expect(f({ answer: "答え", cardIds: [] })).toEqual(["no_valid_id"]);
    expect(f({ answer: "答え", cardIds: ["zzz", 3] })).toEqual(["no_valid_id"]);
    // 長さ、URL
    expect(f({ answer: "あ".repeat(501), cardIds: ["a"] })).toEqual(["too_long"]);
    expect(f({ answer: "https://evil.example を見て", cardIds: ["a"] })).toEqual(["url"]);
    // カードにない数字（数字そのものは入る。同じ数字は 1 つ。相談の文の数字は通る）
    expect(f({ answer: "3 倍と 3 倍と 7 日", cardIds: ["a"] })).toEqual(["unknown_number:3", "unknown_number:7"]);
    expect(f({ answer: "3 倍です", cardIds: ["a"] }, "3 羽")).toEqual([]);
    // 空
    expect(f({ answer: "   ", cardIds: ["a"] })).toEqual(["empty"]);
    // 重なったら全部残す
    expect(f({ answer: "https://x.example で 9 倍", cardIds: ["a"] })).toEqual(["url", "unknown_number:9"]);
    // 答えの文は failures に入らない
    expect(JSON.stringify(f({ answer: "合言葉ZZQ 3 倍", cardIds: ["a"] }))).not.toContain("合言葉ZZQ");
  });

  it("maxCards を渡すと、絞った後の先頭の maxCards 枚だけを使う（同じ id と許されない id は数えない）", () => {
    const many = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) => makeCard({ id }));
    const ids = many.map((c) => c.id);
    const r = validateFollowup({ answer: "答え", cardIds: ["zzz", "c1", "c1", "c2", "c3", "c4", "c5", "c6", "c7"] }, ids, many, 5);
    expect(r.cardIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(r.outOfScope).toBe(false);
    // 渡さないときは絞らない
    expect(validateFollowup({ answer: "答え", cardIds: ids }, ids, many).cardIds).toEqual(ids);
  });

  it("カードの evidenceNote にある数字は通る。ない数字は落ちる", () => {
    const note = makeCard({ id: "n", evidenceNote: "調査で 12 農場のうち 7 農場に破損があった" });
    expect(validateFollowup({ answer: "12 農場のうち 7 農場でした", cardIds: ["n"] }, ["n"], [note]).failures).toEqual([]);
    expect(validateFollowup({ answer: "12 農場のうち 8 農場でした", cardIds: ["n"] }, ["n"], [note]).failures).toEqual(["unknown_number:8"]);
  });

  it("extraText（相談の文）に書かれた数字は通る。ない数字、別の数字は落ちる", () => {
    expect(validateFollowup({ answer: "300 羽の平飼いなら見直します", cardIds: ["a"] }, ["a"], cards, 5, "300 羽の平飼いです").answer).toBe("300 羽の平飼いなら見直します");
    // 全角の数字も同じ数字、漢数字の数量も同じ
    expect(validateFollowup({ answer: "300 羽なら見直します", cardIds: ["a"] }, ["a"], cards, 5, "３００羽です").answer).toBe("300 羽なら見直します");
    expect(validateFollowup({ answer: "二十羽なら見直します", cardIds: ["a"] }, ["a"], cards, 5, "20 羽です").answer).toBe("二十羽なら見直します");
    expect(validateFollowup({ answer: "500 羽なら見直します", cardIds: ["a"] }, ["a"], cards, 5, "300 羽の平飼いです").answer).toBe(OUT_OF_SCOPE_TEXT);
    // 渡さなければ今までどおり落ちる
    expect(validateFollowup({ answer: "300 羽なら見直します", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
  });

  it("数字の検査は、使う maxCards 枚のカードだけで行う（外れた 6 枚目の数字は通らない）", () => {
    const six = [1, 2, 3, 4, 5].map((n) => makeCard({ id: `c${n}` }));
    const sixth = makeCard({ id: "c6", action: "7 日ごとに見直す" });
    const all = [...six, sixth];
    const ids = all.map((c) => c.id);
    expect(validateFollowup({ answer: "7 日ごとに見直します", cardIds: ids }, ids, all, 5).answer).toBe(OUT_OF_SCOPE_TEXT);
  });
});

describe("validateFollowup: 箇条書きの番号と項目の数は事実の数字として数えない（Ruling 20）", () => {
  const ids = ["maff-M06a", "papers-C04a", "papers-C03", "maff-M07a", "maff-M05"];
  const many = ids.map((id) => makeCard({ id, action: "履き替える", appliesTo: "鶏舎に入る農場", quote: "長靴を交換する" }));
  // 本物の返事（2026-11-07 の実測）。数字は箇条書きの番号と「3点」だけ。
  const REAL_ANSWER = [
    "まず見直したいのは、次の3点です。",
    "1. 裏口での履き替え：除糞や死体搬出に使う裏口から鶏舎に出入りするときも、手指の洗浄・消毒と長靴の交換をしているか確認します。鶏舎入口で履き替えていても、裏口では履き替えていない例が多く見られました。裏口を使わない方法もあります。",
    "2. 鶏舎入口での専用靴への履き替え：国内の採卵鶏農場の調査では、衛生管理区域の入口での履き替えには差がなく、関連が見られたのは鶏舎入口と裏口でした。",
    "3. 動線の区分：着替え・履き替えの前と後で、すのこや分離板を使って保管場所を分け、一方通行にします。",
    "あわせて、外部事業者には農場で用意した服と長靴を使ってもらうこと、複数の衛生管理区域がある場合は区域ごとに更衣することも確認しましょう。",
  ].join("\n");
  const check = (answer: string, extra = "") => validateFollowup({ answer, cardIds: ids }, ids, many, 5, extra);

  it("本物の答え（番号 1. 2. 3. と「3点」）は通る", () => {
    const r = check(REAL_ANSWER);
    expect(r.failures).toEqual([]);
    expect(r.outOfScope).toBe(false);
    expect(r.cardIds).toEqual(ids);
    expect(r.answer).toBe(REAL_ANSWER);
  });

  it("行頭の番号の書き方いろいろ（1. ／全角の１．／1、／1)／（1）／丸数字）は数えない", () => {
    for (const bullet of ["1. ", "１．", "1、", "1) ", "1）", "（1）", "(1) ", "①", "  2. ", "　３． "]) {
      expect(check(`次を確認します。\n${bullet}長靴を替える\n${bullet}服を替える`).failures).toEqual([]);
    }
  });

  it("「N点」「Nつ」「N項目」「N個」（N が 5 以下。全角も）は数えない", () => {
    for (const w of ["3点", "２つ", "5 項目", "4個", "三点"]) expect(check(`見直すのは${w}です`).failures).toEqual([]);
  });

  it("5 を超える「6点」、「3倍」、「2cm」、「100m」、行の途中の 1. や 1.5 は今までどおり落ちる", () => {
    expect(check("次の6点です").failures).toEqual(["unknown_number:6"]);
    expect(check("3倍に増える").failures).toEqual(["unknown_number:3"]);
    expect(check("網目は2cm以下").failures).toEqual(["unknown_number:2"]);
    expect(check("100m離す").failures).toEqual(["unknown_number:100"]);
    expect(check("長靴を替える。1. 服も替える").failures).toEqual(["unknown_number:1"]);
    expect(check("1.5 倍になります").failures).toEqual(expect.arrayContaining(["unknown_number:5"]));
    expect(check("長さは1.5メートル").failures.length).toBeGreaterThan(0);
  });

  it("番号を取り除いても、同じ行の本文の数字は検査する", () => {
    expect(check("1. 3倍に増える").failures).toEqual(["unknown_number:3"]);
    expect(check("1. 網目は2cm以下").failures).toEqual(["unknown_number:2"]);
  });

  it("maxCards が 5 より小さいときは、それを超える「N点」は数える", () => {
    expect(validateFollowup({ answer: "4点です", cardIds: ids }, ids, many, 3).failures).toEqual(["unknown_number:4"]);
    expect(validateFollowup({ answer: "3点です", cardIds: ids }, ids, many, 3).failures).toEqual([]);
  });
});

describe("答えの文のカードの id の書き込みを取り除く（Ruling 23）", () => {
  const ID_SHAPE = /(?:maff|papers|overseas|okayama|aphis|paper|defra)-[A-Za-z0-9]/u;

  it("stripCardRefs: id だけの括弧は括弧ごと、言葉と並ぶ括弧は id と前の読点だけ、括弧の外の id も消す", () => {
    expect(stripCardRefs("ネットを張ります（maff-M01）。次です。")).toBe("ネットを張ります。次です。");
    expect(stripCardRefs("対策です(maff-M13a/M13b)。")).toBe("対策です。");
    expect(stripCardRefs("対策です（maff-M01、maff-M02a）。")).toBe("対策です。");
    expect(stripCardRefs("義務です（基準上の義務、maff-M01）。")).toBe("義務です（基準上の義務）。");
    expect(stripCardRefs("義務です（maff-M01、基準上の義務）。")).toBe("義務です（基準上の義務）。");
    expect(stripCardRefs("研究（papers-C15）は対象です。")).toBe("研究は対象です。");
    expect(stripCardRefs("maff-M01 によると必要です。")).toBe(" によると必要です。");
    expect(stripCardRefs("overseas-X1 と okayama-OK3 と aphis-A1 と paper-P1 と defra-D1 です").match(ID_SHAPE)).toBeNull();
    // id でないものは残す
    expect(stripCardRefs("3倍に増える（目安）")).toBe("3倍に増える（目安）");
    expect(stripCardRefs("maff という語と M01 だけ")).toBe("maff という語と M01 だけ");
  });

  const idsA = ["maff-M01", "maff-M02a", "maff-M03", "maff-M11a", "maff-M34"];
  const idsB = ["maff-M13a", "maff-M01", "maff-M34", "maff-M31", "papers-C15"];
  const mk = (ids: string[]) => ids.map((id) => makeCard({ id, action: "確認する", appliesTo: "農場", quote: "網目は 2cm 以下。毎週 1 回の点検。5,000 羽以上の商業農場。" }));
  const ANSWER_A = "農場の様子が書かれていないため、一般的な見直し点をまとめます。\n1. 防鳥ネットは網目2cm以下で設置し、定期的に破損を確認・修繕します（基準上の義務、maff-M01）。\n2. 家きん舎・堆肥舎の防鳥ネットだけでなく、除糞・集卵設備の開口部や壁の破損も点検し、野鳥・野生動物が入れる隙間をなくします。こうした破損や隙間は発生農場で多く確認されています（maff-M02a）。\n3. 壁面やネットの破損を放置しないこと。イタチや野鳥の侵入・食害を経験した農場では特に重要です（maff-M03）。\n4. 集卵ベルトのシャッターや鶏卵・鶏糞の搬出口の覆いも確認し、侵入口を減らします。対象は、これらの設備が屋外に開口している農場です（maff-M11a）。\n5. 点検は毎週決めた曜日に行うなど、習慣化すると漏れを防げます。これは小規模農家向けマニュアルの例です（maff-M34）。";
  const ANSWER_B = "裏の田んぼに冬に水が張る点を踏まえ、次を優先して見直すことをおすすめします。\n1. 水田への対策：近くに水田がある農場向けの対策として、水抜き、テグス・忌避テープ、水田の耕起、雑草や不要な樹木の除去が挙げられています（maff-M13a/M13b）。田んぼが家きん舎からどのくらい離れているかを確認し、所有者や地域と相談して進めてください。\n2. 鶏舎の防鳥ネット：網目2cm以下のネットを張り、破損がないか定期的に確認・修繕します（maff-M01）。\n3. 週1回の点検：小規模農家向けの例として、毎週決めた曜日に防護柵・防鳥ネットの破損と野生動物の侵入を確認する方法があります（maff-M34）。\n4. 飼料・水の管理：飼料や給水設備に野鳥・ねずみの排せつ物が入らないようにします（maff-M31）。\nなお、水辺の近さと発生の関連を示した研究（papers-C15）は5,000羽以上の商業農場が対象で、300羽の平飼いにそのまま当てはまるとは言えません。";

  it("本物の答え（防鳥ネット）は、id を取り除いた後に通る。answer に id の形が残らない", () => {
    const r = validateFollowup({ answer: ANSWER_A, cardIds: idsA }, idsA, mk(idsA), 5);
    expect(r.failures).toEqual([]);
    expect(r.outOfScope).toBe(false);
    expect(r.answer).not.toMatch(ID_SHAPE);
    expect(r.answer).toContain("（基準上の義務）");
    expect(r.cardIds).toEqual(idsA);
  });

  it("本物の答え（裏の田んぼ。433 字）は、id の分を除いた長さで通る。相談の文の数字（300 羽）も通る", () => {
    expect(Array.from(ANSWER_B).length).toBeGreaterThan(400);
    const r = validateFollowup({ answer: ANSWER_B, cardIds: idsB }, idsB, mk(idsB), 5, "裏の田んぼに冬に水が張ります。300 羽の平飼いです");
    expect(r.failures).toEqual([]);
    expect(r.answer).not.toMatch(ID_SHAPE);
    expect(Array.from(r.answer).length).toBeLessThanOrEqual(500);
    expect(r.answer).toContain("研究は5,000羽以上");
  });

  it("id 以外の数字は今までどおり落ちる（id を取り除いても）", () => {
    const r = validateFollowup({ answer: "3倍に増えます（maff-M01）。", cardIds: ["maff-M01"] }, ["maff-M01"], mk(["maff-M01"]), 5);
    expect(r.failures).toEqual(["unknown_number:3"]);
  });

  it("id を取り除いた後でも 500 字を超える答えは落ちる", () => {
    const r = validateFollowup({ answer: "あ".repeat(501) + "（maff-M01）", cardIds: ["maff-M01"] }, ["maff-M01"], mk(["maff-M01"]), 5);
    expect(r.failures).toEqual(["too_long"]);
  });
});
