// 載せるかの判断（I-04、設計書 §9.5、§9.6）。照合と二重読みの結果から、自動で載せるか、確認中にするか、捨てるかを決める。
// 迷うときは載せずに確認中にする。reasons は `municipality:value_in_quote` のような語だけで、引用や値を入れない。
import { hasHpaiWord, normalizeForMatch } from "../text";
import type { CompareReport, DocumentKind, PublishDecision, ReadResult, VerifyReport } from "./types";

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

export function decidePublication(input: {
  read: ReadResult | null;
  verify: VerifyReport | null;
  compare: CompareReport | null;
  hasTextLayer: boolean;
  docText: string; // 題 + "\n" + 本文
  autoPublishEnabled: boolean;
}): PublishDecision {
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
    return input.autoPublishEnabled ? { action: "discard" } : { action: "review_private", reasons: ["auto_publish_off"] };
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
  if (read.kind === "wild_bird") return { action: "review_private", reasons: unique };
  if (read.kind === "negated") {
    // 否定は公開しない。ただし二重読みが食い違うときは、疑いを否定と誤読して隠さないよう、鳥インフルの語があれば公開の確認中にする（§9.6）
    const disputed = compare !== null && !compare.match && hasHpaiWord(input.docText);
    return disputed ? { action: "review_public", reasons: unique } : { action: "review_private", reasons: unique };
  }
  return review(unique);
}
