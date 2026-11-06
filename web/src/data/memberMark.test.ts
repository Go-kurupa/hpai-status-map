import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_KEY, readMemberMark, writeMemberMark } from "./memberMark";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("会員の印（決定 15）", () => {
  it("付けると hpai.member.v1 に 1、外すと消える。読むと true / false", () => {
    expect(readMemberMark()).toBe(false);
    writeMemberMark(true);
    expect(localStorage.getItem(MEMBER_KEY)).toBe("1");
    expect(readMemberMark()).toBe(true);
    writeMemberMark(false);
    expect(localStorage.getItem(MEMBER_KEY)).toBeNull();
    expect(readMemberMark()).toBe(false);
  });
  it("変わったときだけ同じタブへ知らせる", () => {
    const seen = vi.fn();
    window.addEventListener("hpai-member-mark", seen);
    writeMemberMark(true);
    writeMemberMark(true);
    writeMemberMark(false);
    window.removeEventListener("hpai-member-mark", seen);
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it("1 以外の値は印とみなさない", () => {
    localStorage.setItem(MEMBER_KEY, "true");
    expect(readMemberMark()).toBe(false);
  });
  it("localStorage が使えない環境でも投げない", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMemberMark()).toBe(false);
    expect(() => writeMemberMark(true)).not.toThrow();
  });
});
