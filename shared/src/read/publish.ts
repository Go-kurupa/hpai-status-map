// 載せるかの判断（I-04、設計書 §9.5、§9.6）。照合と二重読みの結果から、自動で載せるか、確認中にするか、捨てるかを決める。
// 迷うときは載せずに確認中にする。reasons は `municipality:value_in_quote` のような語だけで、引用や値を入れない。
// 確認中は、その県の家きんの発生・疑いでないことがはっきりしたときだけ、人の確認に回さない（notPoultryHereReasons。迷うものは今までどおり人へ）。
import { hasHpaiWord, normalizeForMatch } from "../text";
import type { CompareReport, DocumentKind, PublishDecision, ReadResult, SecondReadResult, VerifyReport } from "./types";

const OUTBREAK_WORD = /疑似患畜|疑い事例|疑う事例|疑われる|簡易検査|遺伝子検査|発生を確認|発生しました|発生について|例目|発生農場/u;
const FARM_WORD = /家きん|農場|養鶏|鶏舎/u;

/**
 * 発生を示す語がある。鳥インフルの語と発生を示す語の両方があること。
 * 「野鳥」があって家きん、農場、養鶏、鶏舎がなければ false。題だけでなく 題 + "\n" + 本文 にも使う。
 */
export function hasOutbreakWords(text: string): boolean {
  const n = normalizeForMatch(text);
  if (!hasHpaiWord(n) || !OUTBREAK_WORD.test(n)) return false;
  return !(n.includes("野鳥") && !FARM_WORD.test(n));
}

// 新しい事例に数えない種類。両者が同じ種類と読めば捨てる（自動で載せる設定が入のとき）。
const NON_TARGET_KINDS: ReadonlySet<DocumentKind> = new Set(["drill", "notice", "irrelevant", "other_pref"]);

// ── 公開の確認中を自動で外す条件 ──

/**
 * 二人の読み手がともにこのどれかと読めば、その県の家きんの発生・疑いの文書ではない（家きんの事例の段階を持たない種類）。
 * 自動で外してよい組み合わせは、ここ 1 か所で決める。今は、二人の種類の名前が違っても（野鳥とお知らせなど）この中なら外す。
 * 否定（negated）は家きんの事例に付く種類なので入れない（否定と誤読された疑いを隠さない、§9.6）。
 */
export const NOT_POULTRY_KINDS: ReadonlySet<DocumentKind> = new Set(["wild_bird", "other_pref", "drill", "notice", "irrelevant"]);

// 家きんの事例の告知にしか出ない語。野鳥の知らせにも出る語（簡易検査、遺伝子検査、疑い事例、国内 N 例目）は入れない。
const POULTRY_CASE_WORD = /疑似患畜|患畜|殺処分|移動制限区域|搬出制限区域|発生農場/u;
// 家きんを飼う場の語と、発生の段階の語が両方あれば（文書のどこでも）、家きんの事例（疑いの段階を含む）の知らせとみなす。
// 迷ったら人へ回すので広めに取る（野鳥の知らせに「農場への注意喚起」が添えてあると人へ回る）。
// 「家きん」「家禽」だけは入れない（「県内の家きんでの発生はありません」のような否定の文にも出る）。
const POULTRY_SITE_WORD = /農場|鶏舎|養鶏|飼養施設|飼養鶏|採卵鶏|肉用鶏|種鶏|ブロイラー|あひる|アヒル|うずら|ウズラ|だちょう|ダチョウ/u;
const POULTRY_STAGE_WORD = /簡易検査|遺伝子検査|疑い事例|疑われる|陽性|防疫措置|発生しました|発生を確認|発生が確認/u;

function hasPoultryCaseWords(text: string): boolean {
  const n = normalizeForMatch(text);
  return POULTRY_CASE_WORD.test(n) || (POULTRY_SITE_WORD.test(n) && POULTRY_STAGE_WORD.test(n));
}

/**
 * 家きんの段階を読んでいないか。野鳥と読んだ読み手が「疑い」「確定」を返すのは、野鳥の簡易検査と確定検査の言い換えなので見ない。
 * それ以外の段階（殺処分、防疫措置の完了、区域の解除）は家きんの内容が混ざった印なので、野鳥と読んだ側でも外さない。
 */
const noPoultryStage = (kind: DocumentKind, stage: ReadResult["primaryStage"]): boolean =>
  stage === null || (kind === "wild_bird" && (stage === "suspected" || stage === "confirmed"));

/**
 * その県の家きんの発生・疑いの文書ではないと、はっきり言えるか。言えれば人の確認から外す理由の語を、迷うなら null を返す。
 * 外し方（捨てるか、公開を非公開に下げるか）は decidePublication が自動で載せる設定で決める。
 * 次をすべて満たすときだけ言える（どれか 1 つでも欠けたら、今までどおり人の確認に回す）。
 * - 主と別の読み手の両方が読めた。文字層がある。本文を読めて空でない（題だけで語を見ない）。
 * - 二人とも NOT_POULTRY_KINDS のどれかと読んだ（どちらも家きんの事例の種類や否定と読んでいない）。
 * - 家きんの段階を読んでいない（野鳥と読んだ側の「疑い」「確定」だけは見ない）。
 * - 題と本文に、家きんの事例にしか出ない語（疑似患畜、殺処分、区域、発生農場、農場＋簡易検査 など）がない。
 * 理由は `not_poultry_here`、`both_read:<主の種類>`（違えば `<主>+<別>`）、発生を示す語があれば `outbreak_words_present`。引用や値は入れない。
 */
export function notPoultryHereReasons(input: {
  read: ReadResult | null;
  second: SecondReadResult | null;
  hasTextLayer: boolean;
  /** 本文（raw/{id}.txt）を読めて、空でない。読めないと語の判定が題だけになるので外さない。 */
  bodyAvailable: boolean;
  docText: string;
}): string[] | null {
  const { read, second } = input;
  if (read === null || second === null || !input.hasTextLayer || !input.bodyAvailable) return null;
  if (!NOT_POULTRY_KINDS.has(read.kind) || !NOT_POULTRY_KINDS.has(second.kind)) return null;
  if (!noPoultryStage(read.kind, read.primaryStage) || !noPoultryStage(second.kind, second.primaryStage)) return null;
  if (hasPoultryCaseWords(input.docText)) return null;
  const kinds = read.kind === second.kind ? read.kind : `${read.kind}+${second.kind}`;
  return ["not_poultry_here", `both_read:${kinds}`, ...(hasOutbreakWords(input.docText) ? ["outbreak_words_present"] : [])];
}

export interface PublicationInput {
  read: ReadResult | null;
  /** 別の読み手の結果。読めなかった（失敗、予算で読まない）ときは null。 */
  second: SecondReadResult | null;
  verify: VerifyReport | null;
  compare: CompareReport | null;
  hasTextLayer: boolean;
  /** 本文を読めて空でない（notPoultryHereReasons だけが使う）。 */
  bodyAvailable: boolean;
  docText: string; // 題 + "\n" + 本文
  autoPublishEnabled: boolean;
}

/**
 * 載せるか、確認中（公開、非公開）にするか、捨てるかを決める。
 * 確認中になる文書でも、その県の家きんの発生・疑いでないことがはっきりすれば（notPoultryHereReasons）、人の確認に回さない。
 * - 自動で載せる設定が入: 捨てる（公開の「確認中」も運営者の箱も作らない）。理由は文書に残す（両者が同じ対象外の種類と読んだときと同じ扱い）。
 * - 切（試験の前。全件を人が確かめる）: 公開の確認中だけを非公開の確認中に下げ、理由を足す（箱には残す）。
 * 載せる向き（publish）は変えない。
 */
export function decidePublication(input: PublicationInput): PublishDecision {
  const d = decideBeforeDismiss(input);
  if (d.action !== "review_public" && d.action !== "review_private") return d;
  const dismiss = notPoultryHereReasons(input);
  if (dismiss === null) return d;
  const reasons = [...new Set([...d.reasons, ...dismiss])];
  if (input.autoPublishEnabled) return { action: "discard", reasons };
  return d.action === "review_public" ? { action: "review_private", reasons } : d;
}

function decideBeforeDismiss(input: PublicationInput): PublishDecision {
  const { read, verify, compare } = input;
  const outbreak = hasOutbreakWords(input.docText);
  const review = (reasons: string[]): PublishDecision => ({
    action: outbreak ? "review_public" : "review_private",
    reasons,
  });

  // 1 読めなかった（拒否、形式エラー、打ち切り、API の失敗）
  if (read === null) return review(["read_failed"]);

  // 2 文字層がない: 一致しても載せない。原文リンクを添えて運営者の確認に回す
  if (!input.hasTextLayer) return review([compare?.match ? "no_text_layer_match" : "no_text_layer_mismatch"]);

  // 3 対象外の種類を両者が同じに読んだ
  if (NON_TARGET_KINDS.has(read.kind) && compare?.match) {
    // 破棄の理由（両者が同じに読んだ kind）を残す。発生を示す語があるものは印を付け、運営者が後で探せるようにする
    return input.autoPublishEnabled
      ? { action: "discard", reasons: [`both_read:${read.kind}`, ...(outbreak ? ["outbreak_words_present"] : [])] }
      : { action: "review_private", reasons: ["auto_publish_off"] };
  }

  // 4 自動で載せる
  const multiple = read.multipleCases && read.kind !== "wild_bird"; // 野鳥は 1 文書に何羽もあるのが普通
  if (verify?.pass && compare?.match && input.autoPublishEnabled && !multiple) {
    return { action: "publish", negationCandidate: read.kind === "negated" };
  }

  // 5 残り: 理由を集める。野鳥と否定は公開しない
  const reasons: string[] = [];
  if (!verify) reasons.push("verify_missing");
  else if (!verify.pass) {
    const mandatory = verify.issues.filter((i) => i.mandatory).map((i) => `${i.field}:${i.check}`);
    reasons.push(...(mandatory.length > 0 ? mandatory : ["verify_failed"]));
  }
  if (!compare) reasons.push("compare_missing");
  else if (!compare.match) {
    reasons.push(...(compare.mismatches.length > 0 ? compare.mismatches.map((f) => `compare:${f}`) : ["compare_failed"]));
  }
  if (multiple) reasons.push("multiple_cases");
  if (!input.autoPublishEnabled) reasons.push("auto_publish_off");

  const unique = [...new Set(reasons)];
  // 否定と野鳥は、原則として公開しない。ただし家きんの発生を隠さないよう（§9.6）、次の場合は公開の確認中にする。
  // - 否定: 二重読みが食い違うか無いとき、文書に鳥インフルの語があれば（疑いを否定と誤読して隠さない）
  // - 野鳥: 二重読みが無いか種類が食い違い（一方が発生）、発生を示す語と農場の語が文書にあれば
  // （どちらも、二人とも家きんでない種類と読んだときは、decidePublication が捨てるか非公開に下げる）
  if (read.kind === "negated") {
    const unconfirmed = compare === null || !compare.match;
    return unconfirmed && hasHpaiWord(input.docText) ? { action: "review_public", reasons: unique } : { action: "review_private", reasons: unique };
  }
  if (read.kind === "wild_bird") {
    const kindDisputed = compare === null || compare.mismatches.includes("kind");
    return kindDisputed && outbreak ? { action: "review_public", reasons: unique } : { action: "review_private", reasons: unique };
  }
  return review(unique);
}
