// 声かけ文の下書きを、事例が疑いか確定になったときに一度だけ作る（M-18、設計書 §7）。
// Claude に渡すのは公開の事実（県、市町村、日付、段階）だけ。農場は読まない。
// 検査に落ちたとき、Claude が使えないとき、予算が止まっているときは、雛形で残す（下書きが無いより、確かめた雛形がある方がよい）。
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "firebase-functions";
import { isDraftBudgetStopped } from "@hpai/shared/budget";
import { toJstIso } from "@hpai/shared/dates";
import { checkWorkerMessage, dateNumbers, draftFactsOf, workerMessageTemplate, type DraftFacts } from "@hpai/shared/drafts";
import { normalizeForMatch } from "@hpai/shared/text";
import type { Case, CaseDraft } from "@hpai/shared/types";
import { db } from "../admin";
import type { ReadAttempt } from "../read/claude";
import { recordUsage } from "../usage/record";
import { readRuntimeSettings, readUsageMonth } from "../usage/settings";
import { DRAFT_MODEL, DRAFT_SYSTEM, buildDraftUser, callDraft } from "./claude";
import { lengthAndUrlFailures } from "./outputGuards";

/** 声かけ文の長さの上限（文字の数）。システムの指示は 3 文以内。超えたら雛形に戻す。 */
export const WORKER_MAX_OUTPUT = 500;

export interface DraftDecision {
  message: string;
  source: CaseDraft["source"];
  /** 雛形に戻した理由（検査の不合格の符号、Claude の失敗の種類）。文そのものは入れない。 */
  failures?: string[];
}

/** Claude の返事を採るか、雛形に戻すか。attempt が null は「Claude を呼ばなかった」。 */
export function decideDraft(facts: DraftFacts, attempt: ReadAttempt<{ message: string }> | null): DraftDecision {
  const template = (failures: string[]): DraftDecision => ({ message: workerMessageTemplate(facts), source: "template", failures });
  if (attempt === null) return template([]);
  if (!attempt.ok) return template([`claude:${attempt.reason}`]);
  const message = attempt.value.message.trim();
  // 長さの上限と URL の拒否は、近隣への説明文と同じ検査（outputGuards）。声かけ文は 3 文以内なので上限は短い。
  const guard = lengthAndUrlFailures(message, WORKER_MAX_OUTPUT);
  if (guard.length > 0) return template(guard);
  const check = checkWorkerMessage(message, { muniName: facts.muniName, date: facts.date, allowedNumbers: dateNumbers(facts.date) });
  if (!check.ok) return template(check.failures);
  // 疑いの段階の文は「疑い」と書く（確定と読まれないように）
  if (facts.stage === "suspected" && !normalizeForMatch(message).includes("疑い")) return template(["missing_suspected_word"]);
  return { message, source: "claude" };
}

export interface DraftDeps {
  client: Anthropic;
  now(): Date;
}

export type DraftOutcome = "skipped" | "created" | "exists";

const isAlreadyExists = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
};

/** 事例が書かれたときの処理。after は書かれた後の事例（削除なら null）。下書きは事例ごとに一度だけ作り、作り直さない。 */
export async function draftForCase(caseId: string, after: Case | null | undefined, deps: DraftDeps): Promise<DraftOutcome> {
  if (!after) return "skipped";
  const facts = draftFactsOf(after);
  if (facts === null) return "skipped";

  const ref = db.doc(`caseDrafts/${caseId}`);
  if ((await ref.get()).exists) return "skipped"; // 疑いで作ったら、確定になっても作り直さない

  const now = deps.now();
  const settings = await readRuntimeSettings();
  // soft の上限で Claude を止め、雛形にする。読み取り（発生の文書）の予算を残すため、hard までは使わない
  const stopped = isDraftBudgetStopped(await readUsageMonth(now), settings);

  let attempt: ReadAttempt<{ message: string }> | null = null;
  if (!stopped) {
    attempt = await callDraft(deps.client, DRAFT_SYSTEM, buildDraftUser(after.prefCode, facts));
    // 作る前に費用を積む（拒否や途中で切れた呼び出しも課金される。作るのが既にあって捨てても払っている）
    if (attempt.usage !== undefined) {
      try {
        await recordUsage(DRAFT_MODEL, attempt.usage, now, settings);
      } catch (e) {
        logger.error("下書きの使用量を積めませんでした", { message: e instanceof Error ? e.message : "unknown" });
      }
    }
  }

  const decision = decideDraft(facts, attempt);
  if (decision.failures && decision.failures.length > 0) {
    logger.info("声かけ文を雛形にしました", { caseId, failures: decision.failures });
  }

  const draft: CaseDraft = { caseId, workerMessage: decision.message, source: decision.source, createdAt: toJstIso(now) };
  try {
    await ref.create(draft); // 既にあれば（同時の起動）捨てる
  } catch (e) {
    if (isAlreadyExists(e)) return "exists";
    throw e;
  }
  return "created";
}
