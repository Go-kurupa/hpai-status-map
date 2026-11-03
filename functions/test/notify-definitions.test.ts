// M-13: 関数の定義（予定、時間、メモリ、使う鍵の宣言）。実行はしない。
import { describe, expect, it } from "vitest";
import { morningDigest, onDeathWritten, onWildBirdWritten, resumeMail, retryFailedNotices, unsubscribe } from "../src/notify";

type Endpoint = {
  timeoutSeconds?: number;
  availableMemoryMb?: number;
  secretEnvironmentVariables?: Array<{ key: string }>;
  scheduleTrigger?: { schedule?: string; timeZone?: string };
  eventTrigger?: { retry?: boolean };
  httpsTrigger?: { invoker?: string[] };
  callableTrigger?: unknown;
};
const ep = (fn: unknown): Endpoint => (fn as { __endpoint: Endpoint }).__endpoint;
const declared = (fn: unknown): string[] => (ep(fn).secretEnvironmentVariables ?? []).map((s) => s.key).sort();

describe("notify の関数の定義（契約 4.1）", () => {
  it("morningDigest: 毎朝 6 時（JST）、540s / 512MiB", () => {
    expect(ep(morningDigest).scheduleTrigger).toMatchObject({ schedule: "0 6 * * *", timeZone: "Asia/Tokyo" });
    expect(ep(morningDigest).timeoutSeconds).toBe(540);
    expect(ep(morningDigest).availableMemoryMb).toBe(512);
    expect(declared(morningDigest)).toEqual(["GMAIL_APP_PASSWORD", "UNSUBSCRIBE_SECRET"]);
  });

  it("retryFailedNotices: 朝のまとめと重ねないよう 6 時を外す（30 0-5,7-23 * * *）、540s / 512MiB", () => {
    expect(ep(retryFailedNotices).scheduleTrigger).toMatchObject({ schedule: "30 0-5,7-23 * * *", timeZone: "Asia/Tokyo" });
    expect(ep(retryFailedNotices).timeoutSeconds).toBe(540);
    expect(ep(retryFailedNotices).availableMemoryMb).toBe(512);
    expect(declared(retryFailedNotices)).toEqual(["GMAIL_APP_PASSWORD", "UNSUBSCRIBE_SECRET"]);
  });

  it("onDeathWritten: 120s / 256MiB、再試行しない、2 つの鍵を宣言", () => {
    expect(ep(onDeathWritten).timeoutSeconds).toBe(120);
    expect(ep(onDeathWritten).availableMemoryMb).toBe(256);
    expect(ep(onDeathWritten).eventTrigger?.retry).toBeFalsy();
    expect(declared(onDeathWritten)).toEqual(["GMAIL_APP_PASSWORD", "UNSUBSCRIBE_SECRET"]);
  });

  it("onWildBirdWritten: 120s / 512MiB、再試行しない、鍵の宣言なし（queued を作るだけ）", () => {
    expect(ep(onWildBirdWritten).timeoutSeconds).toBe(120);
    expect(ep(onWildBirdWritten).availableMemoryMb).toBe(512);
    expect(ep(onWildBirdWritten).eventTrigger?.retry).toBeFalsy();
    expect(declared(onWildBirdWritten)).toEqual([]);
  });

  it("unsubscribe: 公開（invoker public）、60s / 256MiB、署名の鍵だけ", () => {
    expect(ep(unsubscribe).httpsTrigger?.invoker).toEqual(["public"]);
    expect(ep(unsubscribe).timeoutSeconds).toBe(60);
    expect(ep(unsubscribe).availableMemoryMb).toBe(256);
    expect(declared(unsubscribe)).toEqual(["UNSUBSCRIBE_SECRET"]);
  });

  it("resumeMail: onCall、鍵の宣言なし", () => {
    expect(ep(resumeMail).callableTrigger).toBeDefined();
    expect(declared(resumeMail)).toEqual([]);
  });
});
