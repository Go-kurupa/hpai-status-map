// 声かけ文の下書きを Claude に頼む（M-18、契約 2.6）。`client.messages.create` と `decodeMessage` だけを使う。
// SDK の messages.parse は refusal、max_tokens で throw するので使わない。
// サンプリング引数、thinking、tool_choice、道具、citations は送らない。鍵は client を作る側が読む。
// Claude に渡すのは公開の事実（県、市町村、日付、段階）だけ。農場の名前、位置、記録は渡さない。
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DraftFacts } from "@hpai/shared/drafts";
import { PREFS } from "@hpai/shared/pref";
import type { PrefCode } from "@hpai/shared/types";
import { decodeMessage, type ReadAttempt } from "../read/claude";

export const DRAFT_MODEL = "claude-sonnet-5-5";
// 声かけ文は 3 文、説明文の農場の部分も短い。長く出しても捨てるだけなので、払う量を絞る
export const DRAFT_MAX_TOKENS = 1500;

export const DRAFT_SYSTEM =
  "あなたは養鶏場の経営者が働く人へ送る短い声かけ文を下書きします。渡された事実だけを使います。伝えることは「発生地の近くに行かない」「出勤の前後に消毒と着替え」の 2 つです。3 文以内で、やさしい言葉で書きます。市町村名と日付（M月D日）を入れます。疑いの段階なら「疑い」と書きます。数字を足しません。人の健康について書きません。不安をあおる語を使いません。";

const DraftSchema = z.object({ message: z.string() });
const DRAFT_FORMAT = zodOutputFormat(DraftSchema);

/** user の中身。県、市町村、日付、段階の JSON だけ。 */
export function buildDraftUser(prefCode: PrefCode, f: DraftFacts): string {
  const prefecture = PREFS.find((p) => p.code === prefCode)?.name ?? "";
  return JSON.stringify({ prefecture, municipality: f.muniName, date: f.date, stage: f.stage });
}

/** API の失敗の detail。状態の番号か例外の名前だけ（本文や応答の文を入れない）。 */
function apiErrorDetail(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `status=${status}`;
  return e instanceof Error ? e.name : "unknown";
}

/** 下書きを頼む。throw しない。拒否や途中で切れた呼び出しも課金されるので、usage があれば呼び手が積む。 */
export async function callDraft(client: Anthropic, system: string, user: string): Promise<ReadAttempt<{ message: string }>> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: DRAFT_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: DRAFT_FORMAT.schema }, effort: "medium" },
    });
  } catch (e) {
    return { ok: false, reason: "api_error", detail: apiErrorDetail(e) };
  }
  return decodeMessage(message, DraftSchema);
}
