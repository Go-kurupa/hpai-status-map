import { describe, expect, it, vi } from "vitest";
import { isStaleChunkError, reloadOnceForStaleChunk } from "./staleChunk";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("本番を出し直した後の、古い部品のファイルの読み込みの失敗", () => {
  it("動的な読み込みの失敗の文を見分ける。ほかの例外は見分けない", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/ExplorePage-abc.js"))).toBe(true);
    expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });

  it("1 回だけ読み込み直す。直後にもう一度失敗しても、繰り返さない（止まらない読み込み直しにしない）", () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ storage, reload, now: 1_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForStaleChunk({ storage, reload, now: 5_000 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // しばらく経てば、また 1 回だけ読み込み直せる（次の反映の後など）
    expect(reloadOnceForStaleChunk({ storage, reload, now: 70_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("保存できない端末でも落ちない（読み込み直しはする）", () => {
    const reload = vi.fn();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(reloadOnceForStaleChunk({ storage: broken, reload, now: 1 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
