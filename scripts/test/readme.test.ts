// README.md の試験。審査員が最初に読む文書で、書いてあるべきことと、書いてはいけないことを確かめる。
// 書いてはいけないこと: 農場名と地域、手続きを不要と確認したという言い方、効果の数字、内部の言葉、電話番号の形、禁句。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findWordingViolations } from "@hpai/shared/wording";
import { MAP_ATTRIBUTION } from "../../web/src/geo/attribution";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

/** 運営者と地域は、対の印で囲む。囲みの中に利用者が 1 行を入れる（農場名と地域を出す決定）。 */
const OPERATOR_BEGIN = "<!-- 運営者と地域: ここから -->";
const OPERATOR_END = "<!-- 運営者と地域: ここまで -->";
/** 囲み（印を含む）を除いた README。地名の禁止は、ここにだけかける。 */
const outsideOperator = readme.replace(new RegExp(`${OPERATOR_BEGIN}[\\s\\S]*?${OPERATOR_END}`, "u"), "");
const plain = (html: string) => html.replace(/<[^>]*>/gu, "");

/** `## <題>` から次の `## ` の手前まで。題は一部の一致でよい。 */
function section(titlePart: string): string {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^## /u.test(l) && l.includes(titlePart));
  expect(start, `「## …${titlePart}…」の節がありません`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /u.test(l));
  return [lines[start]!, ...(end >= 0 ? rest.slice(0, end) : rest)].join("\n");
}

// 2026-11-08: 冒頭に「なぜ作ったか」「できること」を置いたので、最初の節ではなく審査員の節を題で探す
const firstSection = (): string => {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^## 審査員の方へ/u.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /u.test(l));
  return [lines[start]!, ...(end >= 0 ? rest.slice(0, end) : rest)].join("\n");
};

describe("README: 最初の節（審査員が登録なしで触れる入口）", () => {
  const first = firstSection();
  it("登録なしで触れる 4 つの画面がある", () => {
    for (const p of ["/replay", "/replay/backstage", "/results", "/public"]) expect(first, p).toContain(p);
  });
  // 2026-11-08: 相談の試しの入口（/consult?judge=1）を外し、審査員用のリンクに替えた。見本の農場（/sample）は 2 本目のリンクとして提出フォームで案内する。リンクの実物は書かない
  it("会員の画面は審査員用のリンク、見本の農場は 2 本目のリンクで開けると書く。/sample と ?judge=1 と /judge# のリンクは書かない", () => {
    expect(first).toContain("会員の画面（死亡・消毒の記録、農場と通知の設定、AIに対策を相談）は、提出フォームの審査員向けの欄のリンクで、審査員用の見本の農場の会員として開けます。");
    expect(first).not.toContain("/sample");
    expect(first).not.toContain("judge=1");
    // 2026-11-08: 見本の農場（/sample）を、審査員用の 2 本目の URL として戻した。URL は書かず、提出フォームで案内する
    expect(first).toContain("近くで発生した場合の画面（2025 年 12 月の再現の中で、農場の近くで発生したときの地図と対策項目）は、提出フォームの審査員向けの欄の 2 本目のリンクで開けます。");
    expect(readme).not.toMatch(/\/judge#/u);
  });
  it("順路に全国の流れ、周辺の過去の表、毎朝の札、経路図がある。メールは登録した方だけと分ける", () => {
    for (const w of ["全国の流れ", "/area/", "/trends", "経路図", "直近 14 日", "発表の区域ではありません", "メールは登録した方だけ"]) expect(first, w).toContain(w);
  });
  it("登録がいらないこと、本番の URL を利用者が入れる印がある", () => {
    expect(first).toMatch(/登録(は)?(いりません|不要|なし)/u);
    expect(first).toContain("https://hpai-status-map.web.app/");
  });
});

describe("README: 冒頭の 3 行（画面の表の前）", () => {
  const head = readme.slice(0, readme.indexOf("|"));
  it("誰の、どんな課題を、どう解決するか、が表より前にある", () => {
    expect(head).toMatch(/- \*\*誰の\*\*/u);
    expect(head).toMatch(/- \*\*どんな課題を\*\*/u);
    expect(head).toMatch(/- \*\*どう解決するか\*\*/u);
  });
  it("まだ起きていないことを、事実のように書かない（毎朝開く、使い続けます）", () => {
    expect(readme).not.toMatch(/毎朝開く|使い続けます|使い続ける/u);
  });
});

describe("README: 運営者と地域（利用者が入れる）", () => {
  it("対の印がそれぞれ 1 つあり、順に並ぶ", () => {
    expect(readme.split(OPERATOR_BEGIN)).toHaveLength(2);
    expect(readme.split(OPERATOR_END)).toHaveLength(2);
    expect(readme.indexOf(OPERATOR_BEGIN)).toBeLessThan(readme.indexOf(OPERATOR_END));
  });
  it("囲みの外に、農場名と地域の名前を書かない（題材の説明にも）。囲みの中は利用者が決める", () => {
    expect(outsideOperator).not.toMatch(/西粟倉|津山|岡山|美作|真庭/u);
  });
});

describe("README: 何のための道具か", () => {
  const sec = section("なぜ作ったか");
  it("家畜保健衛生所の速報を全国の俯瞰と過去で補う。切り替えの基準は農場が決める", () => {
    for (const w of ["家畜保健衛生所の速報を全国の俯瞰と過去で補い", "他人事", "全国の俯瞰", "基準はこのサイトが決めず、農場が決めます"]) expect(sec, w).toContain(w);
  });
});

describe("README: 公開した後に残らない書き方", () => {
  it("作業の文（入ります、入れます、利用者が入れる）が、見える文にない（コメントを除く）", () => {
    const visible = readme.replace(/<!--[\s\S]*?-->/gu, "");
    expect(visible).not.toMatch(/印のところ|入ります。|利用者が入れ|公開の時に入れ/u);
  });
});

describe("README: ライセンス", () => {
  const sec = section("ライセンス");
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  it("LICENSE がある。MIT の全文で、著作権者は Go Hatomi", () => {
    expect(license).toMatch(/^MIT License\n/u);
    expect(license).toContain("Copyright (c) 2026 Go Hatomi");
    expect(license).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
  });
  it("README から LICENSE へのリンクがある", () => {
    expect(sec).toContain("(LICENSE)");
  });
  it("コードは MIT。外部のデータはそれぞれの条件に従う。外部のデータの表へのリンクがある", () => {
    expect(sec).toContain("MIT");
    expect(sec).toMatch(/それぞれの条件に従/u);
    expect(sec).toContain("(#外部のデータと素材)");
    for (const w of ["地図", "国のデータ", "地理院タイル"]) expect(sec, w).toContain(w);
  });
});

describe("README: 新しく作ったものと、前からある道具", () => {
  it("「期間中に新しく作った」節と「開始前からある道具」節がある", () => {
    expect(section("期間中に新しく作った").length).toBeGreaterThan(80);
    expect(section("開始前からある道具").length).toBeGreaterThan(80);
  });
  it("既存の業務アプリのコード、画面、データ構造を持ち込んでいない", () => {
    expect(section("期間中に新しく作った")).toMatch(/持ち込んで(い)?(いません|ない)/u);
  });
});

describe("README: Claude の使い方", () => {
  const sec = section("Claude の使い方");
  it.each(["読み取り", "二重読み", "入口を直すエージェント", "スキル", "hook", "サブエージェント", "MCP"])("%s がある", (w) => {
    expect(sec).toContain(w);
  });
  it("開発は Claude Code だけ。Codex とローカル LLM は使っていない、とはっきり書く", () => {
    expect(sec).toMatch(/Codex は使って(い)?(いません|ない)/u);
    expect(sec).toMatch(/ローカル LLM は使って(い)?(いません|ない)/u);
    expect(sec).toMatch(/Claude Code だけ/u);
  });
  it("モデルを使い分けた理由の記録へのリンクがある", () => {
    expect(sec).toContain("(docs/claude-code-usage.md)");
  });
});

describe("README: 判定と AI の分担", () => {
  it("段階 ③ に約 60 km の帯があり、区域の判定に使わないと書く", () => {
    const sec = section("分担");
    expect(sec).toContain("③ 約 60 km 以内か、よく行き来する町で発生");
    expect(sec).toContain("区域の判定には使いません");
  });
  it("決まりはコード、確定は人、と書く", () => {
    const sec = section("分担");
    expect(sec).toMatch(/コード/u);
    expect(sec).toMatch(/人が/u);
    expect(sec).toMatch(/下書き/u);
  });
});

describe("README: 公開 API と MCP", () => {
  const sec = section("公開 API と MCP");
  it("API の 4 つの入口", () => {
    for (const p of ["/api/v1/cases", "/api/v1/areas/", "/api/v1/watch-status", "/api/v1/wild-birds"]) expect(sec, p).toContain(p);
  });
  it("MCP の 4 つの道具", () => {
    for (const t of ["list_cases", "get_area_status", "get_watch_status", "get_official_guidance"]) expect(sec, t).toContain(t);
  });
  it("利用条件（読み取り専用、認証なし、回数の制限、県の連絡が正）", () => {
    expect(sec).toContain("利用条件");
    expect(sec).toContain("読み取り専用");
    expect(sec).toMatch(/認証(は)?(ありません|なし)/u);
    expect(sec).toMatch(/毎分 60 回/u);
    expect(sec).toContain("県の連絡が正です");
  });
});

describe("README: 限界", () => {
  const sec = section("限界");
  it("県の連絡が正です、確認できません（古い TLS など）", () => {
    expect(sec).toContain("県の連絡が正です");
    expect(sec).toContain("確認できません");
    expect(sec).toMatch(/TLS/u);
  });
  it("end_turn で終わったエージェントの実行は失敗に数えない", () => {
    expect(sec).toContain("end_turn");
  });
  it("測っていないものは未実測と書く", () => {
    expect(sec).toContain("未実測");
  });
});

describe("README: 費用", () => {
  const sec = section("費用");
  it("枠があるうちは枠から出る。枠の後はエージェントの費用も usage で数える", () => {
    expect(sec).toMatch(/枠があるうちは[^\n]*枠から出/u);
    expect(sec).toMatch(/枠の後[^\n]*エージェント[^\n]*`usage`/u);
  });
  it("止める線の金額（10,000 円で読み取りを止める。8,000 円で進捗の読み取りと下書き。通知は 3,000 円）", () => {
    expect(sec).toContain("月 10,000 円で読み取りを止める");
    expect(sec).toContain("8,000 円で進捗の読み取りと下書きを止める");
    expect(sec).toContain("予算の通知は 3,000 円");
  });
  it("費用の記録へのリンクがある", () => {
    expect(sec).toContain("(docs/cost.md)");
  });
});

describe("README: 段階の校正の記録へのリンク", () => {
  it("docs/level-calibration.md", () => {
    expect(readme).toContain("(docs/level-calibration.md)");
  });
});

describe("README: 外部のデータと素材", () => {
  const sec = section("外部のデータと素材");
  const rows = sec
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-/u.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/gu, "").split("|").map((c) => c.trim()));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const row = (part: string) => body.find((r) => r[0]!.includes(part)) ?? body.find((r) => r[4]!.includes(part));

  it("列は 名前、出所、利用条件、加工、置き場所", () => {
    expect(header).toEqual(["名前", "出所", "利用条件", "加工", "置き場所"]);
  });
  it("どの行も、5 つの欄が空でない。1 行に 1 つ", () => {
    for (const r of body) {
      expect(r, r[0]).toHaveLength(5);
      for (const c of r) expect(c.trim(), r[0]).not.toBe("");
    }
  });
  it.each([
    "N03",
    "地理院タイル",
    "農林水産省",
    "環境省",
    "厚生労働省",
    "都道府県",
    "法令",
    "data/history/",
    "sample-farm.json",
    "docs.json",
    "backstage.json",
    "evals/fabricated/",
    "evals/answers/",
    "画像",
  ])("%s の行がある", (part) => {
    expect(row(part), part).toBeDefined();
  });

  it("N03: CC BY 4.0、加工の表示、手続きの要否は確認できていない（不要と確認したとは書かない）", () => {
    const r = row("N03")!;
    expect(r[2]).toContain("CC BY 4.0");
    expect(r[3]).toContain("簡略化");
    expect(sec).toContain("国土数値情報");
    expect(readme).toMatch(/手続きの要否は確認できていません/u);
    expect(readme).toContain("(docs/data-sources.md)");
  });
  it("N03 について『不要』の確認を書かない（README 全体）", () => {
    expect(readme).not.toMatch(/(不要と確認|手続きは不要|申請不要)/u);
    expect(readme).not.toMatch(/手続き.{0,6}不要/u);
  });
  it("画面の出典の文（MAP_ATTRIBUTION）と、README の文が一致する。N03 は加工の表示を含む", () => {
    const n03 = plain(MAP_ATTRIBUTION[2]!);
    expect(readme).toContain(n03);
    for (const w of ["形の簡略化", "政令市の区の統合", "隣り合いの計算"]) expect(n03, w).toContain(w);
    expect(n03).toContain("国土交通省 国土数値情報");
    expect(readme).toContain(plain(MAP_ATTRIBUTION[0]!));
    expect(readme).toContain(MAP_ATTRIBUTION[1]!);
    const doc = fs.readFileSync(path.join(ROOT, "docs", "data-sources.md"), "utf8");
    expect(doc).toContain(n03);
  });
  it("地理院タイル: 出所の明示（Vector Map Level 0）と、画像を保存しないこと", () => {
    const r = row("地理院タイル")!;
    expect(readme).toContain("Vector Map Level 0");
    expect(r.join(" ")).toMatch(/保存しません|同梱しません/u);
  });
  it("国の機関は、確かめた利用条件と確かめた日を書く", () => {
    for (const part of ["農林水産省", "環境省", "厚生労働省"]) {
      const r = row(part)!;
      expect(r[2], part).toContain("公共データ利用規約");
      expect(r[2], part).toMatch(/確かめた日 \d{4}-\d{2}-\d{2}/u);
    }
  });
  it("都道府県と e-Gov のサイトの条件は、確かめていなければ未確認と書く（推測で書かない）", () => {
    expect(row("都道府県")![2]).toContain("未確認");
    expect(row("法令")![2]).toContain("未確認");
  });
  it("法令の条文の扱い（著作権法の第 13 条）を書く", () => {
    expect(row("法令")!.join(" ")).toContain("著作権法");
  });
  it("架空の見本の農場と作り物のデータを、作り物と明記する", () => {
    expect(row("sample-farm.json")!.join(" ")).toContain("架空");
    expect(row("evals/fabricated/")!.join(" ")).toContain("作り物");
    expect(row("backstage.json")!.join(" ")).toMatch(/作り物|未計測|未実測/u);
  });
  it("同梱の画像は環境省の経路図だけで、フォントはない。端末の字体だけを使う", () => {
    const r = row("画像")!;
    expect(r.join(" ")).toContain("環境省の経路図");
    expect(r.join(" ")).toMatch(/ありません/u);
    expect(r.join(" ")).toContain("端末の字体");
  });
  it("環境省の経路図: 出典の URL、改変なし、置き場所。個別の追跡の図は載せない", () => {
    const r = row("渡り鳥の飛来経路について")!;
    expect(r[1]).toContain("wataridori_hiraikeiro.html");
    expect(r[2]).toContain("PDL1.0");
    expect(r[2]).toContain("未確認");
    expect(r[3]).toMatch(/改変していません/u);
    expect(r[3]).toContain("無断転用不可");
    expect(r[4]).toContain("`data/migration/routes/`");
  });
  it("元データを入れないという文に、経路図の例外がある", () => {
    expect(sec).toMatch(/元データは公開リポジトリに入れません。例外は環境省の経路図 5 枚/u);
  });
  it("置き場所に書いたパスが実在する", () => {
    for (const r of body) {
      for (const m of r[4]!.matchAll(/`([^`]+)`/gu)) {
        const p = m[1]!;
        if (!/^(data|evals|shared|web|docs|scripts|functions)\//u.test(p)) continue;
        expect(fs.existsSync(path.join(ROOT, p)), `${r[0]}: ${p}`).toBe(true);
      }
    }
  });
});

describe("README: 年の併記", () => {
  it("『去年 12 月』の書き方をしない（2025 年 12 月と書く）", () => {
    expect(readme).not.toMatch(/去年 12 月/u);
    expect(readme).toContain("2025 年 12 月");
  });
});

describe("README: 書いてはいけないもの", () => {
  it("禁句と過去の発生の NG の語がない", () => {
    expect(findWordingViolations(readme)).toEqual([]);
  });
  it("効果の数字（削減、短縮、N 倍）がない", () => {
    expect(readme).not.toMatch(/削減|短縮/u);
    expect(readme).not.toMatch(/\d+(?:\.\d+)?\s*倍/u);
    expect(readme).not.toMatch(/倍速|倍近く/u);
  });
  it("内部の言葉（タスク番号、本体、部下、索引、契約、人の作業、Step）がない", () => {
    expect(readme).not.toMatch(/\b[A-Z]-\d{2}\b/u);
    expect(readme).not.toMatch(/本体|部下|索引|契約|人の作業|\bQ\d{1,2}\b|\bStep\b|§/u);
  });
  it("電話番号の形（0 で始まる数字-数字-数字）がない", () => {
    expect(readme).not.toMatch(/0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}/u);
  });
  it("メールアドレスと鍵の形がない", () => {
    expect(readme).not.toMatch(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u);
    expect(readme).not.toMatch(new RegExp("sk-" + "ant-" + "|AIza[0-9A-Za-z_-]{35}|BEGIN [A-Z ]*PRIVATE KEY", "u"));
  });
});

describe("README: リンク", () => {
  const links = [...readme.matchAll(/\]\(([^)\s]+)\)/gu)].map((m) => m[1]!);
  it("リンクがある（空の走査で通らない）", () => {
    expect(links.length).toBeGreaterThan(10);
  });
  it("相対のリンクの先がすべて実在する", () => {
    for (const l of links) {
      if (/^(https?:|mailto:|#)/u.test(l)) continue;
      const p = decodeURIComponent(l.split("#")[0]!);
      expect(fs.existsSync(path.join(ROOT, p)), l).toBe(true);
    }
  });
  it("公開しないものを指さない", () => {
    for (const l of links) {
      expect(l, l).not.toMatch(/^(\.\/)?(private\/|HANDOFF\.md|CLAUDE\.local\.md|data\/private\/|\.superpowers\/|\.env)/u);
      expect(l, l).not.toContain("participant-guide-themes-and-judging");
    }
  });
  // 2026-11-08: 冒頭に節を足したので、審査員の 2 本目の URL（/sample）を書かないことを README 全体で確かめる
  it("審査員の 2 本目の URL（/sample）を、README のどこにも書かない", () => {
    expect(readme).not.toMatch(/web\.app\/sample|\]\(\/sample|`\/sample/u);
    for (const l of links) expect(l, l).not.toMatch(/^\/sample|\/sample(\/|$|\?|#)/u);
  });
  it("外部のリンクは https", () => {
    for (const l of links) if (/^http:/u.test(l)) throw new Error(`http のリンク: ${l}`);
  });
  it("README が指す docs の文書（台本と提出の確認表）がある", () => {
    for (const f of ["docs/demo-script.md", "docs/submission-checklist.md"]) {
      expect(readme, f).toContain(f);
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    }
  });
});
