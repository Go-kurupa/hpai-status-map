import { describe, expect, it } from "vitest";
import { extractAnnouncedOn } from "../src/read/announcedOn";

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
