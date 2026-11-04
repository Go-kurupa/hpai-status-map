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

describe("resolveFirebaseMode（S-33。模擬環境に繋げるのは dev server と E2E の build だけ）", () => {
  const DEV = { DEV: true, MODE: "development" };
  const E2E = { DEV: false, MODE: "e2e" };
  const PROD = { DEV: false, MODE: "production" };
  it("E2E の build（mode=e2e）は ?emulator=1 で模擬環境", () => {
    expect(resolveFirebaseMode("?emulator=1", E2E)).toBe("emulator");
    expect(resolveFirebaseMode("?x=1&emulator=1", E2E)).toBe("emulator");
  });
  it("開発（dev server）は模擬環境", () => {
    expect(resolveFirebaseMode("", DEV)).toBe("emulator");
  });
  it("本番の build は ?emulator=1 が付いても hosting（本番のリンクに付けても、模擬環境の口に繋がない）", () => {
    expect(resolveFirebaseMode("?emulator=1", PROD)).toBe("hosting");
    expect(resolveFirebaseMode("?x=1&emulator=1", PROD)).toBe("hosting");
    expect(resolveFirebaseMode("", PROD)).toBe("hosting");
    expect(resolveFirebaseMode("?emulator=1", { DEV: false, MODE: "staging" })).toBe("hosting");
  });
  it("E2E の build でも、?emulator=1 がなければ hosting。emulator=0 や別の値は模擬環境にしない", () => {
    expect(resolveFirebaseMode("", E2E)).toBe("hosting");
    expect(resolveFirebaseMode("?emulator=0", E2E)).toBe("hosting");
  });
});
