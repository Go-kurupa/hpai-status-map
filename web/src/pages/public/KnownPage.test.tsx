import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import KnownPage, { KnownView } from "./KnownPage";
import { KNOWN_FINDINGS, PAST_BASIS, type KnownFinding } from "./knownFindings";

// 「分かっていること」（§11）。研究の知見を、決まり（公式の文）と分けて示す固定のページ。AI は答えない。
// 文の元は、原本（論文の DOI、国の文書）で確かめた日（verifiedOn）を持つ。確かめていない行は画面に出さない。

const FORBIDDEN = /また発生しやすい|この町も危ない|隣町からうつる|危険地帯|ホットスポット|感染確率|[8８]\s*割/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// 公開前の検査（.claude/hooks/public-precommit.sh）の電話番号の形。DOI や URL の数字がこれに当たると止まる
const PHONE_LIKE = /0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}/;

function byId(id: string): KnownFinding {
  const f = KNOWN_FINDINGS.find((x) => x.id === id);
  if (!f) throw new Error(`no finding: ${id}`);
  return f;
}
function whole(f: KnownFinding): string {
  return strings(f).join("\n");
}

function show(node = <KnownPage />) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** "2026-11-04" → "2026 年 11 月 4 日"（PosterPage、CaseListSheet と同じ書き方） */
function toJa(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(y)} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

function strings(f: KnownFinding): string[] {
  return [f.heading, f.text, f.region, f.period, f.certaintyNote ?? "", ...f.limit.split("\n"), ...f.sources.map((s) => s.title)];
}

afterEach(cleanup);

describe("KNOWN_FINDINGS（データ）", () => {
  it("設計書 §11 の 7 行が、決まった順で並ぶ", () => {
    expect(KNOWN_FINDINGS.map((f) => f.id)).toEqual([
      "recurrence",
      "basic-management",
      "water-and-flock-size",
      "small-flock",
      "changing-shoes",
      "standard-measures",
      "neighbor-cases",
    ]);
  });

  it("どの行も、文・地域・時期・確からしさ・限界・出典がそろう", () => {
    for (const f of KNOWN_FINDINGS) {
      expect(f.text.length, f.id).toBeGreaterThan(20);
      expect(f.region.length, f.id).toBeGreaterThan(0);
      expect(f.period.length, f.id).toBeGreaterThan(0);
      expect(["高い", "中くらい", "低い"], f.id).toContain(f.certainty);
      expect(f.limit.length, f.id).toBeGreaterThan(20);
      expect(f.sources.length, f.id).toBeGreaterThan(0);
      for (const s of f.sources) {
        expect(s.title.length, f.id).toBeGreaterThan(0);
        expect(s.url, f.id).toMatch(/^https:\/\//);
      }
      if (f.verifiedOn !== null) expect(f.verifiedOn, f.id).toMatch(ISO_DATE);
    }
  });

  it("文にも出典名にも、禁止語がない（『また発生しやすい』などの予測や、安全・安心）", () => {
    for (const f of KNOWN_FINDINGS) {
      for (const s of strings(f)) {
        expect(s, `${f.id}: ${s}`).not.toMatch(FORBIDDEN);
        expect(findForbiddenPhrases(s), `${f.id}: ${s}`).toEqual([]);
      }
    }
  });

  it("基準の対策の行に『実施を勧めないという意味ではありません』がある", () => {
    const row = KNOWN_FINDINGS.find((f) => f.id === "standard-measures");
    expect(row?.text).toContain("実施を勧めないという意味ではありません");
  });

  it("効果の大きさを示す数字（何割減る、何倍）を、対策の行に書いていない", () => {
    const row = KNOWN_FINDINGS.find((f) => f.id === "standard-measures");
    for (const s of row ? strings(row) : []) expect(s).not.toMatch(/[0-9０-９]\s*(割|倍)/u);
    // 割合の % は、金網の設置の割合の 1 行だけ（効果の大きさではなく、調査の数）
    for (const line of row ? strings(row) : []) if (/[%％]/u.test(line)) expect(line).toContain("金網");
  });

  it("どの行にも短い見出しがあり、見出しは重ならない", () => {
    const heads = KNOWN_FINDINGS.map((f) => f.heading);
    for (const h of heads) {
      expect(h.length).toBeGreaterThan(3);
      expect(h.length).toBeLessThanOrEqual(30);
    }
    expect(new Set(heads).size).toBe(heads.length);
  });

  it("出典の URL にも文にも、電話番号の形（公開前の検査が止める形）がない", () => {
    for (const f of KNOWN_FINDINGS) {
      for (const s of f.sources) expect(s.url, `${f.id}: ${s.url}`).not.toMatch(PHONE_LIKE);
      for (const s of strings(f)) expect(s, `${f.id}: ${s}`).not.toMatch(PHONE_LIKE);
    }
    expect(PAST_BASIS.sourceUrl).not.toMatch(PHONE_LIKE);
  });

  it("説明のない語（対照の農場、暴露、示唆）を使っていない", () => {
    for (const f of KNOWN_FINDINGS) {
      for (const s of strings(f)) expect(s, `${f.id}: ${s}`).not.toMatch(/対照|暴露|示唆/u);
    }
  });

  it("基準の対策: 調査の項目ごとに、分かることだけを書く（ねずみ対策の農場数、金網、消石灰は調査の項目にない）", () => {
    const f = byId("standard-measures");
    const all = whole(f);
    const rat = f.limit.split("\n").find((l) => l.startsWith("ねずみ対策"));
    expect(rat).toContain("発生した農場の鶏舎 58 棟のうち 52 棟");
    expect(rat).toContain("比較の農場の鶏舎 26 棟のうち 24 棟");
    expect(rat).toMatch(/この項目では差は分かりません/u);
    const mesh = f.limit.split("\n").find((l) => l.includes("金網"));
    expect(mesh).toContain("発生した農場の鶏舎で 71%（58 棟中 41 棟）");
    expect(mesh).toContain("比較の農場で 85%（26 棟中 22 棟）");
    expect(mesh).toContain("差ははっきりしません");
    expect(mesh).not.toContain("傾向");
    expect(all).toMatch(/消石灰は、この調査の項目にありません/u);
    // 調査が見ていない対策について、調査の結果を言っていない
    expect(all).not.toMatch(/比べられませんでした/u);
    expect(f.text).toContain("実施を勧めないという意味ではありません");
  });

  it("近くの農場の続発: 海外の型と鳥の種類、距離の幅を原本のとおりに書き、鶏にそのまま当てはまる決まりに見せない", () => {
    const f = byId("neighbor-cases");
    const all = whole(f);
    expect(all).toContain("H7N7");
    expect(all).toContain("H5N8");
    expect(all).toMatch(/アヒル/u);
    expect(all).toContain("25 km");
    expect(all).toContain("10.5 km");
    expect(all).toContain("27.8 km");
    expect(all).toMatch(/鶏の農場にそのまま当てはまるとは限りません/u);
    expect(all).toMatch(/基準ではありません/u);
    expect(all).toContain("先の農場から感染した可能性も否定できない");
    expect(all).not.toContain("両方が考えられる");
    // 日本の今季の型（報告書: 家きんの発生はすべて H5N1）との違いを書く
    expect(all).toMatch(/2025\/26 シーズンの発生はすべて H5N1/u);
    // 報告書の言い方に近づける
    expect(all).toContain("相次いで野鳥などに由来するウイルスに触れた可能性");
    expect(all).not.toContain("別々に触れた");
    const guinat = f.sources.find((s) => s.title.includes("Guinat"));
    expect(guinat?.title).toContain("Poultry farm density and proximity drive highly pathogenic avian influenza spread");
  });

  it("国内の続発: 報告書の 3 組（同じ道県内、1 か月以内、11 km 以内、同じ遺伝子型）を 3 組として書く", () => {
    const f = byId("neighbor-cases");
    const lines = f.text.split("\n");
    expect(lines).toHaveLength(2); // 国内と海外で段落を分ける
    const [domestic, overseas] = lines as [string, string];
    expect(domestic).toMatch(/3 組/u);
    for (const pair of ["新潟県の 3・4 例目", "千葉県の 18・19 例目", "北海道の 21・22 例目"]) expect(domestic).toContain(pair);
    expect(domestic).toContain("1 か月以内");
    expect(domestic).toContain("11 km 以内");
    expect(domestic).toContain("同じ遺伝子型");
    expect(domestic).not.toMatch(/オランダ|フランス/u);
    expect(overseas).toMatch(/オランダ/u);
    expect(overseas).toMatch(/フランス/u);
    expect(overseas).not.toMatch(/新潟|千葉|北海道/u);
    // 3 組のうち 1 組だけを挙げる書き方（安心する側に傾く）をしない
    expect(whole(f)).not.toMatch(/1 組/u);
    const pairs = f.limit.split("\n").filter((l) => l.startsWith("この 3 組"));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toContain("農場間の伝播の可能性は否定できない");
    expect(pairs[0]).toContain("野生の哺乳類から別々に入った可能性");
    expect(pairs[0]).toContain("明らかではない");
    // 新潟の組（先の農場から否定できない）と千葉の組（直接の感染源とは考えにくい）を、組ごとに書く
    const detail = f.limit.split("\n").find((l) => l.startsWith("新潟県の組"));
    expect(detail).toContain("先の農場から感染した可能性も否定できない");
    expect(detail).toContain("千葉県の組");
    expect(detail).toContain("直接の感染源になったとは考えにくい");
  });

  it("羽数の下限: 1,000 羽未満を調べていないのは Yamaguchi 2025。Yamaguchi 2024 の下限は確かめていないと分けて書く", () => {
    for (const id of ["water-and-flock-size", "small-flock"]) {
      const line = byId(id).limit.split("\n").find((l) => l.includes("1,000 羽未満の農場は調べていません"));
      expect(line, id).toBeDefined();
      expect(line, id).toContain("Yamaguchi 2025");
      expect(line, id).not.toContain("Yamaguchi 2024");
    }
    const l24 = byId("water-and-flock-size").limit.split("\n").find((l) => l.includes("Yamaguchi 2024"));
    expect(l24).toContain("要旨");
    expect(l24).toContain("下限の羽数は、確かめられていません");
    expect(l24).not.toContain("1,000 羽未満の農場は調べていません");
    expect(byId("small-flock").limit).toMatch(/数羽から数百羽[^。]*別の規模/u);
  });

  it("基本の管理: 少数の徹底した農場の話であることと、確からしさの及ぶ範囲を書く", () => {
    const f = byId("basic-management");
    expect(f.text).toContain("少数");
    expect(f.certaintyNote ?? "").toMatch(/24/u);
  });

  it("靴と対策の調査の限界: 比較の農場は聞き取りで、時期も違う。韓国の調査は要旨で確かめた", () => {
    expect(byId("changing-shoes").limit).toMatch(/聞き取り[^。]*数か月後/u);
    expect(byId("changing-shoes").limit).toContain("要旨");
    expect(whole(byId("water-and-flock-size"))).toContain("要旨");
  });

  it("見出しは本文と限界の欄と食い違わない形（羽数、靴）", () => {
    expect(byId("small-flock").heading).toBe("約 6,000 羽の農場でも発生している");
    expect(byId("changing-shoes").heading).toBe("靴の履き替えは、発生しなかった農場に多い");
  });

  it("確からしさが『低い』の行には、何についての評価かの補足がある", () => {
    for (const f of KNOWN_FINDINGS) {
      if (f.certainty === "低い") expect(f.certaintyNote, f.id).not.toBeNull();
    }
  });

  it("PAST_BASIS は国の報告書の一文で、出典は農林水産省", () => {
    expect(PAST_BASIS.text).toContain("地域としての感染予防対策");
    expect(new URL(PAST_BASIS.sourceUrl).hostname).toBe("www.maff.go.jp");
    expect(PAST_BASIS.sourceTitle).toContain("疫学調査報告書");
    if (PAST_BASIS.verifiedOn !== null) expect(PAST_BASIS.verifiedOn).toMatch(ISO_DATE);
    expect(PAST_BASIS.text).not.toMatch(FORBIDDEN);
    expect(findForbiddenPhrases(PAST_BASIS.text)).toEqual([]);
  });
});

describe("KNOWN_FINDINGS（画面のための欄）", () => {
  const ROUTES = ["/", "/compare", "/trends", "/todo", "/explore", "/public#small_flock"];

  it("図の数は、本文か限界に書かれた数と同じ（新しい数を作らない）", () => {
    for (const f of KNOWN_FINDINGS) {
      if (f.figure === null) continue;
      const all = whole(f);
      if (f.figure.kind === "share") {
        expect(all, f.id).toContain(`${f.figure.whole} 事例`);
        expect(all, f.id).toContain(`${f.figure.part} 事例`);
      } else {
        // 別の数の一部（126 の 26 など）に当たらないよう、数の前後が数字でないことを確かめる
        for (const g of f.figure.groups) for (const b of g.bars) expect(all, `${f.id} ${b.label}`).toMatch(new RegExp(`(?<![\\d,])${b.count}(?![\\d,])`, "u"));
      }
    }
  });

  it("図にするのは、再発・約 6,000 羽・靴の 3 行だけ（差がはっきりしない割合や距離は図にしない）", () => {
    expect(KNOWN_FINDINGS.filter((f) => f.figure !== null).map((f) => f.id)).toEqual(["recurrence", "small-flock", "changing-shoes"]);
  });

  it("関係する画面のリンク先は、作品にある画面だけ", () => {
    for (const f of KNOWN_FINDINGS) for (const r of f.related) expect(ROUTES, `${f.id} ${r.to}`).toContain(r.to);
  });

  it("限界の要の行の位置は、限界の中にある。基準の対策は『効果がないという意味ではありません』の行", () => {
    for (const f of KNOWN_FINDINGS) expect(f.limit.split("\n")[f.leadLimit], f.id).toBeTruthy();
    expect(byId("standard-measures").limit.split("\n")[byId("standard-measures").leadLimit]).toContain("効果がないという意味ではありません");
  });

  it("評価の対象の語、図の説明、リンクの名前にも、禁止語がない", () => {
    for (const f of KNOWN_FINDINGS) {
      const extra = [f.scope, ...f.related.map((r) => r.label)];
      if (f.figure?.kind === "share") extra.push(f.figure.caption);
      if (f.figure?.kind === "groups") extra.push(f.figure.caption, ...f.figure.groups.map((g) => g.name));
      for (const t of extra) {
        expect(t, f.id).not.toMatch(FORBIDDEN);
        expect(findForbiddenPhrases(t), f.id).toEqual([]);
      }
    }
  });
});

describe("KnownPage（画面）", () => {
  it("入力欄がなく、『研究の知見です。決まりではありません』がある", () => {
    const { container } = show();
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "分かっていること" })).toBeTruthy();
    expect(document.body.textContent).toContain("研究の知見です。決まりではありません");
    expect(document.body.textContent).toContain("質問に答える機能はありません");
  });

  it("公式の文の見た目（GuidanceSection、引用ブロック）を使わない", () => {
    const { container } = show();
    expect(container.querySelectorAll("[data-role='official'], blockquote, section.guidance")).toHaveLength(0);
    const src = readFileSync(path.resolve(import.meta.dirname, "KnownPage.tsx"), "utf8");
    expect(src).not.toMatch(/import[^;]*GuidanceSection/u);
    expect(src).not.toMatch(/<GuidanceSection/u);
  });

  it("確かめた行だけが出て、行ごとに地域・時期・確からしさ・限界・出典・確認日がある", () => {
    const { container } = show();
    const shown = KNOWN_FINDINGS.filter((f) => f.verifiedOn !== null);
    const items = [...container.querySelectorAll("[data-role='finding']")] as HTMLElement[];
    expect(items.map((el) => el.getAttribute("data-id"))).toEqual(shown.map((f) => f.id));
    shown.forEach((f, i) => {
      const el = items[i] as HTMLElement;
      for (const para of f.text.split("\n")) expect(el.textContent, f.id).toContain(para);
      expect(el.textContent, f.id).toContain(f.region);
      expect(el.textContent, f.id).toContain(f.period);
      expect(el.textContent, f.id).toContain(`確からしさ: ${f.certainty}`);
      for (const line of f.limit.split("\n")) expect(el.textContent, f.id).toContain(line);
      expect(el.textContent, f.id).toContain(`確認日 ${toJa(f.verifiedOn as string)}`);
      for (const s of f.sources) {
        const a = within(el).getByRole("link", { name: s.title });
        expect(a.getAttribute("href")).toBe(s.url);
        expect(a.getAttribute("rel")).toContain("noopener");
      }
    });
  });

  it("verifiedOn が null の行は出さない（文も出典も）", () => {
    const base = KNOWN_FINDINGS[0] as KnownFinding;
    const second = KNOWN_FINDINGS[1] as KnownFinding;
    const hidden: KnownFinding = { ...base, id: "hidden-row", text: "この文は確かめていないので出ない。".repeat(2), verifiedOn: null };
    const { container } = show(<KnownView findings={[hidden, { ...second, verifiedOn: "2026-11-04" }]} />);
    const items = [...container.querySelectorAll("[data-role='finding']")];
    expect(items.map((el) => el.getAttribute("data-id"))).toEqual([second.id]);
    expect(document.body.textContent).not.toContain("この文は確かめていない");
  });

  it("確かめた行が 1 つもないときは、準備中と示し、空の一覧を出さない", () => {
    const base = KNOWN_FINDINGS[0] as KnownFinding;
    const { container } = show(<KnownView findings={[{ ...base, verifiedOn: null }]} />);
    expect(container.querySelectorAll("[data-role='finding']")).toHaveLength(0);
    expect(container.querySelectorAll("ol, ul li")).toHaveLength(0);
    expect(document.body.textContent).toContain("確かめが終わった文から");
  });

  it("補足（certaintyNote）のある行は、その補足が画面に出る", () => {
    const { container } = show();
    for (const el of container.querySelectorAll("[data-role='finding']")) {
      const f = KNOWN_FINDINGS.find((x) => x.id === el.getAttribute("data-id")) as KnownFinding;
      if (f.certaintyNote !== null) expect(el.textContent, f.id).toContain(f.certaintyNote);
    }
  });

  it("ページ全体に、禁止語（予測の言い方、安全・安心）がない", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(findForbiddenPhrases(text)).toEqual([]);
  });

  it("鶏を飼っていない方へ（/public）と、地図へのリンクがある", () => {
    show();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/public");
    expect(hrefs).toContain("/");
  });
  it("各行の先頭に見出し（h2）があり、ページの先頭の目次から、行の id へ移れる", () => {
    const { container } = show();
    const shown = KNOWN_FINDINGS.filter((f) => f.verifiedOn !== null);
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(shown.map((f) => `#${f.id}`));
    expect(links.map((a) => a.textContent)).toEqual(shown.map((f) => f.heading));
    for (const f of shown) {
      const li = container.querySelector(`li#${f.id}`) as HTMLElement;
      expect(li, f.id).not.toBeNull();
      const h = li.firstElementChild as HTMLElement;
      expect(h.tagName).toBe("H2");
      expect(h.textContent).toBe(f.heading);
    }
  });

  it("もくじは見出しの次にあり、最初の段落より前。行は全部 DOM にあり、畳まれていない", () => {
    const { container } = show();
    const shown = KNOWN_FINDINGS.filter((f) => f.verifiedOn !== null);
    const h1 = container.querySelector("h1") as HTMLElement;
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    expect(h1.nextElementSibling).toBe(nav);
    const firstP = container.querySelector(".public-page > p") as HTMLElement;
    expect(nav.compareDocumentPosition(firstP) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const f of shown) {
      const li = container.querySelector(`li#${f.id}`) as HTMLElement;
      expect(li, f.id).not.toBeNull();
      expect(li.closest("details"), f.id).toBeNull();
    }
  });

  it("0 件のときは、もくじを出さず『いまは準備中です』を出す", () => {
    const { container } = show(<KnownView findings={[]} />);
    expect(screen.queryByRole("navigation", { name: "もくじ" })).toBeNull();
    expect(container.textContent).toContain("いまは準備中です");
  });

  it("もくじのリンクの高さは var(--tap)（public.css）", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "public.css"), "utf8");
    const rule = /\.guidance-toc a\s*\{([^}]*)\}/u.exec(css);
    expect(rule?.[1]).toMatch(/min-height:\s*var\(--tap\)/u);
  });

  it("限界は、複数の点があるとき箇条書きで出る。要の 1 行は畳まず先頭に、残りは畳んだ中に元の順で出る", () => {
    const { container } = show();
    for (const f of KNOWN_FINDINGS) {
      const lines = f.limit.split("\n");
      const lead = lines[f.leadLimit] as string;
      const li = container.querySelector(`li#${f.id}`) as HTMLElement;
      const items = [...li.querySelectorAll(".known-limit li")].map((x) => x.textContent);
      expect(items, f.id).toEqual([lead, ...lines.filter((_, i) => i !== f.leadLimit)]);
      const first = li.querySelector(".known-limit li") as HTMLElement;
      expect(first.closest("details"), f.id).toBeNull();
      const more = li.querySelector("details.known-more") as HTMLDetailsElement;
      expect(more.open, f.id).toBe(false);
      expect(more.querySelector("summary")?.textContent, f.id).toBe(`ほかの限界（${lines.length - 1} 項目）`);
    }
  });

  it("出典、確認日、確からしさの補足は畳んだ中に入れない", () => {
    const { container } = show();
    for (const el of container.querySelectorAll("[data-role='finding']")) {
      const more = el.querySelector("details.known-more") as HTMLElement;
      expect(more.textContent).not.toContain("出典");
      expect(more.textContent).not.toContain("確認日");
      expect(el.querySelector(".source-line")?.closest("details")).toBeNull();
    }
  });

  it("/known#id で来たときは、その行の畳んだ限界が開いている（ほかの行は閉じたまま）", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/known#neighbor-cases"]}>
        <KnownPage />
      </MemoryRouter>,
    );
    const open = (id: string) => (container.querySelector(`li#${id} details.known-more`) as HTMLDetailsElement).open;
    expect(open("neighbor-cases")).toBe(true);
    expect(open("recurrence")).toBe(false);
  });

  it("印刷の前に、畳んだ限界がすべて開く", () => {
    const { container } = show();
    window.dispatchEvent(new Event("beforeprint"));
    for (const d of container.querySelectorAll("details.known-more")) expect((d as HTMLDetailsElement).open).toBe(true);
  });

  it("もくじの表は、確からしさの隣に、何についての評価かを同じ行に出す（「低い＝効かない」と読ませない）", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const rows = within(nav).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(KNOWN_FINDINGS.length);
    KNOWN_FINDINGS.forEach((f, i) => {
      const row = rows[i] as HTMLElement;
      expect(row.textContent, f.id).toContain(f.certainty);
      expect(row.textContent, f.id).toContain(`評価の対象: ${f.scope}`);
    });
  });

  it("読む方ごとの入口は 3 つで、アンカーで知見へ移る（知見を隠さない）", () => {
    const { container } = show();
    const groups = [...container.querySelectorAll(".known-audiences li[data-audience]")];
    expect(groups.map((g) => g.getAttribute("data-audience"))).toEqual(["farm", "small", "neighbor"]);
    for (const g of groups) {
      const a = g.getAttribute("data-audience") as string;
      const hrefs = [...g.querySelectorAll("a")].map((x) => x.getAttribute("href"));
      expect(hrefs).toEqual(KNOWN_FINDINGS.filter((f) => (f.audiences as readonly string[]).includes(a)).map((f) => `#${f.id}`));
    }
    expect(container.querySelectorAll("[data-role='finding']")).toHaveLength(KNOWN_FINDINGS.length);
  });

  it("国の報告書の一文（PAST_BASIS）を、原文のまま出典と確認日つきで、知見のカードの外に出す", () => {
    const { container } = show();
    const box = container.querySelector("[data-role='past-basis']") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.textContent).toContain(`「${PAST_BASIS.text}」`);
    expect(box.textContent).toContain("研究の知見とは別です");
    expect(box.textContent).toContain(`確認日 ${toJa(PAST_BASIS.verifiedOn as string)}`);
    expect(within(box).getByRole("link", { name: PAST_BASIS.sourceTitle }).getAttribute("href")).toBe(PAST_BASIS.sourceUrl);
    expect(box.closest("[data-role='finding']")).toBeNull();
    expect(box.querySelector("blockquote")).toBeNull();
  });

  it("関係する画面のリンクが、各行の中に出る", () => {
    const { container } = show();
    for (const f of KNOWN_FINDINGS) {
      const li = container.querySelector(`li#${f.id}`) as HTMLElement;
      const hrefs = [...li.querySelectorAll(".known-related a")].map((a) => a.getAttribute("href"));
      expect(hrefs, f.id).toEqual(f.related.map((r) => r.to));
    }
  });

  it("図: ます目は分母の数だけあり、塗ったます目の数と文字の数が合う", () => {
    const { container } = show();
    for (const f of KNOWN_FINDINGS) {
      const fig = container.querySelector(`li#${f.id} .known-figure`);
      if (f.figure === null) {
        expect(fig, f.id).toBeNull();
        continue;
      }
      expect(fig, f.id).not.toBeNull();
      if (f.figure.kind === "share") {
        expect(fig?.querySelectorAll(".known-share span")).toHaveLength(f.figure.whole);
        expect(fig?.querySelectorAll(".known-share .on")).toHaveLength(f.figure.part);
        expect(fig?.textContent).toContain(`${f.figure.part} / ${f.figure.whole} 事例`);
      } else {
        for (const g of f.figure.groups) for (const b of g.bars) expect(fig?.textContent).toContain(`${b.label}${b.count}`);
      }
    }
  });

  it("決まりは e-Gov の基準へ案内し、『鶏を飼っていない方へ』を農場の決まりの案内先にしていない", () => {
    show();
    const gov = document.querySelector("a[data-role='law-link']");
    expect(gov?.getAttribute("href")).toBe("https://laws.e-gov.go.jp/law/326M50010000035");
    expect(gov?.textContent).toContain("飼養衛生管理基準");
    expect(document.body.textContent).not.toMatch(/農場に求められている決まり[^。]*鶏を飼っていない方へ/u);
  });

  it("確認日は『2026 年 11 月 4 日』の形で出る", () => {
    show();
    expect(document.body.textContent).toContain("確認日 2026 年 11 月 4 日");
  });

  it("スマホの幅を削らない: 一覧の左の余白は 0（known-list）", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "public.css"), "utf8");
    const block = /\.known-list\s*\{([^}]*)\}/u.exec(css);
    expect(block, ".known-list の規則").not.toBeNull();
    expect(block?.[1]).toMatch(/padding(-left)?:\s*0/u);
    expect(block?.[1]).toMatch(/list-style:\s*none/u);
  });
});
