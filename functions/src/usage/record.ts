// Claude を呼んだ費用を usage/{YYYY-MM} に積む（契約 2.7）。FieldValue.increment なので、同時に呼んでも失わない。
import { FieldValue } from "firebase-admin/firestore";
import { estimateUsd } from "@hpai/shared/budget";
import type { TokenUsage } from "@hpai/shared/budget";
import type { RuntimeSettings } from "@hpai/shared/types";
import { db } from "../admin";
import { usageMonthKey } from "./settings";

/** 1 回の呼び出しの使用量を今月に足す。拒否や途中で切れた呼び出しも課金されるので、呼び出し側は失敗でも usage があれば呼ぶ。 */
export async function recordUsage(
  model: string,
  u: TokenUsage,
  now: Date,
  s: Pick<RuntimeSettings, "jpyPerUsd">,
  o?: { batch?: boolean },
): Promise<{ usd: number; jpy: number }> {
  const usd = estimateUsd(model, u, o);
  const jpy = usd * s.jpyPerUsd;
  await db.doc(`usage/${usageMonthKey(now)}`).set(
    {
      inputTokens: FieldValue.increment(u.input_tokens),
      outputTokens: FieldValue.increment(u.output_tokens),
      cacheReadTokens: FieldValue.increment(u.cache_read_input_tokens ?? 0),
      cacheWriteTokens: FieldValue.increment(u.cache_creation_input_tokens ?? 0),
      estimatedJpy: FieldValue.increment(jpy),
    },
    { merge: true },
  );
  return { usd, jpy };
}
