// 環境省の経路図（data/migration/routes/）。取得したままで、画像を変えていないことを確かめる。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIR = path.join(ROOT, "data", "migration", "routes");

const FILES = [
  ["zu1.jpg", 140309, "f137ef1e54900f28a549ba36699641a59bf42f39d463a7a76d507b8f9a0b8406"],
  ["zu2.jpg", 158761, "e733d2f00d981259c2165cf8afae2ff5b14b0131e5b943d0881ec6ba8506569c"],
  ["zu3.jpg", 166521, "02b97d67280d08ab04be007c2ab5c0c0627396e86c85a73ff71dc306366ecad1"],
  ["zu4.jpg", 131387, "0234c45c02d5407c2b6b19b0ec1fb84ff8b7e284a5439c191238d4c34f316cd3"],
  ["zu5.png", 195351, "8067ce2ed8123bd883cbe525f0022bf2e631a458b948b03af14d791105632e7f"],
] as const;

describe("data/migration/routes/", () => {
  it("図 1〜5 の 5 枚だけがある", () => {
    expect(fs.readdirSync(DIR).sort()).toEqual(FILES.map(([f]) => f));
  });

  it.each(FILES)("%s は取得したときの大きさと sha256 のまま", (file, size, sha256) => {
    const bytes = fs.readFileSync(path.join(DIR, file));
    expect(bytes.length).toBe(size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it("docs/data-sources.md の節に、同じ sha256 を書いている", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs", "data-sources.md"), "utf8");
    for (const [, , sha256] of FILES) expect(doc).toContain(sha256);
  });
});
