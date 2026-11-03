// watch の領域。1 時間ごとの見回り watchTick（I-01）。県の入口の確認（page.ts、rss.ts）と結果の記録（record.ts）は I-02。
import { onSchedule } from "firebase-functions/v2/scheduler";
import { loadGeoStore } from "../geo/loadGeo";
import { maffHandlers } from "./maff";
import { pageHandlers } from "./page";
import { politeFetch } from "./politeFetch";
import { rssHandlers } from "./rss";
import { runWatch } from "./run";
import { firestoreIo } from "./tick";

/** 入口を 3 つの group に分け、毎時 1 つの group を回る（3 時間で 1 周）。 */
export const watchTick = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Asia/Tokyo", timeoutSeconds: 1800, memory: "512MiB" },
  async () => {
    const geo = await loadGeoStore();
    await runWatch({ fetch: politeFetch, now: () => new Date(), geo }, firestoreIo(), { ...maffHandlers, ...pageHandlers, ...rssHandlers });
  },
);
