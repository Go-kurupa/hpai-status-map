// notify の領域。事例の書き込みで知らせる onCaseWritten（M-02）と、M-13 の朝のまとめ、送り直し、野鳥、死亡率の基準、配信停止と再開。
import { onSchedule } from "firebase-functions/v2/scheduler";
import { loadGeoStore } from "../geo/loadGeo";
import { GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET } from "../secrets";
import { runMorningDigest } from "./digest";
import { liveDeps } from "./liveDeps";
import { runRetryFailed } from "./retryFailed";

export { onCaseWritten } from "./onCaseWritten";
export { onDeathWritten } from "./onDeathWritten";
export { onWildBirdWritten } from "./onWildBirdWritten";
export { resumeMail } from "./resumeMail";
export { unsubscribe } from "./unsubscribe";

/** 毎朝 6 時（JST）。自己点検の期限の知らせと、②③の朝の知らせを会員ごとに 1 通で送る。 */
export const morningDigest = onSchedule(
  { schedule: "0 6 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540, memory: "512MiB", secrets: [GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET] },
  async () => {
    await runMorningDigest(liveDeps(), await loadGeoStore());
  },
);

/**
 * 送れなかった知らせを送り直す。6 時台は朝のまとめと同じ知らせを 2 度送らないよう外す（30 分に始め、540 秒で 6 時の前に終わる）。
 * 認証や上限で止まったら、次の 1 時間まで送らない。
 */
export const retryFailedNotices = onSchedule(
  { schedule: "30 0-5,7-23 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540, memory: "512MiB", secrets: [GMAIL_APP_PASSWORD, UNSUBSCRIBE_SECRET] },
  async () => {
    await runRetryFailed(liveDeps(), await loadGeoStore());
  },
);
