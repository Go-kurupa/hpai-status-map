// M-02: 配信停止の署名、停止のエラーの見分け、配信停止の URL。鍵は試験用の作り物。
import { describe, expect, it } from "vitest";
import { isMailStopError, unsubscribeUrlFor, type NotifyDeps } from "../src/notify/dispatch";
import { signUnsubscribe, verifyUnsubscribe } from "../src/notify/unsubscribeSig";

const SECRET = "test-secret-not-real";

describe("signUnsubscribe / verifyUnsubscribe", () => {
  it("同じ組・同じ鍵で署名が通り、base64url（+ / = を含まない）で同じ値になる", () => {
    const sig = signUnsubscribe("f1", "u1", SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signUnsubscribe("f1", "u1", SECRET)).toBe(sig);
    expect(verifyUnsubscribe("f1", "u1", sig, SECRET)).toBe(true);
  });
  it("組が違えば通らない（farmId、uid のどちらが違っても）", () => {
    const sig = signUnsubscribe("f1", "u1", SECRET);
    expect(verifyUnsubscribe("f2", "u1", sig, SECRET)).toBe(false);
    expect(verifyUnsubscribe("f1", "u2", sig, SECRET)).toBe(false);
  });
  it("つなぎ目をずらした組は別の署名になる（区切りの曖昧さがない）", () => {
    expect(signUnsubscribe("a_b", "c", SECRET)).not.toBe(signUnsubscribe("a", "b_c", SECRET));
    expect(signUnsubscribe("a__b", "c", SECRET)).not.toBe(signUnsubscribe("a", "b__c", SECRET));
    expect(signUnsubscribe("ab", "", SECRET)).not.toBe(signUnsubscribe("a", "b", SECRET));
  });
  it("鍵が違えば通らない", () => {
    const sig = signUnsubscribe("f1", "u1", SECRET);
    expect(verifyUnsubscribe("f1", "u1", sig, "other-secret")).toBe(false);
  });
  it("長さの違う署名や、空、壊れた入力でも例外にならず false", () => {
    const sig = signUnsubscribe("f1", "u1", SECRET);
    for (const bad of ["", "a", sig.slice(1), `${sig}x`, `${sig}==`, "%%%", sig.toUpperCase(), "あ".repeat(43)]) {
      expect(() => verifyUnsubscribe("f1", "u1", bad, SECRET)).not.toThrow();
      expect(verifyUnsubscribe("f1", "u1", bad, SECRET)).toBe(false);
    }
    expect(verifyUnsubscribe("f1", "u1", undefined as unknown as string, SECRET)).toBe(false);
    expect(verifyUnsubscribe("f1", "u1", sig, "")).toBe(false);
  });
  it("鍵が空では署名しない（設定漏れを黙って通さない）", () => {
    expect(() => signUnsubscribe("f1", "u1", "")).toThrow();
  });
});

describe("isMailStopError", () => {
  const err = (props: Record<string, unknown>) => Object.assign(new Error("x"), props);
  it("EAUTH と 535 は auth", () => {
    expect(isMailStopError(err({ code: "EAUTH" }))).toBe("auth");
    expect(isMailStopError(err({ responseCode: 535, code: "EAUTH" }))).toBe("auth");
    expect(isMailStopError(err({ responseCode: 535 }))).toBe("auth");
  });
  it("Gmail の送信上限の応答（5.4.5、上限超過の語）は quota", () => {
    expect(isMailStopError(err({ responseCode: 550, response: "550 5.4.5 Daily user sending quota exceeded." }))).toBe("quota");
    expect(isMailStopError(err({ response: "550-5.4.5 Daily user sending limit exceeded" }))).toBe("quota");
    expect(isMailStopError(err({ message: "Daily sending quota exceeded" }))).toBe("quota");
  });
  it("宛先の不備（5.1.1 など）や通信の失敗、普通のエラーは null（その人だけの失敗）", () => {
    expect(isMailStopError(err({ responseCode: 550, response: "550 5.1.1 The email account that you tried to reach does not exist." }))).toBeNull();
    expect(isMailStopError(err({ code: "EENVELOPE", responseCode: 553 }))).toBeNull();
    expect(isMailStopError(err({ code: "ETIMEDOUT" }))).toBeNull();
    expect(isMailStopError(new Error("boom"))).toBeNull();
    expect(isMailStopError(null)).toBeNull();
    expect(isMailStopError("EAUTH")).toBeNull();
    expect(isMailStopError(undefined)).toBeNull();
  });
});

describe("unsubscribeUrlFor", () => {
  const deps = (appUrl: string) => ({ appUrl, unsubscribeSecret: SECRET }) as unknown as NotifyDeps;
  it("${appUrl}/unsubscribe?farm=&uid=&sig=。署名が通る", () => {
    const url = new URL(unsubscribeUrlFor({ farmId: "f1", uid: "u1" }, deps("https://app.example.test")));
    expect(url.origin + url.pathname).toBe("https://app.example.test/unsubscribe");
    expect(url.searchParams.get("farm")).toBe("f1");
    expect(url.searchParams.get("uid")).toBe("u1");
    expect(verifyUnsubscribe("f1", "u1", url.searchParams.get("sig")!, SECRET)).toBe(true);
  });
  it("appUrl の末尾の / は重ねず、特別な文字は符号化する", () => {
    const raw = unsubscribeUrlFor({ farmId: "f 1&x", uid: "u/1" }, deps("https://app.example.test/"));
    expect(raw.startsWith("https://app.example.test/unsubscribe?")).toBe(true);
    const url = new URL(raw);
    expect(url.searchParams.get("farm")).toBe("f 1&x");
    expect(url.searchParams.get("uid")).toBe("u/1");
  });
});
