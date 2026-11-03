// data/sources.json（commit する見回り先）の中身の検査。設計書 §9.2。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREFS } from "@hpai/shared/pref";
import { normalizeForMatch } from "@hpai/shared/text";
import type { SourceSeed } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { TWELVE_PREFS } from "../lib/sources";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const seeds: SourceSeed[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources.json"), "utf8"));

const twelve = new Set(TWELVE_PREFS.map((p) => p.code));
const ofPref = (name: string) => {
  const code = PREFS.find((p) => p.name === name)!.code;
  return seeds.filter((s) => s.prefCode === code);
};
const urlsOf = (name: string) => ofPref(name).map((s) => s.url);
const prefRows = seeds.filter((s) => s.prefCode !== null);

describe("data/sources.json の形", () => {
  it("国と環境省の 3 行（maff_press、maff_season、moe）。県コードは null", () => {
    const national = seeds.filter((s) => s.prefCode === null);
    expect(national.map((s) => s.kind).sort()).toEqual(["maff_press", "maff_season", "moe"]);
    expect(national.find((s) => s.kind === "maff_press")!.url).toBe("https://www.maff.go.jp/j/press/index.html");
    expect(national.find((s) => s.kind === "maff_season")!.url).toBe("https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html");
    expect(national.find((s) => s.kind === "moe")!.url).toBe("https://www.env.go.jp/nature/dobutsu/bird_flu/");
  });

  it("47 都道府県のすべてに 1 行以上。計 108 行（35 県 69、12 県 36、国 3）", () => {
    for (const p of PREFS) expect(ofPref(p.name).length, `${p.name} に入口がありません`).toBeGreaterThanOrEqual(1);
    expect(seeds).toHaveLength(108);
    expect(prefRows.filter((s) => !twelve.has(s.prefCode!))).toHaveLength(69);
    expect(prefRows.filter((s) => twelve.has(s.prefCode!))).toHaveLength(36);
    expect(seeds.filter((s) => s.prefCode === null)).toHaveLength(3);
  });

  it("opsAdmin の seed-sources が読む形: 5 つの項目だけ、種類は SourceKind、日付は YYYY-MM-DD、URL は https", () => {
    const kinds = new Set(["maff_press", "maff_season", "moe", "pref_fixed", "pref_rss", "pref_press_list"]);
    for (const s of seeds) {
      expect(Object.keys(s).sort()).toEqual(["confirmedOn", "kind", "note", "prefCode", "url"]);
      expect(kinds.has(s.kind)).toBe(true);
      expect(s.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new URL(s.url).protocol).toBe("https:");
      expect(s.prefCode === null || /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(s.prefCode)).toBe(true);
    }
  });

  it("県の行のホストは pref.<名>.jp、pref.<名>.lg.jp、metro.tokyo.lg.jp のどれか（X-14 が使う）", () => {
    for (const s of prefRows) expect(new URL(s.url).hostname, s.url).toMatch(/(pref\.[a-z]+(\.lg)?\.jp|metro\.tokyo\.lg\.jp)$/);
  });

  it("URL の重複がない", () => {
    const urls = seeds.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("県の種類は pref_fixed、pref_rss、pref_press_list だけ。国の種類は県の行に出ない", () => {
    for (const s of prefRows) expect(["pref_fixed", "pref_rss", "pref_press_list"]).toContain(s.kind);
  });
});

describe("12 県の確定の内容", () => {
  it("愛媛に soshiki/85/ と soshiki-19-85.xml がある", () => {
    const urls = urlsOf("愛媛県");
    expect(urls.some((u) => u.includes("soshiki/85/"))).toBe(true);
    expect(urls.some((u) => u.includes("soshiki-19-85.xml"))).toBe(true);
  });

  it("福岡: kachikueisei-osirase.html が pref_fixed、press/ が pref_press_list、pref_rss はない", () => {
    const rows = ofPref("福岡県");
    expect(rows.find((s) => s.url.endsWith("/contents/kachikueisei-osirase.html"))?.kind).toBe("pref_fixed");
    expect(rows.find((s) => s.url.endsWith("/press/"))?.kind).toBe("pref_press_list");
    expect(rows.some((s) => s.kind === "pref_rss")).toBe(false);
  });

  it("福井の note に「国の発表で補う」がある", () => {
    expect(ofPref("福井県").some((s) => s.note?.includes("国の発表で補う"))).toBe(true);
  });

  it("使わないと決めた入口がない", () => {
    const urls = seeds.map((s) => s.url);
    expect(urls.some((u) => u.includes("www2.pref.fukui.lg.jp"))).toBe(false);
    expect(urls.some((u) => u.includes("kintoneapp.com"))).toBe(false);
    expect(urls.some((u) => u.includes("pref.fukuoka.lg.jp/rss/"))).toBe(false);
    expect(urls).not.toContain("https://www.pref.kumamoto.jp/soshiki/77/1401.html");
    expect(urls.some((u) => u.endsWith("tokuteikatiku.html"))).toBe(false);
    expect(urls.some((u) => u.endsWith("2025toriinflu.html"))).toBe(false);
  });

  it("次季の再利用が未確認のページには、その旨の note がある", () => {
    const note = (suffix: string) => seeds.find((s) => s.url.endsWith(suffix))?.note ?? "";
    expect(note("/page/338648.html")).toContain("未確認");
    expect(note("/page/95900.html")).toContain("未確認");
    expect(note("/20260309.html")).toContain("未確認");
  });

  it("調査の日 2026-11-03 のまま（到達の結果を反映するのは Step 7）", () => {
    // 反映後は日付が動く。そのときはこの試験を直す
    expect(new Set(seeds.map((s) => s.confirmedOn))).toEqual(new Set(["2026-11-03"]));
  });
});

describe("note の決まり", () => {
  const notes = seeds.flatMap((s) => (s.note === null ? [] : [{ url: s.url, note: s.note }]));

  it("null か 60 字以内で、禁止の語（安全、安心、区域の外です）がない", () => {
    expect(notes.length).toBeGreaterThan(0);
    for (const { url, note } of notes) {
      expect(note.length, url).toBeLessThanOrEqual(60);
      expect(findForbiddenPhrases(note), url).toEqual([]);
    }
  });

  // 調査の資料（private/）の文を写していないこと。資料が手元にない環境では飛ばす（REQUIRE_FIXTURES=1 なら失敗にする）
  const PRIVATE = path.join(ROOT, "private", "research", "pref-feeds");
  const present = fs.existsSync(PRIVATE);
  if (!present && process.env.REQUIRE_FIXTURES === "1") {
    it("調査の資料（private/research/pref-feeds）がある", () => {
      throw new Error("REQUIRE_FIXTURES=1 なのに private/research/pref-feeds がありません");
    });
  }

  describe.skipIf(!present)("手元の資料と一致する文がない", () => {
    const sentences = new Set<string>();
    if (present) {
      for (const f of fs.readdirSync(PRIVATE)) {
        if (!/\.(md|tsv)$/.test(f)) continue;
        for (const piece of fs.readFileSync(path.join(PRIVATE, f), "utf8").split(/[。\n|｜\t]/)) {
          const s = normalizeForMatch(piece);
          if (s.length >= 4) sentences.add(s);
        }
      }
    }

    it("資料を読めている（空でない）", () => {
      expect(sentences.size).toBeGreaterThan(100);
    });

    it("note 全体と、note の各文（。で区切る。8 字以上）が、資料のどの文とも一致しない", () => {
      // 「確定できず」「野鳥のみ」のような 7 字以下は、文ではなく表の語（ラベル）なので、比べから外す
      for (const { url, note } of notes) {
        const whole = normalizeForMatch(note);
        if (whole.length >= 8) expect(sentences.has(whole), `${url} の note が資料の文と一致します`).toBe(false);
        for (const piece of note.split("。")) {
          const s = normalizeForMatch(piece);
          if (s.length < 8) continue;
          expect(sentences.has(s), `${url} の note「${piece}」が資料の文と一致します`).toBe(false);
        }
      }
    });
  });
});
