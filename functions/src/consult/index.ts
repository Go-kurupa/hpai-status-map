// consult の領域。対策の見直し相談（カードの根拠を示しながら、見直す順と続けての質問に答える）。
import Anthropic from "@anthropic-ai/sdk";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { ANTHROPIC_API_KEY } from "../secrets";
import { recordUsage } from "../usage/record";
import { readRuntimeSettings, readUsageMonth } from "../usage/settings";
import { loadConsultData, type ConsultData } from "./data";
import {
  CONSULT_DAILY_LIMIT,
  CONSULT_JUDGE_DAILY_LIMIT,
  handleConsultFollowup,
  handleConsultPlan,
  type ConsultCaller,
  type ConsultDeps,
} from "./handler";
import { reserveConsultCall, reserveJudgeCall } from "./limit";

// 同梱の資料はインスタンスの中で変わらないので、一度読めたら使い回す。読めなかったときは覚えず、次の呼び出しでやり直す。
let dataPromise: Promise<ConsultData> | null = null;
function cachedData(): Promise<ConsultData> {
  dataPromise ??= loadConsultData().catch((e: unknown) => {
    dataPromise = null;
    throw e;
  });
  return dataPromise;
}

const deps: ConsultDeps = {
  // 1 回の呼び出しが 120 秒に収まるよう、Claude への 1 回は 90 秒、再試行なし（切れても画面が空にならない形を返せるように）
  client: () => new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 90_000, maxRetries: 0 }),
  now: () => new Date(),
  settings: readRuntimeSettings,
  month: readUsageMonth,
  record: recordUsage,
  reserve: (uid, now) => reserveConsultCall(uid, now, CONSULT_DAILY_LIMIT),
  reserveJudge: (now) => reserveJudgeCall(now, CONSULT_JUDGE_DAILY_LIMIT),
  data: cachedData,
};

const callerOf = (auth: CallableRequest["auth"]): ConsultCaller | null => (auth ? { uid: auth.uid, member: auth.token.member === true } : null);

const OPTIONS = { timeoutSeconds: 120, memory: "256MiB" as const, maxInstances: 3, secrets: [ANTHROPIC_API_KEY] };

/**
 * `{profile, judge?}` → `{rows, source, notice}`。会員だけ。judge: true は、ログインなしで架空の農場の答えを使う。
 * 会員 1 人は 1 日 10 回まで（followup と合計）、審査員の入口は全体で 1 日 30 回まで。月の費用は soft の上限で止める。
 */
export const consultPlan = onCall(OPTIONS, (request) => handleConsultPlan(deps, callerOf(request.auth), request.data));

/** `{question, cardId, profile, judge?}` → `{answer, cards, outOfScope, notice}`。 */
export const consultFollowup = onCall(OPTIONS, (request) => handleConsultFollowup(deps, callerOf(request.auth), request.data));
