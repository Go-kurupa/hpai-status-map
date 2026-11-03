import { describe, expect, it } from "vitest";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { EMULATOR_APP_OPTIONS, resolveFirebaseMode } from "./firebase";

describe("EMULATOR_APP_OPTIONS", () => {
  it("getAuth が auth/invalid-api-key で落ちない（E2E で「メールを送れませんでした」になった原因）", () => {
    const app = initializeApp(EMULATOR_APP_OPTIONS, "emulator-options-test");
    expect(() => getAuth(app)).not.toThrow();
  });
  it("projectId は demo-（本番に届かない名前）", () => {
    expect(EMULATOR_APP_OPTIONS.projectId).toMatch(/^demo-/);
  });
});

describe("resolveFirebaseMode", () => {
  it("?emulator=1 は開発でなくても模擬環境", () => {
    expect(resolveFirebaseMode("?emulator=1", false)).toBe("emulator");
  });
  it("開発（dev server）は模擬環境", () => {
    expect(resolveFirebaseMode("", true)).toBe("emulator");
  });
  it("本番の build で何も付けなければ hosting", () => {
    expect(resolveFirebaseMode("", false)).toBe("hosting");
  });
  it("emulator=0 や別の値は模擬環境にしない", () => {
    expect(resolveFirebaseMode("?emulator=0", false)).toBe("hosting");
    expect(resolveFirebaseMode("?x=1&emulator=1", false)).toBe("emulator");
  });
});
