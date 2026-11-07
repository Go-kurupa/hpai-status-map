import { describe, expect, it } from "vitest";
import { extractAnnouncedOn, parseIso8601Date, parseRfc822Date } from "../src/read/announcedOn";

describe("extractAnnouncedOn: 文書の発表日（取り出せなければ null）", () => {
  it("ラベルつきの日付（掲載日、発表日、公表日、公開日、報道発表日）を取る。令和、西暦、スラッシュに対応", () => {
    expect(extractAnnouncedOn("掲載日：令和7年12月20日\n本日、津山市の農場で")).toBe("2025-12-20");
    expect(extractAnnouncedOn("発表日 2025年12月20日")).toBe("2025-12-20");
    expect(extractAnnouncedOn("公表日: 2025/12/9")).toBe("2025-12-09");
    expect(extractAnnouncedOn("報道発表日：２０２５－１２－２０")).toBe("2025-12-20");
    expect(extractAnnouncedOn("公開日：令和７年１２月２０日")).toBe("2025-12-20");
  });
  it("更新日や、ラベルのない日付は取らない（発表日とは限らない）", () => {
    expect(extractAnnouncedOn("更新日：令和7年12月21日\n令和7年12月20日、検査を行いました")).toBeNull();
    expect(extractAnnouncedOn("本日、津山市の農場で疑似患畜を確認しました。")).toBeNull();
  });
  it("ラベルつきの日付が食い違えば null（どちらか決めない）。同じ日付の繰り返しは取る", () => {
    expect(extractAnnouncedOn("掲載日：令和7年12月20日 発表日：令和7年12月21日")).toBeNull();
    expect(extractAnnouncedOn("掲載日：令和7年12月20日 発表日：令和7年12月20日")).toBe("2025-12-20");
  });
  it("実在しない日付は null", () => {
    expect(extractAnnouncedOn("掲載日：令和7年2月30日")).toBeNull();
    expect(extractAnnouncedOn("掲載日：令和7年13月1日")).toBeNull();
  });
  it("国の報道発表は、見出しの日付（農林水産省の直前）を取る。国以外では使わない", () => {
    const maff = "岡山県における高病原性鳥インフルエンザの疑似患畜の確認について\n令和7年12月20日\n農林水産省\n本日、岡山県津山市の";
    expect(extractAnnouncedOn(maff, { maff: true })).toBe("2025-12-20");
    expect(extractAnnouncedOn(maff)).toBeNull();
  });
});

describe("extractAnnouncedOn: 公開日と更新日の併記", () => {
  it("公開日と別の更新日が併記されていれば、公開日を採る", () => {
    expect(extractAnnouncedOn("公開日：令和7年12月20日\n最終更新日：令和7年12月25日\n本日、")).toBe("2025-12-20");
    expect(extractAnnouncedOn("更新日：令和7年12月25日 掲載日：令和7年12月20日")).toBe("2025-12-20");
  });
});

describe("parseRfc822Date: pubDate を厳密に読む（日本時間の日付）", () => {
  it("曜日つき、なし、ゾーンの各種を日本時間の日付にする", () => {
    expect(parseRfc822Date("Sat, 20 Dec 2025 01:00:00 +0900")).toBe("2025-12-20");
    expect(parseRfc822Date("Sat, 20 Dec 2025 01:00:00 GMT")).toBe("2025-12-20");
    expect(parseRfc822Date("Fri, 19 Dec 2025 15:00:00 GMT")).toBe("2025-12-20"); // 日本時間 0 時
    expect(parseRfc822Date("Fri, 19 Dec 2025 14:59:59 GMT")).toBe("2025-12-19");
    expect(parseRfc822Date("20 Dec 2025 23:30 +0900")).toBe("2025-12-20");
    expect(parseRfc822Date("Sat, 20 Dec 2025 10:00:00 -0500")).toBe("2025-12-21");
    expect(parseRfc822Date("Sat, 20 Dec 25 10:00:00 UT")).toBe("2025-12-20");
  });
  it("ゾーンがなければ日本時間として読む（15 時以降でも日付が進まない）", () => {
    expect(parseRfc822Date("Sat, 20 Dec 2025 16:00:00")).toBe("2025-12-20");
    expect(parseRfc822Date("Sat, 20 Dec 2025 23:59:59")).toBe("2025-12-20");
  });
  it("読み込めない、実在しない、緩い書き方は null", () => {
    for (const bad of ["", "いつか", "2025-12-20", "Sat, 32 Dec 2025 10:00:00 GMT", "Sat, 20 Foo 2025 10:00:00 GMT", "Sat, 20 Dec 2025 25:00:00 GMT", "Sat, 29 Feb 2025 10:00:00 GMT", "Sat, 20 Dec 2025 10:00:00 +9", "20 Dec 2025", "Dec 20 2025 10:00:00 GMT"]) {
      expect(parseRfc822Date(bad), bad).toBeNull();
    }
  });
});

describe("parseIso8601Date: published を厳密に読む（日本時間の日付）", () => {
  it("オフセット、Z、小数秒を日本時間の日付にする", () => {
    expect(parseIso8601Date("2025-12-20T09:00:00+09:00")).toBe("2025-12-20");
    expect(parseIso8601Date("2025-12-19T15:00:00Z")).toBe("2025-12-20");
    expect(parseIso8601Date("2025-12-19T14:59:59.999Z")).toBe("2025-12-19");
    expect(parseIso8601Date("2025-12-20T10:00:00-05:00")).toBe("2025-12-21");
    expect(parseIso8601Date("2025-12-20T10:00+0900")).toBe("2025-12-20");
  });
  it("ゾーンがなければ日本時間として読む（16:00 でも +9 時間しない）", () => {
    expect(parseIso8601Date("2025-12-20T16:00:00")).toBe("2025-12-20");
    expect(parseIso8601Date("2025-12-20T23:59:59")).toBe("2025-12-20");
    expect(parseIso8601Date("2025-12-20")).toBe("2025-12-20");
  });
  it("読み込めない、実在しないは null", () => {
    for (const bad of ["", "いつか", "2025-13-01", "2025-02-30", "2025-12-20T25:00:00Z", "2025/12/20", "20251220", "2025-12-20 10:00:00 +0900x", "Sat, 20 Dec 2025 01:00:00 GMT"]) {
      expect(parseIso8601Date(bad), bad).toBeNull();
    }
  });
});
