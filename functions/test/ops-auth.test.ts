import { describe, expect, it } from "vitest";
import { checkBearer } from "../src/ops/auth";

const TOKEN = "test-token-not-a-real-secret";

describe("checkBearer", () => {
  it("一致で true", () => {
    expect(checkBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("値違いで false", () => {
    expect(checkBearer("Bearer test-token-not-a-real-secreT", TOKEN)).toBe(false);
  });

  it("長さ違いは例外にせず false", () => {
    expect(() => checkBearer("Bearer x", TOKEN)).not.toThrow();
    expect(checkBearer("Bearer x", TOKEN)).toBe(false);
    expect(checkBearer(`Bearer ${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
    expect(checkBearer("Bearer ", TOKEN)).toBe(false);
  });

  it("ヘッダなし（undefined）は false", () => {
    expect(checkBearer(undefined, TOKEN)).toBe(false);
  });

  it("Bearer 形式でないヘッダは false", () => {
    expect(checkBearer(TOKEN, TOKEN)).toBe(false);
    expect(checkBearer(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(checkBearer("", TOKEN)).toBe(false);
  });

  it("期待値が空なら、空の Bearer とも一致させない", () => {
    expect(checkBearer("Bearer ", "")).toBe(false);
    expect(checkBearer("Bearer", "")).toBe(false);
    expect(checkBearer(undefined, "")).toBe(false);
  });
});
