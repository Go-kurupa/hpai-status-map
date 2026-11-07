// F3: 対策項目（/todo）の見出しの直下の「けさの確認」。会員で農場があるときだけ。
// 4 項目（最新の発生・今日の死亡数・後でやる/まだの対策・次の報告期限）の正常・未入力・読めない・読み込み中と入口を確かめる。
// 未入力を 0 羽、読めないを「変化なし」にしない。前回との比べ、AI の判定は出さない。
import type { DeathRecord, Farm, House, Season, WatchStatus } from "@hpai/shared/types";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource, RecordStore } from "../../data/types";

// 県の形は読み終わらない（この試験は段階を見ない）
vi.mock("../../geo/loadGeo", () => ({ loadWebGeoStore: () => new Promise(() => {}) }));
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

import { findForbiddenPhrases } from "@hpai/shared/wording";
import { MORNING_TEXT } from "./texts";
import TodoPage from "./TodoPage";

const NOW = new Date("2026-01-05T06:10:00+09:00");
const TODAY = "2026-01-05";
const HEADING = "けさの確認";

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

const review = (id: string, o: { status?: "pending" | "later" | "done" | null; note?: string } = {}) => ({
  id,
  status: o.status ?? null,
  note: o.note ?? "",
  updatedAt: o.status ? new Date("2026-01-04T12:00:00+09:00") : null,
  mine: o.status ? true : null,
});

beforeEach(() => {
  farm = farmFixture();
  listHouses.mockReset().mockResolvedValue([house("h1", "1 号舎"), house("h2", "2 号舎")]);
  listDeaths.mockReset().mockResolvedValue([death("h1", 3)]);
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
        ["c4", "着替えの前後の動線を分ける"],
        ["c5", "ねずみの通り道をふさぐ"],
        ["c6", "車両の消毒槽の薬を替える"],
      ].map(([id, action]) => [id, { id, action, evidence: "obligation", sourceId: "s1" }]),
    ),
    sources: new Map([["s1", { id: "s1", title: "手引き", publisher: "農林水産省", url: "https://www.maff.go.jp/x.pdf", domestic: true }]]),
  };
  store = {
    mode: "firestore",
    getFarm: vi.fn(async () => farm),
    listHouses,
    listDeaths,
    listChecks: vi.fn(async () => []),
    saveCheck: vi.fn(async () => undefined),
  } as unknown as RecordStore;
});
afterEach(cleanup);

function mount(o: { watch?: WatchStatus[] | null; store?: RecordStore; path?: string } = {}) {
  const path = o.path ?? "/todo";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataSourceProvider value={makeDs(o.watch === undefined ? okWatch() : o.watch)}>
        <RecordStoreProvider value={o.store ?? store}>
          <SpotProvider fixed={null}>
            <Routes>
              <Route path={path} element={<TodoPage />} />
            </Routes>
          </SpotProvider>
        </RecordStoreProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

const box = async () => within(await screen.findByRole("region", { name: HEADING }));
/** 4 項目それぞれの枠（見出し h3 の名前で引く） */
const part = async (name: RegExp) => {
  const b = await box();
  const h = b.getByRole("heading", { name });
  return within(h.closest(".morning-item") as HTMLElement);
};

describe("けさの確認の置き場と出る条件", () => {
  it("会員で農場があると、見出し（h1）の直下に「けさの確認」の節（h2）が出て、4 項目が並ぶ", async () => {
    const { container } = mount();
    const region = await screen.findByRole("region", { name: HEADING });
    expect(within(region).getByRole("heading", { level: 2, name: HEADING })).toBeTruthy();
    // h1 と時点の行の直後（解除の見込みや確認リストより上）
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("対策項目");
    expect(h1.nextElementSibling?.classList.contains("as-of")).toBe(true);
    expect(h1.nextElementSibling?.nextElementSibling).toBe(region);
    const names = within(region)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(["最新の発生", "今日の死亡数", "後でやる・まだの対策", "次の報告期限"]);
  });

  it("会員でない（農場がない）ときは出さず、鶏舎も死亡数も読みにいかない", async () => {
    farm = null;
    mount();
    await screen.findByRole("heading", { level: 1, name: "対策項目" });
    await waitFor(() => expect(store.getFarm).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: HEADING })).toBeNull();
    expect(listHouses).not.toHaveBeenCalled();
    expect(listDeaths).not.toHaveBeenCalled();
  });

  it("見本の農場（sample）の対策項目には出さない（今のまま）", async () => {
    const sample = { ...store, mode: "sample" } as unknown as RecordStore;
    mount({ store: sample, path: "/sample/todo" });
    await screen.findByText("今月の自己点検を確かめましょう");
    expect(screen.queryByRole("region", { name: HEADING })).toBeNull();
    expect(listHouses).not.toHaveBeenCalled();
  });
});

describe("1 最新の発生", () => {
  it("今季の発生の地図（/）への入口と、上の時点の行と同じ時点を、見回りの確認の時点と分かる書き方（「…時点の確認」）で出す", async () => {
    mount();
    const p = await part(/最新の発生/);
    // 発生の時刻と読ませない
    expect(p.getByText("1 月 5 日 5:30 時点の確認")).toBeTruthy();
    expect(p.queryByText("1 月 5 日 5:30 時点")).toBeNull();
    expect(p.getByRole("link", { name: "発生の地図を見る" }).getAttribute("href")).toBe("/");
    // ページ上の時点の行と同じ値
    expect(document.querySelector("h1 + .as-of")?.textContent).toBe("1 月 5 日 5:30 時点");
  });

  it("見回りの結果が届くまでは「読み込んでいます」", async () => {
    mount({ watch: null });
    const p = await part(/最新の発生/);
    expect(p.getByText("読み込んでいます")).toBeTruthy();
    expect(p.getByRole("link", { name: "発生の地図を見る" })).toBeTruthy();
  });

  it("確認できた時点がないときは、上の時点の行と同じ「確認できていません」。「変化なし」とは書かない", async () => {
    mount({ watch: [] });
    const p = await part(/最新の発生/);
    expect(p.getByText("確認できていません")).toBeTruthy();
    expect((await box()).queryByText(/変化/)).toBeNull();
  });
});

describe("2 今日の死亡数", () => {
  it("空舎にした鶏舎は「未入力」ではなく「空舎」", async () => {
    listHouses.mockResolvedValue([house("h1", "1 号舎"), house("h2", "2 号舎", { empty: true })]);
    listDeaths.mockResolvedValue([]);
    mount();
    const p = await part(/今日の死亡数/);
    await waitFor(() => expect(p.getByText(/2 号舎: 空舎/)).toBeTruthy());
    expect(p.getByText(/1 号舎: 未入力/)).toBeTruthy();
  });
  it("今日（日本時間）の分だけを読み、鶏舎ごとに「記録済み（N 羽）」か「未入力」。未入力を 0 羽にしない", async () => {
    mount();
    const p = await part(/今日の死亡数/);
    await waitFor(() => expect(p.getAllByRole("listitem")).toHaveLength(2));
    expect(listDeaths).toHaveBeenCalledWith(TODAY, TODAY);
    const [a, b] = p.getAllByRole("listitem");
    expect(a!.textContent).toBe("1 号舎: 記録済み（3 羽）");
    expect(b!.textContent).toBe("2 号舎: 未入力");
    expect(b!.textContent).not.toContain("0 羽");
    expect(p.getByRole("link", { name: "死亡数を記録する" }).getAttribute("href")).toBe("/record/deaths");
  });

  it("0 羽と記録した鶏舎は「記録済み（0 羽）」", async () => {
    listDeaths.mockResolvedValue([death("h1", 0), death("h2", 1)]);
    mount();
    const p = await part(/今日の死亡数/);
    await waitFor(() => expect(p.getAllByRole("listitem")).toHaveLength(2));
    expect(p.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1 号舎: 記録済み（0 羽）", "2 号舎: 記録済み（1 羽）"]);
  });

  it("鶏舎がなければ「鶏舎がまだありません。」と、農場の設定の鶏舎の欄（#houses）への入口", async () => {
    listHouses.mockResolvedValue([]);
    mount();
    const p = await part(/今日の死亡数/);
    expect(await p.findByText(/鶏舎がまだありません。/)).toBeTruthy();
    expect(p.getByRole("link", { name: "鶏舎を追加する" }).getAttribute("href")).toBe("/settings/farm#houses");
    expect(p.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("読めなければ「読み込めませんでした」（未入力や 0 羽と出さない）。記録の画面への入口は残す", async () => {
    listDeaths.mockRejectedValue(new Error("permission-denied"));
    mount();
    const p = await part(/今日の死亡数/);
    expect(await p.findByText("読み込めませんでした")).toBeTruthy();
    expect(p.queryByText(/未入力|羽/)).toBeNull();
    expect(p.getByRole("link", { name: "死亡数を記録する" }).getAttribute("href")).toBe("/record/deaths");
  });

  it("読み込み中は「読み込んでいます」", async () => {
    listHouses.mockReturnValue(new Promise(() => {}));
    mount();
    const p = await part(/今日の死亡数/);
    expect(p.getByText("読み込んでいます")).toBeTruthy();
    expect(p.queryByText(/未入力/)).toBeNull();
  });
});

describe("3 後でやる・まだの対策", () => {
  it("「後でやる」と「まだ」（記録なしを含む）の数と、それぞれ最大 3 件の対策の名前。メモがあれば添える。「やった」は数えない", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([
      review("c1", { status: "later", note: "網を発注した" }),
      review("c2", { status: "done" }),
      review("c3"),
      review("c4", { status: "pending" }),
      review("c5", { status: "later" }),
    ]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("後でやる 2 件")).toBeTruthy());
    // c3（記録なし）と c4（「まだ」と記録）。記録なしの内訳を添える
    expect(p.getByText("まだ 2 件（うち記録なし 1 件）")).toBeTruthy();
    const later = p.getByRole("list", { name: "後でやる" });
    expect(within(later).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "防鳥ネットの破れを点検する（メモ: 網を発注した）",
      "ねずみの通り道をふさぐ",
    ]);
    const notYet = p.getByRole("list", { name: "まだ" });
    expect(within(notYet).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["鶏舎の入口で専用の靴に履き替える", "着替えの前後の動線を分ける"]);
    expect(p.queryByText("敷地の除草をする")).toBeNull();
    expect(reviewBox.store.listReviewItems).toHaveBeenCalledTimes(1); // 下の欄と同じ読み出しを共有する
  });

  it("「まだ」と記録したものだけなら、記録なしの内訳は出さない", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "pending" }), review("c3", { status: "pending" })]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("まだ 2 件")).toBeTruthy());
    expect(p.queryByText(/記録なし/)).toBeNull();
  });

  it("記録なしと「まだ」の記録が混ざると、記録なしの数を内訳に出す（まだ 3 件（うち記録なし 2 件））", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1"), review("c3", { status: "pending" }), review("c4")]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("まだ 3 件（うち記録なし 2 件）")).toBeTruthy());
  });

  it("4 件以上は名前を 3 件までにし、残りを「ほか N 件」", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue(["c1", "c2", "c3", "c4", "c5"].map((id) => review(id)));
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("まだ 5 件（うち記録なし 5 件）")).toBeTruthy());
    const notYet = p.getByRole("list", { name: "まだ" });
    expect(within(notYet).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "防鳥ネットの破れを点検する",
      "敷地の除草をする",
      "鶏舎の入口で専用の靴に履き替える",
      "ほか 2 件",
    ]);
  });

  it("下の欄で状態を変えると、上の数も変わる（後でやる → やった）", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later" }), review("c5", { status: "later" })]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("後でやる 2 件")).toBeTruthy());
    const lower = within(await screen.findByRole("region", { name: "AI の相談から足した見直し" }));
    const row = lower.getAllByRole("listitem").find((li) => li.textContent?.includes("防鳥ネットの破れを点検する"))!;
    fireEvent.click(within(row).getByRole("button", { name: "やった" }));
    await waitFor(() => expect(p.getByText("後でやる 1 件")).toBeTruthy());
    expect(within(p.getByRole("list", { name: "後でやる" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["ねずみの通り道をふさぐ"]);
  });

  it("下の欄で「外す」と、上の数からも消える", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1"), review("c3")]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("まだ 2 件（うち記録なし 2 件）")).toBeTruthy());
    const lower = within(await screen.findByRole("region", { name: "AI の相談から足した見直し" }));
    const row = lower.getAllByRole("listitem").find((li) => li.textContent?.includes("防鳥ネットの破れを点検する"))!;
    fireEvent.click(within(row).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(p.getByText("まだ 1 件（うち記録なし 1 件）")).toBeTruthy());
  });

  it("下の欄（AI の相談から足した見直し）への入口。欄に同じ id がある", async () => {
    mount();
    const p = await part(/後でやる・まだの対策/);
    const link = p.getByRole("link", { name: "足した対策の一覧へ" });
    expect(link.getAttribute("href")).toBe("#todo-reviews");
    const lower = await screen.findByRole("region", { name: "AI の相談から足した見直し" });
    expect(lower.id).toBe("todo-reviews");
  });

  it("カードの一覧を読めなければ、数だけを出す", async () => {
    reviewBox.catalogFail = true;
    reviewBox.store.listReviewItems.mockResolvedValue([review("c1", { status: "later" }), review("c3")]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    await waitFor(() => expect(p.getByText("後でやる 1 件")).toBeTruthy());
    expect(p.getByText("まだ 1 件（うち記録なし 1 件）")).toBeTruthy();
    expect(p.queryByText("防鳥ネットの破れを点検する")).toBeNull();
    expect(p.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("今の資料にないカードは数えない（下の欄でも状態のボタンが出ない）", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("gone-X99"), review("c1")]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    // 内訳も今の資料にあるカードだけで数える
    await waitFor(() => expect(p.getByText("まだ 1 件（うち記録なし 1 件）")).toBeTruthy());
  });

  it("後でやる・まだが 1 件もなければ、その旨を 1 行で出す", async () => {
    reviewBox.store.listReviewItems.mockResolvedValue([review("c2", { status: "done" })]);
    mount();
    const p = await part(/後でやる・まだの対策/);
    expect(await p.findByText("「後でやる」「まだ」の対策はありません")).toBeTruthy();
    expect(p.queryByText(/件/)).toBeNull();
  });

  it("読めなければ「読み込めませんでした」（0 件と出さない）", async () => {
    reviewBox.store.listReviewItems.mockRejectedValue(new Error("permission-denied"));
    mount();
    const p = await part(/後でやる・まだの対策/);
    expect(await p.findByText("読み込めませんでした")).toBeTruthy();
    expect(p.queryByText(/件|ありません/)).toBeNull();
  });

  it("読み込み中は「読み込んでいます」", async () => {
    reviewBox.store.listReviewItems.mockReturnValue(new Promise(() => {}));
    mount();
    const p = await part(/後でやる・まだの対策/);
    expect(p.getByText("読み込んでいます")).toBeTruthy();
  });
});

describe("4 次の報告期限", () => {
  it("今日以降でいちばん近い自己点検の期限と、あと何日か。記録の画面と、期限を入れる画面への入口", async () => {
    farm = farmFixture({ selfCheckDue: { "2025-12": "2025-12-28", "2026-01": "2026-01-28", "2026-02": "2026-02-27" } });
    mount();
    const p = await part(/次の報告期限/);
    expect(p.getByText("次の自己点検の期限: 1 月 28 日（あと 23 日）")).toBeTruthy();
    expect(p.getByRole("link", { name: "自己点検を記録する" }).getAttribute("href")).toBe("/record/self-check");
    expect(p.getByRole("link", { name: "期限を変える" }).getAttribute("href")).toBe("/settings/notify");
  });

  it("今日が期限なら「今日」", async () => {
    farm = farmFixture({ selfCheckDue: { "2026-01": TODAY } });
    mount();
    const p = await part(/次の報告期限/);
    expect(p.getByText("次の自己点検の期限: 1 月 5 日（今日）")).toBeTruthy();
  });

  it("登録が 1 件もないときは「期限は登録されていません」と、通知の設定への入口", async () => {
    for (const selfCheckDue of [{}, { "2026-01": "1 月末" }] as Record<string, string>[]) {
      farm = farmFixture({ selfCheckDue });
      mount();
      const p = await part(/次の報告期限/);
      expect(p.getByText("期限は登録されていません")).toBeTruthy();
      expect(p.getByRole("link", { name: "通知の設定で期限を入れる" }).getAttribute("href")).toBe("/settings/notify");
      expect(p.queryByRole("link", { name: "期限を変える" })).toBeNull();
      expect(p.queryByText(/過ぎました/)).toBeNull();
      cleanup();
    }
  });

  it("登録はあるが、今日以降の期限がない（すべて過ぎた）ときは「登録されていません」と言わず、すべて過ぎたことと、通知の設定への入口", async () => {
    farm = farmFixture({ selfCheckDue: { "2025-11": "2025-11-28", "2025-12": "2025-12-28" } });
    mount();
    const p = await part(/次の報告期限/);
    expect(p.getByText("登録した期限（最後は 12 月 28 日）はすべて過ぎました")).toBeTruthy(); // 「今季」でなく日付で
    expect(p.queryByText(/今季/)).toBeNull();
    expect(p.queryByText("期限は登録されていません")).toBeNull();
    expect(p.getByRole("link", { name: "通知の設定で期限を入れる" }).getAttribute("href")).toBe("/settings/notify");
    expect(p.queryByRole("link", { name: "自己点検を記録する" })).toBeNull();
  });
});

describe("けさの確認の文言", () => {
  it("禁句がなく、前回との比べ（変化）や安全・危険の判定の言葉を使わない", () => {
    const joined = Object.values(MORNING_TEXT)
      .map((v) => (typeof v === "function" ? (v as (...a: unknown[]) => string)("後でやる", 3) : v))
      .join("\n");
    expect(findForbiddenPhrases(joined)).toEqual([]);
    expect(joined).not.toMatch(/変化|前回|安全|危険|安心/);
  });
});
