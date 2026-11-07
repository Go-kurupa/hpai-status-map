import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CMP_TEXT } from "./compareTexts";
import { regionMuniCodes, ScopeButtons } from "./ScopeButtons";

afterEach(cleanup);

describe("regionMuniCodes", () => {
  it("地方の県の町だけを返す", () => {
    expect(regionMuniCodes("chugoku", ["01100", "31201", "33203", "35201", "36201"])).toEqual(["31201", "33203", "35201"]);
    expect(regionMuniCodes("hokkaido", ["01100", "02201"])).toEqual(["01100"]);
  });
});

describe("ScopeButtons", () => {
  it("1 段に［選んだ地域の付近］［全国］と 8 地方。押された印は 1 つだけ", () => {
    const onRegion = vi.fn();
    render(<ScopeButtons hasNear picked="chugoku" onNear={() => {}} onJapan={() => {}} onRegion={onRegion} />);
    const group = screen.getByRole("group", { name: CMP_TEXT.scopeAria });
    const names = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["選んだ地域の付近", "全国", "北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"]);
    expect(within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual(["中国"]);
    fireEvent.click(within(group).getByRole("button", { name: "近畿" }));
    expect(onRegion).toHaveBeenCalledWith("kinki");
  });

  it("地域を選んでいなければ［選んだ地域の付近］を出さない", () => {
    render(<ScopeButtons hasNear={false} picked="japan" onNear={() => {}} onJapan={() => {}} onRegion={() => {}} />);
    expect(screen.queryByRole("button", { name: CMP_TEXT.scopeNear })).toBeNull();
    expect(screen.getByRole("button", { name: CMP_TEXT.scopeJapan }).getAttribute("aria-pressed")).toBe("true");
  });

  it("鶏舎の場所を決めていれば［鶏舎の付近］と呼ぶ（作者 11/7）", () => {
    render(<ScopeButtons hasNear nearIsFarm picked="near" onNear={() => {}} onJapan={() => {}} onRegion={() => {}} />);
    expect(screen.getByRole("button", { name: "鶏舎の付近" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: CMP_TEXT.scopeNear })).toBeNull();
  });
});
