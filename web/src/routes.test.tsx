import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { createMemoryRouter, matchRoutes, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./routes";

afterEach(cleanup);

const SRC = import.meta.dirname;

// 契約 6.3 と W-01 の経路の表
const ALL_PATHS = [
  "/",
  "/public",
  "/area/13101",
  "/poster",
  "/known",
  "/todo",
  "/record",
  "/record/deaths",
  "/record/self-check",
  "/record/disinfection",
  "/settings/farm",
  "/settings/notify",
  "/settings/explainer",
  "/login",
  "/join/abc123",
  "/operator",
  "/replay",
  "/replay/backstage",
  "/sample",
  "/sample/todo",
  "/sample/record",
  "/sample/record/deaths",
  "/sample/record/self-check",
  "/sample/record/disinfection",
  "/results",
  "/trends",
  "/privacy",
];

describe("経路", () => {
  it.each(ALL_PATHS)("%s は全受けの経路ではなく、決めた経路に当たる", (p) => {
    const matched = matchRoutes(routes, p);
    expect(matched, p).not.toBeNull();
    const leaf = matched![matched!.length - 1]!.route;
    expect(leaf.path).not.toBe("*");
  });

  it("知らない経路は『見つかりません』の画面になる", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/no-such-page"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeTruthy();
  });
});

describe("骨格", () => {
  it("メニューの自分の農場に『やること』『記録』『農場と知らせの設定』があり、header に『設定』がある。下のタブはない", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/todo"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "やること" });

    expect(screen.queryByRole("navigation", { name: "メイン" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "メニュー" });
    const todo = within(nav).getByRole("link", { name: /^やること/ });
    expect(todo.getAttribute("href")).toBe("/todo");
    expect(todo.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /^記録/ }).getAttribute("href")).toBe("/record/deaths");
    expect(within(nav).getByRole("link", { name: /^今季の発生と地図/ }).getAttribute("aria-current")).toBeNull();

    const settings = within(screen.getByRole("banner")).getByRole("link", { name: "設定" });
    expect(settings.getAttribute("href")).toBe("/settings/farm");
  });

  it("画面の本文は header と nav の外の main に出る", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/privacy"] });
    render(<RouterProvider router={router} />);
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "プライバシー" })).toBeTruthy();
  });
});

describe("公開の画面に Firebase を載せない", () => {
  const files = [
    "routes.tsx",
    "data/source.ts",
    "data/live.ts",
    "data/context.tsx",
    "pages/auth/firestoreRecordStore.ts",
    ...fs
      .readdirSync(path.join(SRC, "ui"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .map((f) => `ui/${f}`),
  ];

  it("対象のファイルがある", () => {
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) expect(fs.existsSync(path.join(SRC, f)), f).toBe(true);
  });

  it.each(files)("%s に firebase/ の静的 import がない（型だけの import type は可）", (f) => {
    const src = fs.readFileSync(path.join(SRC, f), "utf8");
    // import ... from "firebase/..." と、副作用だけの import "firebase/..."。import type は除く
    expect(src).not.toMatch(/^\s*(?:import|export)\s+(?!type\b)[^;"']*?from\s+["']firebase\//m);
    expect(src).not.toMatch(/^\s*import\s+["']firebase\//m);
    // firebase.ts 自体を静的に読んでも、公開の画面に Firebase が載る
    expect(src).not.toMatch(/^\s*(?:import|export)\s+(?!type\b)[^;"']*?from\s+["'](?:\.{1,2}\/)+firebase["']/m);
  });
});

describe("予期しない例外", () => {
  it("画面が投げても、英語の既定の画面ではなく、案内の文とトップへのリンクが出る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("GPUInitializationError: WebGL2 is required to display this map");
    };
    const root = routes[0]!;
    const router = createMemoryRouter([{ path: "/", element: root.element, errorElement: root.errorElement, children: [{ index: true, element: <Boom /> }] }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/表示中に問題が起きました。ページを開き直してください/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /トップ/ }).getAttribute("href")).toBe("/");
    expect(document.body.textContent).not.toMatch(/Unexpected Application Error|GPUInitializationError|WebGL/);
  });
});
