import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage, { PrivacyContent } from "./PrivacyPage";
import { PRIVACY_NOTICE, PRIVACY_REVIEWED_ON } from "./privacyNotice";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const HEADINGS = ["運営者", "集める情報", "目的", "保存場所", "消し方"];

// X-19 の要件。文の正は privacyNotice.ts だけ
const REQUIRED_PHRASES = [
  "約 1km のマス目",
  "正確な地点は端末からも送りません",
  "死亡数",
  "飼養羽数",
  "メールアドレス",
  "招待コード",
  "他の農場や運営者の画面からは見えません",
  "管理コンソールで見ません",
  "入力者を記録しません",
  "リンク 1 つで配信を止められます",
  "農場の全データを本人が消せます",
  "声かけ文の下書きのため、発生の公開の事実",
  "地図を表示するときに国土地理院のサーバーへ",
];

// レビュー指摘 1 回目で足した文（節ごと）
const REVIEW_R1_PHRASES: ReadonlyArray<{ heading: string; phrase: string }> = [
  { heading: "保存場所", phrase: "登録していない方が地図で地点を指定すると" },
  { heading: "保存場所", phrase: "この端末のブラウザの中に保存し、サーバーには送りません" },
  { heading: "保存場所", phrase: "ブラウザの設定で消せます" },
  { heading: "保存場所", phrase: "ログインを完了するために、メールアドレスをこの端末のブラウザにも保存します" },
  { heading: "目的", phrase: "自己点検、消毒の記録、家畜保健衛生所の連絡先" },
  { heading: "目的", phrase: "報告文の下書き" },
  { heading: "消し方", phrase: "同じ農場の会員なら、だれでも農場全体を消せます" },
  { heading: "消し方", phrase: "ログイン用のアカウント（メールアドレス）はこの操作では消えません" },
  { heading: "消し方", phrase: "送ったメールの控えは Gmail に残ります" },
  { heading: "消し方", phrase: "端末の中の保存は、その端末のブラウザの設定で消してください" },];

// N-6（X-23 のセキュリティ確認）: 運営者に見えるものと、メールの控えに残るものを、ありのままに書く
const N6_PHRASES: ReadonlyArray<{ heading: string; phrase: string }> = [
  { heading: "保存場所", phrase: "基準の知らせが 1 日の上限で止まったときは、運営者の確認画面に日付つきの知らせが出ます" },
  { heading: "保存場所", phrase: "送ったメールの控えには、会員のアドレスと、死亡率が基準に当たる可能性があることが残ります" },
  { heading: "保存場所", phrase: "死亡数そのものは、運営者に見えません" },
];

// W-03 の申し送り: 『自分の町』として選んだ町を、端末のブラウザに保存する（src/data/spot.ts の TOWN_KEY。市町村コードの 5 桁だけ）
const TOWN_PHRASES: ReadonlyArray<{ heading: string; phrase: string }> = [
  { heading: "保存場所", phrase: "選んだ町は、市町村コード" },
  { heading: "保存場所", phrase: "市町村コード（5 桁の数字）だけ" },
  { heading: "保存場所", phrase: "hpai.town.v1" },
  { heading: "保存場所", phrase: "サーバーには送りません" },
];


function renderPage(ui = <PrivacyPage />) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function pageText(): string {
  return document.body.textContent ?? "";
}

describe("PRIVACY_NOTICE（文の正）", () => {
  it("見出しが 運営者、集める情報、目的、保存場所、消し方 の順にある", () => {
    expect(PRIVACY_NOTICE.map((s) => s.heading)).toEqual(HEADINGS);
  });

  it("各節に本文がある", () => {
    for (const s of PRIVACY_NOTICE) {
      expect(s.paragraphs.length, s.heading).toBeGreaterThan(0);
      for (const p of s.paragraphs) expect(p.trim().length, s.heading).toBeGreaterThan(0);
    }
  });

  it.each(REQUIRED_PHRASES)("文に『%s』がある", (phrase) => {
    const all = PRIVACY_NOTICE.flatMap((s) => s.paragraphs).join("\n");
    expect(all).toContain(phrase);
  });

  it.each(REVIEW_R1_PHRASES)("『$heading』の節に『$phrase』がある", ({ heading, phrase }) => {
    const section = PRIVACY_NOTICE.find((x) => x.heading === heading)!.paragraphs.join("\n");
    expect(section).toContain(phrase);
  });

  it.each(TOWN_PHRASES)("『$heading』の節に、選んだ町の保存の説明『$phrase』がある", ({ heading, phrase }) => {
    const section = PRIVACY_NOTICE.find((x) => x.heading === heading)!.paragraphs.join("\n");
    expect(section).toContain(phrase);
  });

  it.each(N6_PHRASES)("『$heading』の節に、運営者に見えるものとメールの控えの説明『$phrase』がある", ({ heading, phrase }) => {
    const section = PRIVACY_NOTICE.find((x) => x.heading === heading)!.paragraphs.join("\n");
    expect(section).toContain(phrase);
  });

  it("N-6 の文は画面にも出る", () => {
    renderPage();
    for (const { phrase } of N6_PHRASES) expect(pageText(), phrase).toContain(phrase);
  });

  it("Claude に渡すものを 2 つ書く: 声かけ文は公開の事実だけを自動で、近隣への説明文は本人が操作したときに入力した文を", () => {
    const place = PRIVACY_NOTICE.find((s) => s.heading === "保存場所")!.paragraphs.join("\n");
    for (const w of ["声かけ文", "自動", "都道府県、市町村、日付、段階", "会員の農場名、位置、記録は渡しません"]) {
      expect(place, w).toContain(w);
    }
    // 近隣への説明文（M-19）は実装した。本人が操作したときに、入力した文だけを渡す
    const neighbor = PRIVACY_NOTICE.find((s) => s.heading === "保存場所")!.paragraphs.find((p) => p.includes("近隣への説明文"));
    expect(neighbor).toBeDefined();
    for (const w of ["本人が操作したときに", "入力した文を Claude に渡します", "農場名、位置、記録、国の文は渡しません", "保存せず、ログにも残しません"]) {
      expect(neighbor, w).toContain(w);
    }
    // 近隣への説明文は自動では渡さない（自動と書いたのは声かけ文の段落だけ）
    expect(neighbor).not.toContain("自動");
  });

  it("近隣への説明文の入力は、画面にも出る", () => {
    renderPage();
    expect(pageText()).toContain("近隣への説明文の下書きでは、本人が操作したときに、入力した文を Claude に渡します");
  });

  it("相談の画面で書いた文（続けて聞くときは直前のやりとりも）を Claude に送ること、保存もログへの記録もしないことが、プライバシーの説明と画面に出る", () => {
    const line =
      "「AIに対策を相談」で書いた文は、答えを作るために Claude（Anthropic）に渡します。続けて聞くときは、同じ相談の直前のやりとり（問いと答え、3 往復まで）も渡します。農場名、位置、記録は渡しません。入力した文は、この作品のサーバーには保存せず、ログにも残しません。";
    expect(PRIVACY_NOTICE.find((s) => s.heading === "保存場所")!.paragraphs).toContain(line);
    renderPage();
    expect(pageText()).toContain(line);
  });

  it("これまでの相談は、この端末のブラウザの中にだけ保存し、サーバーに送らないことが出る", () => {
    const line =
      "会員の方のこれまでの相談（問いと答え）は、見返せるように、この端末のブラウザの中にだけ保存し、サーバーには送りません。相談の画面の「これまでの相談」や、ブラウザの設定で消せます。";
    expect(PRIVACY_NOTICE.find((s) => s.heading === "保存場所")!.paragraphs).toContain(line);
    renderPage();
    expect(pageText()).toContain(line);
  });

  it("AIに対策を相談で足した見直しの記録（カードの番号、足した日時、足した人）が、集める情報に出る", () => {
    const phrase = "「AIに対策を相談」で『対策項目に足す』を押した見直しの記録（カードの番号、足した日時、足した人）";
    expect(PRIVACY_NOTICE.find((s) => s.heading === "集める情報")!.paragraphs.join("")).toContain(phrase);
    renderPage();
    expect(pageText()).toContain(phrase);
  });

  it("選んだ町の保存の説明が、画面にも出る", () => {
    renderPage();
    expect(pageText()).toContain("hpai.town.v1");
  });

  it("保存場所の節に Firebase（Firestore、Authentication、asia-northeast1）と Gmail がある", () => {
    const place = PRIVACY_NOTICE.find((s) => s.heading === "保存場所")!.paragraphs.join("\n");
    for (const w of ["Firebase", "Firestore", "Authentication", "asia-northeast1", "Gmail"]) {
      expect(place, w).toContain(w);
    }
  });

  it("禁句がない", () => {
    const all = PRIVACY_NOTICE.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");
    expect(findForbiddenPhrases(all)).toEqual([]);
  });
});

describe("PrivacyPage", () => {
  it("題が『プライバシー』で、節の見出しが順に出る", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "プライバシー" })).toBeTruthy();
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(HEADINGS);
  });

  it("要件の語が画面に出る", () => {
    renderPage();
    for (const phrase of REQUIRED_PHRASES) expect(pageText(), phrase).toContain(phrase);
  });

  it("配信停止と全データの削除へのリンクが消し方の節にある", () => {
    renderPage();
    const section = screen.getByRole("heading", { level: 2, name: "消し方" }).closest("section")!;
    expect(within(section).getByRole("link", { name: /配信停止/ }).getAttribute("href")).toBe("/settings/notify");
    expect(within(section).getByRole("link", { name: /全データの削除/ }).getAttribute("href")).toBe("/record");
  });

  it("画面全体に禁句がない", () => {
    renderPage();
    expect(findForbiddenPhrases(pageText())).toEqual([]);
  });

  it("VITE_OPERATOR_NAME を運営者の節に出す", () => {
    vi.stubEnv("VITE_OPERATOR_NAME", "テスト用の運営者名");
    renderPage();
    const section = screen.getByRole("heading", { level: 2, name: "運営者" }).closest("section")!;
    expect(section.textContent).toContain("テスト用の運営者名");
  });

  it.each([
    ["未設定", ""],
    ["空白だけ", "   "],
  ])("VITE_OPERATOR_NAME が%sでも壊れず、運営者名が入っていないと分かる", (_label, value) => {
    vi.stubEnv("VITE_OPERATOR_NAME", value);
    renderPage();
    const section = screen.getByRole("heading", { level: 2, name: "運営者" }).closest("section")!;
    expect(section.textContent).toContain("運営者名は、まだ入っていません");
  });
});

describe("もくじと戻る道", () => {
  it("もくじのリンク数が節の数と同じで、href が各節の id を指す", () => {
    const { container } = renderPage();
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(PRIVACY_NOTICE.length);
    links.forEach((a, i) => {
      expect(a.textContent).toBe(PRIVACY_NOTICE[i]!.heading);
      const id = a.getAttribute("href")!.replace(/^#/, "");
      expect(id).not.toBe("");
      const section = container.querySelector(`section[id="${id}"]`);
      expect(section?.querySelector("h2")?.textContent).toBe(PRIVACY_NOTICE[i]!.heading);
    });
  });

  it("もくじは最初の h2 より前にある", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const h2 = screen.getAllByRole("heading", { level: 2 })[0]!;
    expect(nav.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("末尾に『地図にもどる』があり、href は /", () => {
    renderPage();
    const link = screen.getByRole("link", { name: "地図にもどる" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.className).toContain("tap-link");
  });

  it("消し方のリンク 2 本は tap-link", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /配信停止/ }).className).toContain("tap-link");
    expect(screen.getByRole("link", { name: /全データの削除/ }).className).toContain("tap-link");
  });

  it("privacy.css に幅、もくじ、スクロール余白の規則がある", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "privacy.css"), "utf8");
    expect(css).toMatch(/\.privacy\s*\{[^}]*max-width:\s*44rem/);
    expect(css).toMatch(/\.privacy-toc a\s*\{[^}]*min-height:\s*var\(--tap\)/);
    expect(css).toMatch(/\.privacy section\s*\{[^}]*scroll-margin-top:\s*8px/);
  });
});

describe("確認日", () => {
  it("PRIVACY_REVIEWED_ON が null なら『文面は確認中です』と『確認日はまだありません』を出す", () => {
    renderPage(<PrivacyContent reviewedOn={null} />);
    expect(pageText()).toContain("文面は確認中です");
    expect(pageText()).toContain("確認日はまだありません");
  });

  it("値があれば確認日を出し、『確認中です』は出さない", () => {
    renderPage(<PrivacyContent reviewedOn="2026-11-07" />);
    expect(pageText()).toContain("確認日 2026-11-07");
    expect(pageText()).not.toContain("文面は確認中です");
    expect(pageText()).not.toContain("確認日はまだありません");
  });

  it("既定の画面は PRIVACY_REVIEWED_ON の値に従う", () => {
    renderPage();
    if (PRIVACY_REVIEWED_ON === null) {
      expect(pageText()).toContain("文面は確認中です");
      expect(pageText()).toContain("確認日はまだありません");
    } else {
      expect(pageText()).toContain(`確認日 ${PRIVACY_REVIEWED_ON}`);
    }
  });
});

describe("ソース", () => {
  const dir = import.meta.dirname;
  const sources = ["privacyNotice.ts", "PrivacyPage.tsx"].map((f) => ({
    f,
    text: fs.readFileSync(path.join(dir, f), "utf8"),
  }));

  it("運営者名は VITE_OPERATOR_NAME からだけ読み、ソースに固有名の農場名がない", () => {
    for (const { f, text } of sources) {
      // 『○○農場』『○○養鶏場』『○○ファーム』のような固有名（『他の農場』のような一般の語は除く）
      expect(text, f).not.toMatch(/[一-龠ァ-ヶー]{2,}(農場|養鶏場|牧場|農園|ファーム)/);
    }
    expect(sources.find((s) => s.f === "PrivacyPage.tsx")!.text).toContain("VITE_OPERATOR_NAME");
  });

  it("ソースに禁句がない", () => {
    for (const { f, text } of sources) expect(findForbiddenPhrases(text), f).toEqual([]);
  });
});
