import { findForbiddenPhrases } from "@hpai/shared/wording";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_ATTRIBUTION, VMAP0_NOTICE } from "./attribution";

const joined = MAP_ATTRIBUTION.join("\n");
const DOC = fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/data-sources.md"), "utf8");

describe("MAP_ATTRIBUTION", () => {
  it("3 つの出典がこの順にある", () => {
    expect(MAP_ATTRIBUTION).toHaveLength(3);
    expect(MAP_ATTRIBUTION[0]).toContain("地理院タイル");
    expect(MAP_ATTRIBUTION[1]).toBe(VMAP0_NOTICE);
    expect(MAP_ATTRIBUTION[2]).toContain("国土数値情報");
  });

  it("地理院タイルの一覧ページと、国土数値情報の配布ページにリンクする", () => {
    expect(joined).toContain('href="https://maps.gsi.go.jp/development/ichiran.html"');
    expect(joined).toContain('href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html"');
    expect(MAP_ATTRIBUTION[0]).toContain("行政区域を追記して掲載");
  });

  it("リンクは新しいタブで開き、元のページを渡さない", () => {
    for (const m of joined.matchAll(/<a [^>]*>/g)) {
      expect(m[0]).toContain('target="_blank"');
      expect(m[0]).toContain('rel="noopener noreferrer"');
    }
  });

  it("VMAP0、国土交通省、簡略化の語がある", () => {
    expect(joined).toMatch(/Vector Map Level 0/);
    expect(joined).toMatch(/国土交通省/);
    expect(joined).toMatch(/簡略化/);
  });

  it("手続きが不要だと確認した、とは書かない（契約 0）", () => {
    expect(joined).not.toMatch(/(不要と確認|手続きは不要|申請不要)/);
  });

  it("禁句がない", () => {
    expect(findForbiddenPhrases(joined)).toEqual([]);
  });

  it("docs/data-sources.md に VMAP0_NOTICE と同じ文がある", () => {
    expect(DOC).toContain(VMAP0_NOTICE);
  });

  it("docs/data-sources.md の地理院タイルの節に、画面と同じ 3 つの出典の文がある", () => {
    const start = DOC.indexOf("## 地理院タイル");
    const end = DOC.indexOf("\n## ", start + 1);
    const sec = DOC.slice(start, end >= 0 ? end : undefined);
    const plain = (s: string) => s.replace(/<[^>]*>/g, "");
    expect(sec).toContain("行政区域を追記して掲載");
    expect(sec).toContain(VMAP0_NOTICE);
    expect(sec).toContain(plain(MAP_ATTRIBUTION[2]!));
  });
});
