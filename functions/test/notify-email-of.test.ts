// M-13 修正 2: 宛先の取得。ユーザーが存在しない（auth/user-not-found）ときだけ null、一時的な障害は投げる。
import { describe, expect, it } from "vitest";
import { makeEmailOf } from "../src/notify/liveDeps";

const err = (code: string) => Object.assign(new Error("x"), { code });

describe("makeEmailOf", () => {
  it("メールアドレスを返す。アドレスがないユーザーは null", async () => {
    expect(await makeEmailOf(async () => ({ email: "a@example.test" }))("u1")).toBe("a@example.test");
    expect(await makeEmailOf(async () => ({}))("u1")).toBeNull();
    expect(await makeEmailOf(async () => ({ email: "" }))("u1")).toBeNull();
  });

  it("auth/user-not-found だけ null（退会したユーザー）", async () => {
    expect(await makeEmailOf(async () => Promise.reject(err("auth/user-not-found")))("u1")).toBeNull();
  });

  it("それ以外の例外（一時的な障害）は投げる", async () => {
    for (const code of ["auth/internal-error", "app/network-error", "unavailable"]) {
      await expect(makeEmailOf(async () => Promise.reject(err(code)))("u1")).rejects.toMatchObject({ code });
    }
    await expect(makeEmailOf(async () => Promise.reject(new Error("boom")))("u1")).rejects.toThrow("boom");
  });
});
