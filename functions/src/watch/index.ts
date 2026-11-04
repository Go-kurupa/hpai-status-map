// watch の領域。1 時間ごとの見回り watchTick（I-01）と、6 時間ごとの国との突き合わせ reconcileNational（I-18）。県の入口の確認（page.ts、rss.ts）と結果の記録（record.ts）は I-02、環境省は I-12（moe.ts）。
import { onSchedule } from "firebase-functions/v2/scheduler";
import { loadGeoStore } from "../geo/loadGeo";
import { sendMail } from "../notify/send";
import { APP_URL, GMAIL_APP_PASSWORD, OPERATOR_EMAIL } from "../secrets";
import { runLiveWatch } from "./live";
import { politeFetch } from "./politeFetch";
import { reconcileAndNotify } from "./reconcile";

/** 入口を 3 つの group に分け、毎時 1 つの group を回る（3 時間で 1 周）。 */
export const watchTick = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Asia/Tokyo", timeoutSeconds: 1800, memory: "512MiB" },
  async () => {
    await runLiveWatch();
  },
);

/** 6 時間ごとに、国の報道発表の一覧と事例を突き合わせ、運営者の確認が増えていればメールで知らせる（I-18）。 */
export const reconcileNational = onSchedule(
  { schedule: "0 */6 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540, memory: "512MiB", secrets: [GMAIL_APP_PASSWORD] },
  async () => {
    const geo = await loadGeoStore();
    const now = () => new Date();
    await reconcileAndNotify({ fetch: politeFetch, now, geo }, { send: sendMail, to: OPERATOR_EMAIL.value(), appUrl: APP_URL.value(), now });
  },
);
