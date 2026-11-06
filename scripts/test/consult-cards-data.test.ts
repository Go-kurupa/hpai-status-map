// 実物の data/consult/cards.json の確かめ。公開するデータそのものを見る（下書きは要らない）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_LICENSES, parseCardsFile } from "@hpai/shared/consult/schema";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "consult", "cards.json"), "utf8")) as { cards: Array<Record<string, unknown>> };
const file = parseCardsFile(raw);

describe("data/consult/cards.json（実物）", () => {
  it("カードは 103 枚で、外すと決めた 2 枚（maff-M19b、okayama-OK3）がない", () => {
    expect(file.cards).toHaveLength(103);
    const ids = new Set(file.cards.map((c) => c.id));
    expect(ids.has("maff-M19b")).toBe(false);
    expect(ids.has("okayama-OK3")).toBe(false);
  });

  it("補助の項目（continuesWith、referenceOnly、overlapsWith）がない", () => {
    for (const c of raw.cards) {
      for (const key of ["continuesWith", "referenceOnly", "overlapsWith"]) expect(c, `${String(c.id)} に ${key}`).not.toHaveProperty(key);
    }
  });

  it("カードはすべて approved: true", () => {
    expect(file.cards.filter((c) => !c.approved).map((c) => c.id)).toEqual([]);
  });

  it("資料の許可証は許可の 5 種のどれかで、すべて licenseVerified: true", () => {
    for (const s of file.sources) {
      expect(ALLOWED_LICENSES as readonly string[], s.id).toContain(s.license);
      expect(s.licenseVerified, `${s.id} の licenseVerified`).toBe(true);
    }
  });

  it("使われない資料がなく、並びは id 順", () => {
    const used = new Set(file.cards.map((c) => c.sourceId));
    expect(file.sources.filter((s) => !used.has(s.id)).map((s) => s.id)).toEqual([]);
    const sorted = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.id);
    expect(file.sources.map((s) => s.id)).toEqual(sorted(file.sources));
    expect(file.cards.map((c) => c.id)).toEqual(sorted(file.cards));
  });
});
