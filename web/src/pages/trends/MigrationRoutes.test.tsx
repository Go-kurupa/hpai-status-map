import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MigrationRoutes, { ROUTE_FIGURES } from "./MigrationRoutes";

afterEach(cleanup);

const SOURCE_URL = "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/ap_wr_transit/wataridori_hiraikeiro.html";
const TRACKING_URL = "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/migration_route.html";

const EXPECTED = [
  ["zu1.jpg", "図1．オナガガモの飛来経路", "秋の渡り開始9～10月頃"],
  ["zu2.jpg", "図2．マガモの飛来経路", "秋の渡り開始8月下旬～10月頃"],
  ["zu3.jpg", "図3．ヒドリガモの飛来経路", "秋の渡り開始9月～10月頃"],
  ["zu4.jpg", "図4．オオハクチョウの飛来経路", "秋の渡り開始9月下旬～10月頃"],
  ["zu5.png", "図5．ユリカモメの飛来経路", "秋の渡り開始８月～10月頃"],
] as const;

describe("渡りの経路図", () => {
  it("5 枚を、環境省のページの順と名前と注記で出す", () => {
    expect(ROUTE_FIGURES.map((f) => [f.file, f.name, f.autumnNote])).toEqual(EXPECTED);
  });

  it("どの図も、配信する自前の写しを読み、種の名前を alt に持ち、実寸の幅と高さがある", () => {
    render(<MigrationRoutes />);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(5);
    imgs.forEach((img, i) => {
      const f = ROUTE_FIGURES[i]!;
      expect(img.getAttribute("src")).toBe(`/migration/routes/${f.file}`);
      expect(img.getAttribute("alt")).toContain(f.species);
      expect(img.getAttribute("alt")).toContain("春の渡り");
      expect(img.getAttribute("alt")).toContain("秋の渡り");
      expect(Number(img.getAttribute("width"))).toBeGreaterThan(800);
      expect(Number(img.getAttribute("height"))).toBeGreaterThan(800);
    });
  });

  it("図の直後の説明に、図の名前、注記、今の位置でないこと、出典がある", () => {
    render(<MigrationRoutes />);
    for (const img of screen.getAllByRole("img")) {
      const i = screen.getAllByRole("img").indexOf(img);
      const caption = img.nextElementSibling!;
      expect(caption.tagName).toBe("FIGCAPTION");
      expect(caption.textContent).toContain(EXPECTED[i]![1]);
      expect(caption.textContent).toContain(EXPECTED[i]![2]);
      expect(caption.textContent).toContain("過去の追跡をまとめた図で、今飛んでいる位置ではありません。");
      const source = within(caption as HTMLElement).getByRole("link", { name: "環境省「渡り鳥の飛来経路について」" });
      expect(source.getAttribute("href")).toBe(SOURCE_URL);
      expect(source.classList.contains("tap-link")).toBe(true); // 押せる高さ（44px 以上）
    }
  });

  it("原寸の画像を別タブで開くリンクは自前の写しに張り、押しやすい大きさにする", () => {
    render(<MigrationRoutes />);
    for (const f of ROUTE_FIGURES) {
      const link = screen.getByRole("link", { name: `${f.species}の図を原寸で開く（別のタブ）` });
      expect(link.getAttribute("href")).toBe(`/migration/routes/${f.file}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.classList.contains("tap-link")).toBe(true);
    }
  });

  it("断りの 3 文と、出典の題と URL がある", () => {
    const { container } = render(<MigrationRoutes />);
    const text = container.textContent ?? "";
    for (const s of ["過去の追跡をまとめた図で、今飛んでいる位置ではありません。", "追跡できた個体の数は限られます。", "農場の危険度や、これから飛ぶ経路を示すものではありません。", "環境省「渡り鳥の飛来経路について」", SOURCE_URL]) {
      expect(text, s).toContain(s);
    }
  });

  it("環境省の画像を直接読まない。個別の追跡はページへのリンクだけにする", () => {
    const { container } = render(<MigrationRoutes />);
    for (const img of Array.from(container.querySelectorAll("img"))) expect(img.getAttribute("src")).not.toMatch(/^https?:/u);
    expect(screen.getByRole("link", { name: "環境省「ハクチョウ・カモ類の飛来経路及び移動状況について」" }).getAttribute("href")).toBe(TRACKING_URL);
    expect(Array.from(container.querySelectorAll("a")).filter((a) => /\.(jpe?g|png)$/u.test(a.href) && a.href.includes("go.jp"))).toEqual([]);
  });

  it("禁句がない（alt も含む）", () => {
    const { container } = render(<MigrationRoutes />);
    const alts = Array.from(container.querySelectorAll("img")).map((i) => i.alt).join(" ");
    expect(findWordingViolations(`${container.textContent ?? ""} ${alts}`)).toEqual([]);
  });
});
