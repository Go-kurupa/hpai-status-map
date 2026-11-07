import { describe, expect, it } from "vitest";
import { GeoNotLoadedError } from "../src/geo";
import { DEFAULT_NOTIFY_FIXTURE, fakeGeo, farmFixture, GEO_A, GEO_D } from "./helpers/mFixtures";

describe("fakeGeo", () => {
  it("県を読む前の geometry は GeoNotLoadedError", () => {
    expect(() => fakeGeo().geometry(GEO_A)).toThrow(GeoNotLoadedError);
  });

  it("ensurePrefs(['33']) の後は 33 の町が読み込め、別の県の町はまだ投げる", async () => {
    const geo = fakeGeo();
    await geo.ensurePrefs(["33"]);
    expect(geo.geometry(GEO_A).properties.c).toBe(GEO_A);
    expect(() => geo.geometry(GEO_D)).toThrow(GeoNotLoadedError);
  });
});

describe("farmFixture", () => {
  it("ルールの形（全キー、メッシュ 8 桁）で、上書きできる", () => {
    const f = farmFixture("alice", { name: "上書き" });
    expect(Object.keys(f).sort()).toEqual(
      [
        "frequentMuniCodes", "housing", "kahoContact", "meshCode", "memberUids", "muniCode", "name", "notify",
        "prefCode", "production", "selfCheckDue", "unsubscribedUids", "updatedAt",
      ].sort(),
    );
    expect(f.memberUids).toEqual(["alice"]);
    expect(f.name).toBe("上書き");
    expect(f.meshCode).toMatch(/^[0-9]{8}$/);
    expect(f.notify).toEqual(DEFAULT_NOTIFY_FIXTURE);
  });
});
