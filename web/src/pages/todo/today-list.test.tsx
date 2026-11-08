// 対策項目（/todo）の「今日のやること」（2026-11-07 A。F3 の「けさの確認」を置き換える）。会員で農場があるときだけ。
// 行の形は 1 種類（印・文・小さな補足・押すもの）。入るのは記録できるものだけ: 死亡数（鶏舎ごと）、消毒、AI の相談から追加した対策、自己点検。
// 並びは開いたときに「まだ → 後でやる → 済み」で固定し、押しても動かさない。未入力を 0 羽、読めないを「まだ」「済み」にしない。
import type { CheckRecord, DeathRecord, Farm, House, Season, WatchStatus } from "@hpai/shared/types";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource, RecordStore } from "../../data/types";

// 県の形は実データを fs から読む（農場の地点で段階 4 に落ち着く。段階 1 の並びは todo.test.tsx）
const geoBox = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../../geo/loadGeo", () => ({ loadWebGeoStore: () => Promise.resolve(geoBox.store) }));
vi.mock("../auth/useAuthUser", () => ({
  useAuthUser: () => ({ user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} }),
}));

const reviewBox = vi.hoisted(() => ({
  store: { addReview: vi.fn(), listReviews: vi.fn(), listReviewItems: vi.fn(), markReview: vi.fn(), removeReview: vi.fn() },
  catalog: null as unknown,
  catalogFail: false,
}));
vi.mock("../consult/reviewStore", () => ({ createReviewStore: () => reviewBox.store }));
vi.mock("../consult/cardsData", () => ({
  loadConsultCatalog: () => (reviewBox.catalogFail ? Promise.reject(new Error("読めません")) : Promise.resolve(reviewBox.catalog)),
}));

import { createGeoStore } from "@hpai/shared/geo";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { TODAY_TEXT } from "./texts";
import TodoPage from "./TodoPage";

const NOW = new Date("2026-01-05T06:10:00+09:00");
const TODAY = "2026-01-05";
const HEADING = "今日のやること";
const D17 = "衛生管理区域（消毒して入る範囲）の入口で、立ち入る人に手指の洗浄と消毒をしてもらう";
const D19 = "衛生管理区域に入る車両を、入口で消毒する";
const D22 = "鶏舎に出入りするたびに、手指の洗浄と消毒をする";

function makeDs(watch: WatchStatus[] | null): DataSource {
  return {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWildBirds: (_s, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWatchStatus: (cb) => {
      if (watch !== null) cb(watch);
      return () => {};
    },
    loadHistory: async () => [],
  };
}
const okWatch = (): WatchStatus[] => [
  { prefCode: "33", checkedAt: "2026-01-05T05:30:00+09:00", ok: true, lastOkAt: "2026-01-05T05:30:00+09:00", failingSince: null },
  { prefCode: "31", checkedAt: "2026-01-04T22:00:00+09:00", ok: true, lastOkAt: "2026-01-04T22:00:00+09:00", failingSince: null },
];

function farmFixture(o: Partial<Farm> = {}): Farm & { id: string } {
  return {
    id: "f1",
    name: "見本農場",
    memberUids: ["u1"],
    unsubscribedUids: [],
    meshCode: "52335400",
    muniCode: "33203",
    prefCode: "33",
    frequentMuniCodes: [],
    production: null,
    housing: null,
    kahoContact: "",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {},
    updatedAt: "2025-12-01T10:00:00+09:00",
    ...o,
  };
}
const house = (id: string, name: string, o: Partial<House> = {}): House & { id: string } => ({ id, name, birdType: "採卵鶏", flockSize: 300, empty: false, ...o });
const death = (houseId: string, deaths: number): DeathRecord => ({ date: TODAY, houseId, deaths, flockSizeAt: 300, exclusion: null });

let farm: (Farm & { id: string }) | null;
let store: RecordStore;
const listHouses = vi.fn<() => Promise<Array<House & { id: string }>>>();
const listDeaths = vi.fn<(from: string, to: string) => Promise<DeathRecord[]>>();
const listChecks = vi.fn<(from: string, to: string) => Promise<Array<CheckRecord & { id: string }>>>();
const saveCheck = vi.fn<(c: CheckRecord) => Promise<void>>();

const review = (id: string, o: { status?: "pending" | "later" | "done" | null; note?: string } = {}) => ({
  id,
  status: o.status ?? null,
  note: o.note ?? "",
  updatedAt: o.status ? new Date("2026-01-04T12:00:00+09:00") : null,
  mine: o.status ? true : null,
});

const dataDir = (...p: string[]) => path.resolve(import.meta.dirname, "../../../../data/geo", ...p);

beforeEach(() => {
  geoBox.store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => JSON.parse(readFileSync(dataDir("pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  farm = farmFixture();
  listHouses.mockReset().mockResolvedValue([house("h1", "1 号舎"), house("h2", "2 号舎")]);
  listDeaths.mockReset().mockResolvedValue([death("h1", 3)]);
  listChecks.mockReset().mockResolvedValue([]);
  saveCheck.mockReset().mockResolvedValue(undefined);
  reviewBox.store.listReviews.mockReset().mockResolvedValue([]);
  reviewBox.store.listReviewItems.mockReset().mockResolvedValue([]);
  reviewBox.store.markReview.mockReset().mockResolvedValue(undefined);
  reviewBox.store.removeReview.mockReset().mockResolvedValue(undefined);
  reviewBox.catalogFail = false;
  reviewBox.catalog = {
    cards: new Map(
      [
        ["c1", "防鳥ネットの破れを点検する"],
        ["c2", "敷地の除草をする"],
        ["c3", "鶏舎の入口で専用の靴に履き替える"],
      ].map(([id, action]) => [id, { id, action, evidence: "obligation", sourceId: "s1" }]),
    ),
    sources: new Map([["s1", { id: "s1", title: "手引き", publisher: "農林水産省", url: "https://www.maff.go.jp/x.pdf", domestic: true }]]),
  };
  store = {
    mode: "firestore",
    getFarm: vi.fn(async () => farm),
    listHouses,
    listDeaths,
    listChecks,
    saveCheck,
  } as unknown as RecordStore;
});
afterEach(cleanup);

function mount(o: { watch?: WatchStatus[] | null; store?: RecordStore; path?: string } = {}) {
  const p = o.path ?? "/todo";
  return render(
    <MemoryRouter initialEntries={[p]}>
      <DataSourceProvider value={makeDs(o.watch === undefined ? okWatch() : o.watch)}>
        <RecordStoreProvider value={o.store ?? store}>
          <SpotProvider fixed={null}>
            <Routes>
              <Route path={p} element={<TodoPage />} />
            </Routes>
          </SpotProvider>
        </RecordStoreProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

/** 今日のやることの節。集計の行が出る（全部の読み出しが終わる）まで待つ */
async function list() {
  const region = await screen.findByRole("region", { name: HEADING });
  await waitFor(() => expect(region.querySelector(".today-summary")).not.toBeNull());
  return region;
}
const rows = (region: HTMLElement) => Array.from(region.querySelectorAll<HTMLElement>(".today-row"));
const titleOf = (row: HTMLElement) => row.querySelector(".today-title")?.textContent ?? "";
const markOf = (row: HTMLElement) => row.querySelector(".today-mark")?.getAttribute("aria-label") ?? "";
const glyphOf = (row: HTMLElement) => row.querySelector(".today-mark")?.textContent ?? "";
const subOf = (row: HTMLElement) => row.querySelector(".today-sub")?.textContent ?? "";
const rowOf = (region: HTMLElement, title: string) => {
  const r = rows(region).find((x) => titleOf(x) === title);
  expect(r, title).toBeTruthy();
  return r!;
};
const summaryOf = (region: HTMLElement) => region.querySelector(".today-summary")?.textContent ?? "";

describe("置き場と出る条件", () => {
  it("会員で農場があると、見出し（h1）の横に時点（主語つき）と発生の地図への入口、その下に「今日のやること」（h2）が出る。「けさの確認」は出さない", async () => {
    const { container } = mount();
    const region = await list();
    expect(within(region).getByRole("heading", { level: 2, name: HEADING })).toBeTruthy();
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("対策項目");
    const asOf = h1.nextElementSibling!;
    expect(asOf.classList.contains("as-of")).toBe(true);
    expect(asOf.textContent).toBe("発表の確認: 1 月 5 日 5:30 時点");
    const head = h1.parentElement!;
    expect(within(head).getByRole("link", { name: "発生の地図を見る" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("region", { name: "けさの確認" })).toBeNull();
    // 相談から足した対策は同じリストの行になり、別の欄を作らない
    expect(screen.queryByRole("region", { name: "AI の相談から足した見直し" })).toBeNull();
  });

  it("時点がないときは「発表の確認: 未確認」。見回りの結果が届くまでは「発表の確認: 読み込んでいます」", async () => {
    mount({ watch: [] });
    await list();
    expect(document.querySelector("h1 + .as-of")?.textContent).toBe("発表の確認: 未確認");
    expect(screen.queryByText("確認できていません")).toBeNull();
    cleanup();
    mount({ watch: null });
    await list();
    expect(document.querySelector("h1 + .as-of")?.textContent).toBe("発表の確認: 読み込んでいます");
  });

  it("会員でない（農場がない）ときは出さず、鶏舎も死亡数も読みにいかない。時点の行は主語つき（B）", async () => {
    farm = null;
    mount();
    await screen.findByText("今月の自己点検を確かめましょう");
    await waitFor(() => expect(store.getFarm).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: HEADING })).toBeNull();
    expect(listHouses).not.toHaveBeenCalled();
    expect(listDeaths).not.toHaveBeenCalled();
    expect(document.querySelector("h1 + .as-of")?.textContent).toBe("発表の確認: 1 月 5 日 5:30 時点");
    // 今の作り（確認リストのボタンと 2 つのリンク）のまま
    expect(screen.getByRole("button", { name: /^確認リストを開く（\d+ 項目）$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "今月の自己点検を開く" })).toBeTruthy();
  });

  // 見本の対策項目には、記録へのリンク（消毒の記録を開く）も出さない（記録を試す画面をなくした。2026-11-08）
  it("見本の農場（sample）の対策項目には出さない（今のまま）", async () => {
    const sample = { ...store, mode: "sample" } as unknown as RecordStore;
    mount({ store: sample, path: "/sample/todo" });
    // 農場の地点が入る前後で一瞬読み込み中になるので、そろって出るまで待つ
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^確認リストを開く（\d+ 項目）$/ })).toBeTruthy();
      expect(screen.getByText("今月の自己点検を確かめましょう")).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "消毒の記録を開く" })).toBeNull();
    expect(screen.queryByRole("region", { name: HEADING })).toBeNull();
    expect(listHouses).not.toHaveBeenCalled();
  });

  it("全部が読み終わるまでは「読み込んでいます」だけで、集計も行も出さない（途中の並びを見せない）", async () => {
    reviewBox.store.listReviewItems.mockReturnValue(new Promise(() => {}));
    mount();
    const region = await screen.findByRole("region", { name: HEADING });
    await waitFor(() => expect(listDeaths).toHaveBeenCalled());
    expect(within(region).getByText("読み込んでいます")).toBeTruthy();
    expect(region.querySelector(".today-summary")).toBeNull();
    expect(rows(region)).toHaveLength(0);
  });
});

describe("行の形と印", () => {
  it("1 行は「印・文・小さな補足・押すもの」。印は文字（☐ ⏲ ☑）と名前（まだ・後でやる・済み）の両方", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later" })]);
    mount();
    const r = await list();
    const h1 = rowOf(r, "1 号舎の死亡数");
    expect([glyphOf(h1), markOf(h1)]).toEqual(["☑", "済み"]);
    const h2 = rowOf(r, "2 号舎の死亡数");
    expect([glyphOf(h2), markOf(h2)]).toEqual(["☐", "まだ"]);
    const net = rowOf(r, "防鳥ネットの破れを点検する");
    expect([glyphOf(net), markOf(net)]).toEqual(["⏲", "後でやる"]);
    // 印の色は theme の変数だけ（新しい色を作らない）
    const css = readFileSync(path.join(import.meta.dirname, "todo.css"), "utf8");
    for (const m of css.matchAll(/\.today-row\.is-[a-z]+ \.today-mark\s*\{([^}]*)\}/g)) expect(m[1]).toMatch(/color:\s*var\(--[a-z0-9-]+\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("スマホの幅（40rem 以下）では押すものが文の下に回る。押すものは 48px（.btn と .tap-link）", () => {
    const css = readFileSync(path.join(import.meta.dirname, "todo.css"), "utf8");
    const narrow = /@media \(max-width:\s*40rem\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(narrow).toMatch(/\.today-row\s*\{[^}]*grid-template-columns/);
    expect(narrow).toMatch(/\.today-act\s*\{[^}]*grid-column:\s*2\s*\/\s*-1/);
    expect(css).toMatch(/\.today-src\s*\{[^}]*min-height:\s*var\(--tap\)/);
  });
});

describe("1 死亡数（鶏舎ごと）", () => {
  it("今日（日本時間）の分だけを読み、記録済みは ☑「N 羽を記録」、未入力は ☐「今日の分は未入力（週の報告までに）」と「記録する」。未入力を 0 羽にしない", async () => {
    mount();
    const r = await list();
    expect(listDeaths).toHaveBeenCalledWith(TODAY, TODAY);
    expect(subOf(rowOf(r, "1 号舎の死亡数"))).toBe("3 羽を記録");
    const h2 = rowOf(r, "2 号舎の死亡数");
    expect(subOf(h2)).toBe("今日の分は未入力（週の報告までに）");
    expect(h2.textContent).not.toContain("0 羽");
    expect(within(h2).getByRole("link", { name: "記録する" }).getAttribute("href")).toBe("/record/deaths");
    // 記録済みの行に押すものは出さない
    expect(within(rowOf(r, "1 号舎の死亡数")).queryByRole("link")).toBeNull();
  });

  it("0 羽と記録した鶏舎は ☑「0 羽を記録」", async () => {
    listDeaths.mockResolvedValue([death("h1", 0), death("h2", 1)]);
    mount();
    const r = await list();
    expect(subOf(rowOf(r, "1 号舎の死亡数"))).toBe("0 羽を記録");
    expect(markOf(rowOf(r, "1 号舎の死亡数"))).toBe("済み");
    expect(subOf(rowOf(r, "2 号舎の死亡数"))).toBe("1 羽を記録");
  });

  it("空舎にした鶏舎は行に出さない", async () => {
    listHouses.mockResolvedValue([house("h1", "1 号舎"), house("h2", "2 号舎", { empty: true })]);
    listDeaths.mockResolvedValue([]);
    mount();
    const r = await list();
    expect(rows(r).map(titleOf)).not.toContain("2 号舎の死亡数");
    expect(markOf(rowOf(r, "1 号舎の死亡数"))).toBe("まだ");
  });

  it("鶏舎の行は名前の順（保存の側の順によらない。2 号舎は 10 号舎より前）", async () => {
    listHouses.mockResolvedValue([house("h10", "10 号舎"), house("h2", "2 号舎"), house("h1", "1 号舎")]);
    listDeaths.mockResolvedValue([]);
    mount();
    const r = await list();
    expect(rows(r).map(titleOf).filter((t) => t.endsWith("の死亡数"))).toEqual(["1 号舎の死亡数", "2 号舎の死亡数", "10 号舎の死亡数"]);
  });

  it("鶏舎がなければ ☐「鶏舎がまだありません。」と、農場の設定の鶏舎の欄（#houses）への「鶏舎を追加する」", async () => {
    listHouses.mockResolvedValue([]);
    mount();
    const r = await list();
    const row = rowOf(r, "死亡数");
    expect(markOf(row)).toBe("まだ");
    expect(subOf(row)).toBe("鶏舎がまだありません。");
    expect(within(row).getByRole("link", { name: "鶏舎を登録する" }).getAttribute("href")).toBe("/settings/farm#houses");
    expect(within(row).queryByRole("link", { name: "記録する" })).toBeNull();
  });

  it("読めなければ 1 行で「読み込めませんでした」（☐ や 0 羽、未入力にしない）。記録の画面への入口は残し、集計に「読み込めなかった」を添える", async () => {
    listDeaths.mockRejectedValue(new Error("permission-denied"));
    mount();
    const r = await list();
    const row = rowOf(r, "死亡数");
    expect(subOf(row)).toBe("読み込めませんでした");
    expect(glyphOf(row)).not.toMatch(/[☐☑⏲]/);
    expect(r.textContent).not.toMatch(/未入力|\d+ 羽/);
    expect(within(row).getByRole("link", { name: "記録する" }).getAttribute("href")).toBe("/record/deaths");
    expect(summaryOf(r)).toContain("読み込めなかった 1");
  });
});

describe("2 消毒（記録できる項目だけ。DoneButton と saveCheck はそのまま）", () => {
  it("段階 4 の 3 項目が「やった」で並び、「記録は任意」はリストの中で 1 回だけ。出典は行末の小さなリンク", async () => {
    mount();
    const r = await list();
    for (const t of [D17, D19, D22]) {
      const row = rowOf(r, t);
      expect(markOf(row)).toBe("まだ");
      expect(within(row).getByRole("button", { name: `やった: ${t}` })).toBeTruthy();
      const src = within(row).getByRole("link", { name: /^出典: / });
      expect(src.textContent).toBe("出典");
      expect(src.getAttribute("href")).toMatch(/^https:/);
    }
    expect(within(r).getAllByText(/記録は任意/)).toHaveLength(1);
    // 押した記録を取り消せない断りも 1 回
    expect(r.textContent!.split("押した記録を取り消す操作はありません").length - 1).toBe(1);
  });

  it("「やった」は saveCheck({kind:'disinfection',date,itemId}) だけを呼び、印が ☑ になる。並びは動かさず、集計は変わる", async () => {
    mount();
    const r = await list();
    const before = rows(r).map(titleOf);
    expect(summaryOf(r)).toMatch(/^まだ 4 ・ 後でやる 0 ・ 済み 1/);
    fireEvent.click(within(rowOf(r, D19)).getByRole("button", { name: `やった: ${D19}` }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(saveCheck.mock.calls[0]![0]).toEqual({ kind: "disinfection", date: TODAY, itemId: "always-19" });
    await waitFor(() => expect(markOf(rowOf(r, D19))).toBe("済み"));
    expect(rows(r).map(titleOf)).toEqual(before);
    expect(summaryOf(r)).toMatch(/^まだ 3 ・ 後でやる 0 ・ 済み 2/);
  });

  it("今日すでに記録した項目は、開いたときから ☑ で「済み」の群に並ぶ", async () => {
    listChecks.mockResolvedValue([{ id: "x", kind: "disinfection", date: TODAY, itemId: "always-17" }]);
    mount();
    const r = await list();
    const order = rows(r).map(titleOf);
    expect(markOf(rowOf(r, D17))).toBe("済み");
    expect(order.indexOf(D17)).toBeGreaterThan(order.indexOf(D22));
  });

  it("今日の記録を読めなければ ☐ にせず「今日の記録を読み込めませんでした」。押せる（今と同じ）", async () => {
    listChecks.mockRejectedValue(new Error("unavailable"));
    mount();
    const r = await list();
    const row = rowOf(r, D19);
    expect(glyphOf(row)).not.toMatch(/[☐☑⏲]/);
    expect(row.textContent).toContain("今日の記録を読み込めませんでした");
    expect((within(row).getByRole("button", { name: `やった: ${D19}` }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("3 AI の相談から追加した対策（F1 の状態をそのまま）", () => {
  it("状態で印を付け、押すものは今の 3 つ（まだ・後でやる・やった）。記録なしは ☐ と補足「記録なし」", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later" }), review("c2", { status: "done" }), review("c3")]);
    mount();
    const r = await list();
    const net = rowOf(r, "防鳥ネットの破れを点検する");
    const group = within(net).getByRole("group", { name: "実施の状態: 防鳥ネットの破れを点検する" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["まだ", "後でやる", "やった"]);
    expect(within(group).getByRole("button", { name: "後でやる" }).getAttribute("aria-pressed")).toBe("true");
    expect(markOf(rowOf(r, "敷地の除草をする"))).toBe("済み");
    const shoe = rowOf(r, "鶏舎の入口で専用の靴に履き替える");
    expect(markOf(shoe)).toBe("まだ");
    expect(subOf(shoe)).toContain("記録なし");
    expect(subOf(net)).not.toContain("記録なし");
    expect(reviewBox.store.listReviewItems).toHaveBeenCalledTimes(1);
  });

  it("メモ・「この対策を AI に聞く」・「外す」は行の中の「くわしく」に畳む。開くと出る", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later", note: "網を発注した" })]);
    mount();
    const r = await list();
    const row = rowOf(r, "防鳥ネットの破れを点検する");
    const fold = row.querySelector("details")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("くわしく");
    // 閉じていても中身は DOM にある（details の標準）。開くと見える
    for (const name of ["この対策を AI に聞く"]) expect(within(fold).getByRole("link", { name, hidden: true })).toBeTruthy();
    expect(within(fold).getByRole("button", { name: "外す", hidden: true })).toBeTruthy();
    expect(within(fold).getByLabelText("メモ（40 字まで）")).toBeTruthy();
    fireEvent.click(fold.querySelector("summary")!);
    expect(fold.open).toBe(true);
    // メモは行にも短く出す
    expect(row.textContent).toContain("メモ: 網を発注した");
  });

  it("「やった」を押すと、その対策の状態だけを保存し、並びは動かさない（押した行が指の下から動かない）", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c3"), review("c1", { status: "pending" })]);
    mount();
    const r = await list();
    const before = rows(r).map(titleOf);
    const row = rowOf(r, "鶏舎の入口で専用の靴に履き替える");
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    expect(reviewBox.store.markReview).toHaveBeenCalledWith("c3", { status: "done" });
    await waitFor(() => expect(markOf(rowOf(r, "鶏舎の入口で専用の靴に履き替える"))).toBe("済み"));
    expect(rows(r).map(titleOf)).toEqual(before);
  });

  it("「外す」を押すと、その行がなくなり、集計からも消える", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1"), review("c3")]);
    mount();
    const r = await list();
    // 2 号舎の死亡数・消毒 3・足した対策 2
    expect(summaryOf(r)).toMatch(/^まだ 6 /);
    const row = rowOf(r, "防鳥ネットの破れを点検する");
    fireEvent.click(within(row).getByRole("button", { name: "外す", hidden: true }));
    await waitFor(() => expect(rows(r).map(titleOf)).not.toContain("防鳥ネットの破れを点検する"));
    expect(reviewBox.store.removeReview).toHaveBeenCalledWith("c1");
    expect(summaryOf(r)).toMatch(/^まだ 5 /);
  });

  it("足した対策がなければ、相談の画面への案内を 1 行。読めなければ「読み込めませんでした」で 0 件と読ませない", async () => {
    mount();
    const r = await list();
    expect(within(r).getByText(/相談の画面で『対策項目に追加する』を押すと/)).toBeTruthy();
    expect(within(r).getByRole("link", { name: "AIに対策を相談する" }).getAttribute("href")).toBe("/consult");
    cleanup();
    reviewBox.store.listReviewItems.mockRejectedValue(new Error("permission-denied"));
    mount();
    const r2 = await list();
    expect(within(r2).getByText("足した見直しを読み込めませんでした。ページを読み込み直してください。")).toBeTruthy();
    expect(within(r2).queryByText(/相談の画面で『対策項目に追加する』を押すと/)).toBeNull();
    expect(summaryOf(r2)).toContain("読み込めなかった 1");
  });

  it("今の資料にないカードは、その旨と「外す」だけ（状態のボタンなし）。集計に数えない", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("gone-X99")]);
    mount();
    const r = await list();
    const row = rowOf(r, "このカードは今の資料にありません。");
    expect(within(row).queryByRole("group", { name: /^実施の状態/ })).toBeNull();
    expect(within(row).getByRole("button", { name: "外す", hidden: true })).toBeTruthy();
    expect(glyphOf(row)).not.toMatch(/[☐☑⏲]/);
    expect(summaryOf(r)).toMatch(/^まだ 4 ・ 後でやる 0 ・ 済み 1/);
  });
});

describe("4 自己点検", () => {
  it("今日以降でいちばん近い期限が未記録なら ☐「期限 1 月 28 日（あと 23 日）」と「自己点検を開く」", async () => {
    farm = farmFixture({ selfCheckDue: { "2025-12": "2025-12-28", "2026-01": "2026-01-28", "2026-02": "2026-02-27" } });
    mount();
    const r = await list();
    const row = rowOf(r, "自己点検");
    expect(markOf(row)).toBe("まだ");
    expect(subOf(row)).toBe("期限 1 月 28 日（あと 23 日）");
    expect(within(row).getByRole("link", { name: "自己点検を開く" }).getAttribute("href")).toBe("/record/self-check");
    expect(listChecks).toHaveBeenCalledWith("2026-01-01", TODAY);
  });

  it("今日が期限なら「今日」", async () => {
    farm = farmFixture({ selfCheckDue: { "2026-01": TODAY } });
    mount();
    expect(subOf(rowOf(await list(), "自己点検"))).toBe("期限 1 月 5 日（今日）");
  });

  it("その月の分を記録していれば ☑「1 月の分を記録済み」で「済み」の群", async () => {
    farm = farmFixture({ selfCheckDue: { "2026-01": "2026-01-28" } });
    listChecks.mockResolvedValue([
      { id: "self_2026-01", kind: "self_inspection", date: "2026-01-03", month: "2026-01", answers: { "17": "ok", "18": "ok", "19": "ok", "22": "ok", "23": "ok", "25": "ok", "27": "ok" } },
    ]);
    mount();
    const r = await list();
    const row = rowOf(r, "自己点検");
    expect(markOf(row)).toBe("済み");
    expect(subOf(row)).toBe("1 月の分を記録済み");
  });

  it("期限の登録がなければ「期限は登録されていません」と通知の設定への入口。☐ にも ☑ にもせず、集計に数えない", async () => {
    for (const selfCheckDue of [{}, { "2026-01": "1 月末" }] as Record<string, string>[]) {
      farm = farmFixture({ selfCheckDue });
      mount();
      const r = await list();
      const row = rowOf(r, "自己点検");
      expect(subOf(row)).toBe("期限は登録されていません");
      expect(markOf(row)).toBe("期限なし");
      expect(within(row).getByRole("link", { name: "通知の設定で期限を入れる" }).getAttribute("href")).toBe("/settings/notify");
      expect(summaryOf(r)).toMatch(/^まだ 4 ・ 後でやる 0 ・ 済み 1$/);
      cleanup();
    }
  });

  it("登録はあるが、すべて過ぎたときは「登録した期限（最後は 12 月 28 日）はすべて過ぎました」（「今季」と書かない）", async () => {
    farm = farmFixture({ selfCheckDue: { "2025-11": "2025-11-28", "2025-12": "2025-12-28" } });
    mount();
    const row = rowOf(await list(), "自己点検");
    expect(subOf(row)).toBe("登録した期限（最後は 12 月 28 日）はすべて過ぎました");
    expect(row.textContent).not.toMatch(/今季|登録されていません/);
    expect(within(row).getByRole("link", { name: "通知の設定で期限を入れる" })).toBeTruthy();
  });

  it("今月の記録を読めなければ ☐ にせず「読み込めませんでした」を添える", async () => {
    farm = farmFixture({ selfCheckDue: { "2026-01": "2026-01-28" } });
    listChecks.mockRejectedValue(new Error("unavailable"));
    mount();
    const row = rowOf(await list(), "自己点検");
    expect(glyphOf(row)).not.toMatch(/[☐☑⏲]/);
    expect(row.textContent).toContain("期限 1 月 28 日（あと 23 日）");
    expect(row.textContent).toContain("今月の記録を読み込めませんでした");
  });
});

describe("並びと集計", () => {
  it("開いたときに「まだ → 後でやる → 済み」の順に並べる（同じ群の中は 死亡数 → 消毒 → 相談 → 自己点検）", async () => {
    farm = farmFixture({ selfCheckDue: { "2026-01": "2026-01-28" } });
    reviewBox.store.listReviewItems.mockResolvedValue([review("c2", { status: "done" }), review("c1", { status: "later" }), review("c3")]);
    mount();
    const r = await list();
    expect(rows(r).map((x) => [titleOf(x), markOf(x)])).toEqual([
      ["2 号舎の死亡数", "まだ"],
      [D17, "まだ"],
      [D19, "まだ"],
      [D22, "まだ"],
      ["鶏舎の入口で専用の靴に履き替える", "まだ"],
      ["自己点検", "まだ"],
      ["防鳥ネットの破れを点検する", "後でやる"],
      ["1 号舎の死亡数", "済み"],
      ["敷地の除草をする", "済み"],
    ]);
    expect(summaryOf(r)).toBe("まだ 6 ・ 後でやる 1 ・ 済み 2");
  });

  it("後でやるを「やった」にしても並びは動かず、集計は変わる", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later" })]);
    mount();
    const r = await list();
    const before = rows(r).map(titleOf);
    expect(summaryOf(r)).toMatch(/後でやる 1 ・ 済み 1/);
    fireEvent.click(within(rowOf(r, "防鳥ネットの破れを点検する")).getByRole("button", { name: "やった" }));
    await waitFor(() => expect(summaryOf(r)).toMatch(/後でやる 0 ・ 済み 2/));
    expect(rows(r).map(titleOf)).toEqual(before);
  });
});

describe("文言", () => {
  it("禁句がなく、前回との比べ（変化）や安全・危険の判定の言葉を使わない", () => {
    const joined = Object.values(TODAY_TEXT)
      .flatMap((v) => (typeof v === "function" ? [(v as (...a: unknown[]) => string)("後でやる", 3, 4)] : typeof v === "object" ? Object.values(v) : [v]))
      .join("\n");
    expect(findForbiddenPhrases(joined)).toEqual([]);
    expect(joined).not.toMatch(/変化|前回|安全|危険|安心/);
  });
});
