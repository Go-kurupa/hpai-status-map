import { describe, expect, it } from "vitest";
import { resolveFirebaseMode } from "./firebase";

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
