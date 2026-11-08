// consult の領域。対策の相談（話題か文で聞くと、確認済みのカードの根拠を示しながらおすすめを返す）。
import Anthropic from "@anthropic-ai/sdk";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { ANTHROPIC_API_KEY } from "../secrets";
import { loadGeoStore } from "../geo/loadGeo";
import { recordUsage } from "../usage/record";
import { readRuntimeSettings, readUsageMonth } from "../usage/settings";
import { loadConsultData, type ConsultData } from "./data";
import { CONSULT_DAILY_LIMIT, CONSULT_JUDGE_DAILY_LIMIT, handleConsultAsk, type ConsultCaller, type ConsultDeps } from "./handler";
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
  // 同梱の地理の索引（lib/data/geo/muni-index.json）。条件の市町村コードから町の名前を引く。読めなければ次の呼び出しでやり直す（loadGeoStore が覚えない）
  muniIndex: async () => (await loadGeoStore()).index,
};

const callerOf = (auth: CallableRequest["auth"]): ConsultCaller | null => (auth ? { uid: auth.uid, member: auth.token.member === true } : null);

const OPTIONS = { timeoutSeconds: 120, memory: "256MiB" as const, maxInstances: 3, secrets: [ANTHROPIC_API_KEY] };

/**
 * `{question | topicId, history?, farm?}` → `{answer, cards, outOfScope, notice, followUps, stats, farm?}`。会員だけ（ログインなしの入口はない）。
 * farm は本人が選んだときだけ付く飼育目的・飼い方・市町村コード・近くの発生の状況・鶏舎ごとの羽数（handler.ts が形を検査し、町の名前を索引から引く）。
 * 会員 1 人は 1 日 10 回まで、審査員の会員（JUDGE_UID。審査員は全員この会員）は全体で 1 日 60 回まで。月の費用は soft の上限で止める。
 */
export const consultAsk = onCall(OPTIONS, (request) => handleConsultAsk(deps, callerOf(request.auth), request.data));
