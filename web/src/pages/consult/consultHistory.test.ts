// これまでの相談の置き場所（この端末のブラウザ）と、前の往復の選び方、日付の分け方。
import type { ConsultAskResponse } from "@hpai/shared/consult/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CONVERSATIONS,
  MAX_TURNS,
  TAG_FREE,
  TAG_STATS,
  filterConversations,
  tagCounts,
  tagsOf,
  dayGroupOf,
  historyForAsk,
  historyKey,
  loadConversations,
  saveConversations,
  trimConversations,
  turnTimeLabel,
  whenLabel,
  type ConsultConversation,
  type ConsultHistoryTurn,
} from "./consultHistory";

const answered = (answer: string): ConsultAskResponse => ({
  answer,
  cards: [{ id: "c1", action: "対策", quote: "引用", caveats: [], evidence: "obligation" } as unknown as ConsultAskResponse["cards"][number]],
  outOfScope: false,
  notice: null,
  followUps: [],
});
const turn = (question: string, result: ConsultAskResponse, at = 1): ConsultHistoryTurn => ({ question, result, at });
const conv = (id: string, updatedAt: number, turns: ConsultHistoryTurn[] = [turn("問い", answered("答え"))]): ConsultConversation => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  turns,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("historyForAsk", () => {
  it("答えがあった往復だけを、直前の 3 往復まで、問いと答えの形で返す", () => {
    const t = [
      turn("1", answered("a1")),
      turn("2", { answer: "決まった文", cards: [], outOfScope: true, notice: null }),
      turn("3", answered("a3")),
      turn("4", { answer: "", cards: [], outOfScope: false, notice: "unavailable" }),
      turn("5", answered("a5")),
      turn("6", answered("a6")),
    ];
    expect(historyForAsk(t)).toEqual([
      { question: "3", answer: "a3" },
      { question: "5", answer: "a5" },
      { question: "6", answer: "a6" },
    ]);
    expect(historyForAsk([])).toEqual([]);
  });
});

describe("読み書き", () => {
  it("会員ごとの置き場所に書き、新しい順に読み戻す", () => {
    const key = historyKey("u1");
    expect(key).toBe("hpai.consult.history.v1:u1");
    expect(saveConversations(key, [conv("古い", 1), conv("新しい", 2)])).toBe(true);
    expect(loadConversations(key).map((c) => c.id)).toEqual(["新しい", "古い"]);
    expect(loadConversations(historyKey("u2"))).toEqual([]);
  });

  it("空の一覧を書くと、置き場所ごと消す", () => {
    const key = historyKey("u1");
    saveConversations(key, [conv("a", 1)]);
    saveConversations(key, []);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("壊れた中身・形の違う相談・往復のない相談は捨てる", () => {
    const key = historyKey("u1");
    localStorage.setItem(key, "壊れた");
    expect(loadConversations(key)).toEqual([]);
    localStorage.setItem(key, JSON.stringify({ not: "array" }));
    expect(loadConversations(key)).toEqual([]);
    localStorage.setItem(
      key,
      JSON.stringify([conv("良い", 3), { id: 1 }, conv("往復なし", 2, []), { ...conv("壊れた往復", 1), turns: [{ question: "q" }] }]),
    );
    expect(loadConversations(key).map((c) => c.id)).toEqual(["良い"]);
  });

  it("読み書きで例外が出ても止まらない（非公開のウィンドウなど）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadConversations(historyKey("u1"))).toEqual([]);
    expect(saveConversations(historyKey("u1"), [conv("a", 1), conv("b", 2)])).toBe(false);
  });

  it("容量の上限で書けないときは、古い相談を減らして書き直す", () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if ((JSON.parse(v) as unknown[]).length > 2) throw new Error("QuotaExceededError");
      real.call(this, k, v);
    });
    const key = historyKey("u1");
    expect(saveConversations(key, [conv("a", 1), conv("b", 2), conv("c", 3), conv("d", 4)])).toBe(true);
    expect(loadConversations(key).map((c) => c.id)).toEqual(["d", "c"]);
  });
});

describe("trimConversations", () => {
  it(`相談は新しい ${MAX_CONVERSATIONS} 件まで、往復は新しい ${MAX_TURNS} 往復まで`, () => {
    const many = Array.from({ length: MAX_CONVERSATIONS + 3 }, (_, i) => conv(`c${i}`, i));
    const trimmed = trimConversations(many);
    expect(trimmed).toHaveLength(MAX_CONVERSATIONS);
    expect(trimmed[0]!.id).toBe(`c${MAX_CONVERSATIONS + 2}`);
    const long = conv("long", 1, Array.from({ length: MAX_TURNS + 2 }, (_, i) => turn(`q${i}`, answered(`a${i}`), i)));
    const t = trimConversations([long])[0]!.turns;
    expect(t).toHaveLength(MAX_TURNS);
    expect(t[0]!.question).toBe("q2");
  });
});

describe("日付の分け方", () => {
  const now = new Date(2026, 10, 7, 13, 5).getTime();
  it("今日・昨日・それより前（端末の時計の日付）", () => {
    expect(dayGroupOf(new Date(2026, 10, 7, 0, 0).getTime(), now)).toBe("today");
    expect(dayGroupOf(new Date(2026, 10, 6, 23, 59).getTime(), now)).toBe("yesterday");
    expect(dayGroupOf(new Date(2026, 10, 6, 0, 0).getTime(), now)).toBe("yesterday");
    expect(dayGroupOf(new Date(2026, 10, 5, 23, 59).getTime(), now)).toBe("earlier");
  });
  it("今日と昨日は時刻、それより前は月/日", () => {
    expect(whenLabel(new Date(2026, 10, 7, 9, 4).getTime(), now)).toBe("9:04");
    expect(whenLabel(new Date(2026, 10, 6, 18, 12).getTime(), now)).toBe("18:12");
    expect(whenLabel(new Date(2026, 10, 2, 11, 0).getTime(), now)).toBe("11/2");
  });
  it("往復の吹き出しは、今日は時刻、昨日より前は日付と時刻", () => {
    expect(turnTimeLabel(new Date(2026, 10, 7, 9, 4).getTime(), now)).toBe("9:04");
    expect(turnTimeLabel(new Date(2026, 10, 6, 18, 12).getTime(), now)).toBe("11/6 18:12");
  });
});

describe("一覧の札と検索", () => {
  const withStats = { ...answered("a"), stats: { title: "t" } as unknown as ConsultAskResponse["stats"] };
  const boots = { ...conv("boots", 3), title: "長靴・服", topicId: "boots-clothes" };
  const legacy = { ...conv("legacy", 2), title: "防鳥ネット・鶏舎の破れ" }; // topicId ができる前の記録
  const free = { ...conv("free", 1, [turn("岡山県では何件？", withStats), turn("ＡＢＣ の長靴は？", answered("b"))]), title: "岡山県では何件？" };

  it("札: 話題（topicId か、題が話題の名前と同じ）か自由な相談、件数の表があれば発生の件数も", () => {
    expect(tagsOf(boots)).toEqual(["boots-clothes"]);
    expect(tagsOf(legacy)).toEqual(["net-house"]);
    expect(tagsOf(free)).toEqual([TAG_FREE, TAG_STATS]);
  });

  it("札ごとの数は話題の並び・発生の件数・自由な相談の順で、0 件の札は出さない", () => {
    expect(tagCounts([boots, legacy, free])).toEqual([
      { tag: "boots-clothes", count: 1 },
      { tag: "net-house", count: 1 },
      { tag: TAG_STATS, count: 1 },
      { tag: TAG_FREE, count: 1 },
    ]);
  });

  it("検索は題と聞いた文に含まれるか（全角半角・大文字小文字を区別しない）。札と重ねて絞れる", () => {
    const all = [boots, legacy, free];
    expect(filterConversations(all, "abc", null).map((c) => c.id)).toEqual(["free"]);
    expect(filterConversations(all, "長靴", null).map((c) => c.id)).toEqual(["boots", "free"]);
    expect(filterConversations(all, "長靴", TAG_STATS).map((c) => c.id)).toEqual(["free"]);
    expect(filterConversations(all, "  ", "net-house").map((c) => c.id)).toEqual(["legacy"]);
  });

  it("topicId は保存して読み戻せる（文字でなければ捨てる）", () => {
    const key = historyKey("u1");
    saveConversations(key, [boots, { ...legacy, topicId: 3 as unknown as string }]);
    const back = loadConversations(key);
    expect(back.find((c) => c.id === "boots")!.topicId).toBe("boots-clothes");
    expect("topicId" in back.find((c) => c.id === "legacy")!).toBe(false);
  });
});


describe("今回使った条件（farm）の記録", () => {
  it("条件の付いた答えは、条件ごと保存して読み戻せる。条件のない古い記録もそのまま読み込める", () => {
    const key = historyKey("u1");
    const withFarm = { ...answered("答え"), farm: { production: "layer", rearing: "floor" } } as ConsultAskResponse;
    saveConversations(key, [conv("条件あり", 2, [turn("平飼いの長靴は？", withFarm)]), conv("古い", 1)]);
    const back = loadConversations(key);
    expect(back.find((c) => c.id === "条件あり")!.turns[0]!.result.farm).toEqual({ production: "layer", rearing: "floor" });
    expect("farm" in back.find((c) => c.id === "古い")!.turns[0]!.result).toBe(false);
  });

  it("片方だけの条件も読み込める。形の違う条件（列挙の外、余計な項目、空）の往復は捨てる", () => {
    const key = historyKey("u1");
    const r = (farm: unknown) => ({ ...answered("答え"), farm }) as unknown as ConsultAskResponse;
    localStorage.setItem(
      key,
      JSON.stringify([
        conv("片方", 5, [turn("q", r({ rearing: "cage" }))]),
        conv("列挙の外", 4, [turn("q", r({ rearing: "open" }))]),
        conv("余計な項目", 3, [turn("q", r({ production: "layer", name: "A 農場" }))]),
        conv("空", 2, [turn("q", r({}))]),
      ]),
    );
    const back = loadConversations(key);
    expect(back.map((c) => c.id)).toEqual(["片方"]);
    expect(back[0]!.turns[0]!.result.farm).toEqual({ rearing: "cage" });
  });

  it("羽数の幅（scale）の付いた条件も読み戻せる。幅のない前からの記録もそのまま読める。列挙の外の幅や正確な羽数の往復は捨てる", () => {
    const key = historyKey("u1");
    const r = (farm: unknown) => ({ ...answered("答え"), farm }) as unknown as ConsultAskResponse;
    localStorage.setItem(
      key,
      JSON.stringify([
        conv("幅あり", 5, [turn("q", r({ production: "layer", rearing: "floor", scale: "1000to3000" }))]),
        conv("幅なし", 4, [turn("q", r({ production: "layer", rearing: "floor" }))]),
        conv("列挙の外の幅", 3, [turn("q", r({ production: "layer", scale: "huge" }))]),
        conv("正確な羽数", 2, [turn("q", r({ production: "layer", flockSize: 1900 }))]),
      ]),
    );
    const back = loadConversations(key);
    expect(back.map((c) => c.id)).toEqual(["幅あり", "幅なし"]);
    expect(back[0]!.turns[0]!.result.farm).toEqual({ production: "layer", rearing: "floor", scale: "1000to3000" });
    expect(back[1]!.turns[0]!.result.farm).toEqual({ production: "layer", rearing: "floor" });
  });

  it("続けて聞くときに渡す前の往復には、条件を入れない（問いと答えだけ）", () => {
    const withFarm = { ...answered("a1"), farm: { production: "layer" } } as ConsultAskResponse;
    expect(historyForAsk([turn("1", withFarm)])).toEqual([{ question: "1", answer: "a1" }]);
  });
});
