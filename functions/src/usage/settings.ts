// usage/settings と usage/{YYYY-MM} を読む（契約 2.2、2.7）。
import { yearMonthOf, jstDateOf } from "@hpai/shared/dates";
import type { UsageMonth } from "@hpai/shared/budget";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import type { RuntimeSettings } from "@hpai/shared/types";
import { db } from "../admin";

const EFFORTS: ReadonlySet<unknown> = new Set(["low", "medium", "high", "xhigh", "max"]);

/** usage/{YYYY-MM} の文書の id。月の境は日本時間。 */
export function usageMonthKey(now: Date): string {
  const { year, month } = yearMonthOf(jstDateOf(now));
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 実行時の設定。文書がなければ既定値。既知のキーで型が合うものだけ既定値に重ねる。 */
export async function readRuntimeSettings(): Promise<RuntimeSettings> {
  const snap = await db.doc("usage/settings").get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const out: RuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  const num = (k: "softLimitJpy" | "hardLimitJpy" | "jpyPerUsd") => {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  };
  num("softLimitJpy");
  num("hardLimitJpy");
  num("jpyPerUsd");
  if (typeof data.autoPublishEnabled === "boolean") out.autoPublishEnabled = data.autoPublishEnabled;
  for (const k of ["primaryModel", "secondModel"] as const) {
    const v = data[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  if (EFFORTS.has(data.primaryEffort)) out.primaryEffort = data.primaryEffort as RuntimeSettings["primaryEffort"];
  return out;
}

/** 今月の使用量。文書がなければ全部 0。 */
export async function readUsageMonth(now: Date): Promise<UsageMonth> {
  const snap = await db.doc(`usage/${usageMonthKey(now)}`).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const n = (k: keyof UsageMonth) => (typeof data[k] === "number" ? (data[k] as number) : 0);
  return {
    inputTokens: n("inputTokens"),
    outputTokens: n("outputTokens"),
    cacheReadTokens: n("cacheReadTokens"),
    cacheWriteTokens: n("cacheWriteTokens"),
    estimatedJpy: n("estimatedJpy"),
  };
}
