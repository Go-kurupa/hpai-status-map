// カードの確定（build-cards）の試験。下書きを cards.json にする関数だけを見る（実ファイルは読まない）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCard, ConsultSource } from "@hpai/shared/consult/types";
import { buildCards, EXCLUDED_CARD_IDS, runBuildCards, serializeCards } from "../consult/build-cards";

function source(over: Partial<ConsultSource> = {}): ConsultSource {
  return {
    id: "s1",
    title: "資料",
    publisher: "農林水産省",
    url: "https://www.maff.go.jp/a.pdf",
    fetchedAt: "2026-11-06",
    domestic: true,
    kind: "guideline",
    license: "PDL1.0",
    licenseVerified: true,
    studyDesign: null,
    ...over,
  };
}

function card(over: Partial<ConsultCard> = {}): Record<string, unknown> {
  // 下書き: approved がなく、補助の項目がある
  const { approved: _approved, ...rest }: ConsultCard = {
    id: "c1",
    origin: "M01",
    action: "防鳥ネットを張る",
    appliesTo: "すべての農場",
    evidence: "obligation",
    evidenceNote: "",
    quote: "網目の大きさが二センチメートル以下のもの",
    sourceId: "s1",
    locator: "p1",
    caveats: [],
    conditionTags: [],
    approved: false,
    ...over,
  };
  return { ...rest, continuesWith: "c2", referenceOnly: true, overlapsWith: ["c9"] };
}

function draft(cards: Array<Record<string, unknown>>, sources: ConsultSource[] = [source()]) {
  return { sources, cards };
}

describe("buildCards（下書きを cards.json の形にする）", () => {
  it("外す id は maff-M19b と okayama-OK3", () => {
    expect([...EXCLUDED_CARD_IDS]).toEqual(["maff-M19b", "okayama-OK3"]);
  });

  it("外す id のカードを除く", () => {
    const d = draft([card({ id: "a" }), card({ id: "x" }), card({ id: "b" })]);
    const out = buildCards(d, ["x"]);
    expect(out.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("下書きにない id を外そうとしたら throw する（外し忘れ、綴りの違いを見逃さない）", () => {
    expect(() => buildCards(draft([card({ id: "a" })]), ["nothing"])).toThrow(/nothing/);
  });

  it("補助の項目（continuesWith、referenceOnly、overlapsWith）を落とし、parseCardsFile に通る", () => {
    const out = buildCards(draft([card({ id: "a" })]), []);
    for (const c of out.cards) {
      expect(c).not.toHaveProperty("continuesWith");
      expect(c).not.toHaveProperty("referenceOnly");
      expect(c).not.toHaveProperty("overlapsWith");
    }
    expect(() => parseCardsFile(JSON.parse(serializeCards(out)))).not.toThrow();
  });

  it("残ったカードはすべて approved: true になる（下書きが false でも）", () => {
    const d = draft([card({ id: "a" }), { ...card({ id: "b" }), approved: false }]);
    const out = buildCards(d, []);
    expect(out.cards.map((c) => c.approved)).toEqual([true, true]);
  });

  it("使われなくなった資料は sources から外す。使われている資料は残す", () => {
    const d = draft(
      [card({ id: "a", sourceId: "s1" }), card({ id: "x", sourceId: "s2" })],
      [source({ id: "s1" }), source({ id: "s2" })],
    );
    const out = buildCards(d, ["x"]);
    expect(out.sources.map((s) => s.id)).toEqual(["s1"]);
  });

  it("資料の id 順、カードの id 順に並べる（下書きの順に関わらない）", () => {
    const d = draft(
      [card({ id: "b", sourceId: "s2" }), card({ id: "c", sourceId: "s1" }), card({ id: "a", sourceId: "s2" })],
      [source({ id: "s2" }), source({ id: "s1" })],
    );
    const out = buildCards(d, []);
    expect(out.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(out.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("入力は書き換えない", () => {
    const d = draft([card({ id: "a" }), card({ id: "x" })]);
    const before = JSON.stringify(d);
    buildCards(d, ["x"]);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("形が違う下書き（未知の項目、許可証の綴り違い）は throw する", () => {
    expect(() => buildCards(draft([{ ...card({ id: "a" }), extra: 1 }]), [])).toThrow();
    expect(() => buildCards(draft([card({ id: "a" })], [source({ license: "CC0" as never })]), [])).toThrow();
  });
});

describe("serializeCards（毎回同じ出力）", () => {
  it("2 字下げの JSON で、末尾に改行が 1 つ", () => {
    const text = serializeCards(buildCards(draft([card({ id: "a" })]), []));
    expect(text.startsWith('{\n  "sources": [\n    {\n      "id": "s1"')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("下書きの並びを変えても、同じ文字列になる", () => {
    const a = serializeCards(buildCards(draft([card({ id: "a" }), card({ id: "b" })]), []));
    const b = serializeCards(buildCards(draft([card({ id: "b" }), card({ id: "a" })]), []));
    expect(b).toBe(a);
  });
});

describe("runBuildCards（コマンド）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-build-cards-"));
    dirs.push(d);
    return d;
  };

  it("下書きを読んで cards.json を書く。2 回流しても同じ内容", () => {
    const dir = tmp();
    const input = path.join(dir, "draft.json");
    const out = path.join(dir, "out", "cards.json");
    fs.writeFileSync(input, JSON.stringify(draft([card({ id: "a" }), card({ id: "maff-M19b" }), card({ id: "okayama-OK3" })])));
    const logs: string[] = [];
    expect(runBuildCards(["--in", input, "--out", out], (s) => logs.push(s))).toBe(0);
    const first = fs.readFileSync(out, "utf8");
    expect(parseCardsFile(JSON.parse(first)).cards.map((c) => c.id)).toEqual(["a"]);
    expect(runBuildCards(["--in", input, "--out", out], () => {})).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe(first);
    expect(logs.join("")).toContain("1 枚");
  });

  it("入力がなければ 2 を返し、出力を作らない", () => {
    const dir = tmp();
    const out = path.join(dir, "cards.json");
    const logs: string[] = [];
    expect(runBuildCards(["--in", path.join(dir, "none.json"), "--out", out], (s) => logs.push(s))).toBe(2);
    expect(fs.existsSync(out)).toBe(false);
  });
});
