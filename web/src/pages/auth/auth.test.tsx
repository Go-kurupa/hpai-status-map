import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordStoreProvider } from "../../data/context";
import type { RecordStore } from "../../data/types";

// 呼ばれた順を 1 本の記録に残す（redeemInvite → getIdToken(true) → 画面の移動、の順を確かめる）
const calls: string[] = [];

interface FakeUser {
  uid: string;
  getIdToken: ReturnType<typeof vi.fn>;
  getIdTokenResult: ReturnType<typeof vi.fn>;
}
interface FakeAuth {
  currentUser: FakeUser | null;
  authStateReady: () => Promise<void>;
  onIdTokenChanged: (cb: (u: FakeUser | null) => void) => () => void;
}

let claimMember = false; // いまのトークンの member
let pendingMember = false; // getIdToken(true) で取り込まれる member
const listeners = new Set<(u: FakeUser | null) => void>();
const auth: FakeAuth = {
  currentUser: null,
  authStateReady: async () => {},
  onIdTokenChanged(cb) {
    listeners.add(cb);
    queueMicrotask(() => cb(auth.currentUser));
    return () => listeners.delete(cb);
  },
};

function makeUser(): FakeUser {
  return {
    uid: "u1",
    getIdToken: vi.fn(async (force?: boolean) => {
      calls.push(`getIdToken:${force}`);
      if (force) claimMember = pendingMember;
      return "token";
    }),
    getIdTokenResult: vi.fn(async () => ({ claims: { member: claimMember } })),
  };
}

const firebaseAuth = vi.hoisted(() => ({
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: vi.fn(),
  signInWithEmailLink: vi.fn(),
  signInWithPopup: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  sendSignInLinkToEmail: firebaseAuth.sendSignInLinkToEmail,
  isSignInWithEmailLink: firebaseAuth.isSignInWithEmailLink,
  signInWithEmailLink: firebaseAuth.signInWithEmailLink,
  signInWithPopup: firebaseAuth.signInWithPopup,
  GoogleAuthProvider: class GoogleAuthProvider {},
}));

const redeem = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn((_f: unknown, name: string) => (data: unknown) => redeem.fn(name, data)),
}));
vi.mock("../../firebase", () => ({
  getFirebase: async () => ({ auth, functions: {}, db: {}, app: {} }),
}));

import { afterSignIn, completeEmailLink, sendInviteLink, signInWithGoogle } from "./emailLink";
import JoinPage from "./JoinPage";
import LoginPage, { LOGIN_TEXT_CHECKED_ON, LoginText } from "./LoginPage";
import { RequireMember } from "./RequireMember";

const EMAIL_KEY = "hpai.emailForSignIn";
const MEMBER_KEY = "hpai.member.v1";

beforeEach(() => {
  calls.length = 0;
  claimMember = false;
  pendingMember = false;
  auth.currentUser = null;
  listeners.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  for (const f of Object.values(firebaseAuth)) f.mockReset();
  firebaseAuth.isSignInWithEmailLink.mockReturnValue(false);
  firebaseAuth.sendSignInLinkToEmail.mockImplementation(async () => {
    calls.push("sendSignInLinkToEmail");
  });
  redeem.fn.mockReset();
  redeem.fn.mockImplementation(async (_name: string, _data: unknown) => {
    calls.push("redeemInvite");
    pendingMember = true;
    return { data: { farmId: null } };
  });
});
afterEach(cleanup);

function LocationProbe() {
  const l = useLocation();
  return <p data-testid="at">{`${l.pathname}${l.search}`}</p>;
}

function mount(initial: string, extra: RouteObject[] = []) {
  const routes: RouteObject[] = [
    { path: "/login", element: <><LocationProbe /><LoginPage /></> },
    { path: "/join/:code", element: <><LocationProbe /><JoinPage /></> },
    { path: "/settings/farm", element: <><LocationProbe /><p>農場の設定の画面</p></> },
    { path: "/todo", element: <><LocationProbe /><p>やることの画面</p></> },
    ...extra,
  ];
  const router = createMemoryRouter(routes, { initialEntries: [initial] });
  return render(<RouterProvider router={router} />);
}

const at = () => screen.getByTestId("at").textContent;

describe("emailLink.ts", () => {
  const fakeAuth = {} as never;

  it("sendInviteLink: url は招待コードの /join/:code、なければ /login。location.search を保つ", async () => {
    window.history.replaceState({}, "", "/join/ABC?emulator=1");
    await sendInviteLink(fakeAuth, "a@example.test", "ABC");
    expect(firebaseAuth.sendSignInLinkToEmail).toHaveBeenLastCalledWith(
      fakeAuth,
      "a@example.test",
      expect.objectContaining({ url: `${location.origin}/join/ABC?emulator=1`, handleCodeInApp: true }),
    );
    await sendInviteLink(fakeAuth, "a@example.test", null);
    expect(firebaseAuth.sendSignInLinkToEmail).toHaveBeenLastCalledWith(
      fakeAuth,
      "a@example.test",
      expect.objectContaining({ url: `${location.origin}/login?emulator=1` }),
    );
  });

  it("sendInviteLink: Firebase がリンクに足した項目（oobCode など）は持ち越さない", async () => {
    window.history.replaceState({}, "", "/join/ABC?emulator=1&oobCode=old&mode=signIn&apiKey=k&lang=en");
    await sendInviteLink(fakeAuth, "a@example.test", "ABC");
    expect(firebaseAuth.sendSignInLinkToEmail).toHaveBeenLastCalledWith(
      fakeAuth,
      "a@example.test",
      expect.objectContaining({ url: `${location.origin}/join/ABC?emulator=1` }),
    );
  });

  it("sendInviteLink: 送れたらメールを localStorage の hpai.emailForSignIn に置く。送れなかったら置かない", async () => {
    await sendInviteLink(fakeAuth, "a@example.test", "ABC");
    expect(localStorage.getItem(EMAIL_KEY)).toBe("a@example.test");

    localStorage.clear();
    firebaseAuth.sendSignInLinkToEmail.mockRejectedValueOnce(new Error("network"));
    await expect(sendInviteLink(fakeAuth, "b@example.test", "ABC")).rejects.toThrow("network");
    expect(localStorage.getItem(EMAIL_KEY)).toBeNull();
  });

  it("completeEmailLink: メールのリンクでなければ null で、何もしない", async () => {
    const ask = vi.fn(async () => "x@example.test");
    expect(await completeEmailLink(fakeAuth, "https://hpai.example.test/login", ask)).toBeNull();
    expect(firebaseAuth.signInWithEmailLink).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("completeEmailLink: 端末に置いたメールがあれば聞かずに入り、入れたら消す", async () => {
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    firebaseAuth.signInWithEmailLink.mockResolvedValue({ user: { uid: "u1" } });
    localStorage.setItem(EMAIL_KEY, "saved@example.test");
    const ask = vi.fn(async () => "never@example.test");

    const user = await completeEmailLink(fakeAuth, "https://h.test/join/ABC?oobCode=1", ask);

    expect(user).toEqual({ uid: "u1" });
    expect(ask).not.toHaveBeenCalled();
    expect(firebaseAuth.signInWithEmailLink).toHaveBeenCalledWith(fakeAuth, "saved@example.test", "https://h.test/join/ABC?oobCode=1");
    expect(localStorage.getItem(EMAIL_KEY)).toBeNull();
  });

  it("completeEmailLink: localStorage が空なら、メールを聞き直してから signInWithEmailLink を呼ぶ", async () => {
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    const order: string[] = [];
    firebaseAuth.signInWithEmailLink.mockImplementation(async (_a: unknown, email: string) => {
      order.push(`signIn:${email}`);
      return { user: { uid: "u1" } };
    });
    const ask = vi.fn(async () => {
      order.push("ask");
      return "typed@example.test";
    });

    await completeEmailLink(fakeAuth, "https://h.test/join/ABC?oobCode=1", ask);

    expect(order).toEqual(["ask", "signIn:typed@example.test"]);
  });

  it("completeEmailLink: 失敗しても端末のメールは残す（もう一度試せる）", async () => {
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    firebaseAuth.signInWithEmailLink.mockRejectedValue(new Error("expired"));
    localStorage.setItem(EMAIL_KEY, "saved@example.test");
    await expect(completeEmailLink(fakeAuth, "https://h.test/login?oobCode=1", async () => "")).rejects.toThrow("expired");
    expect(localStorage.getItem(EMAIL_KEY)).toBe("saved@example.test");
  });

  it("signInWithGoogle: signInWithPopup に GoogleAuthProvider を渡し、利用者を返す", async () => {
    firebaseAuth.signInWithPopup.mockResolvedValue({ user: { uid: "g1" } });
    expect(await signInWithGoogle(fakeAuth)).toEqual({ uid: "g1" });
    const provider = firebaseAuth.signInWithPopup.mock.calls[0]![1] as { constructor: { name: string } };
    expect(provider.constructor.name).toBe("GoogleAuthProvider");
  });

  it("afterSignIn: code があれば redeem、そのあと getIdToken(true)。code がなければ redeem せず getIdToken(true) だけ", async () => {
    const user = makeUser();
    const r = vi.fn(async (_c: string) => {
      calls.push("redeem");
    });
    await afterSignIn(user as never, "CODE", r);
    expect(calls).toEqual(["redeem", "getIdToken:true"]);
    expect(r).toHaveBeenCalledWith("CODE");

    calls.length = 0;
    await afterSignIn(user as never, null, r);
    expect(calls).toEqual(["getIdToken:true"]);
    expect(r).toHaveBeenCalledTimes(1);
  });

  it("afterSignIn: redeem が失敗したら getIdToken を呼ばずに投げる", async () => {
    const user = makeUser();
    await expect(afterSignIn(user as never, "CODE", async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it("このフォルダとその設定の画面のソースに sessionStorage がない", () => {
    const dirs = [import.meta.dirname, path.join(import.meta.dirname, "../settings")];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
        expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toContain("sessionStorage");
      }
    }
  });
});

describe("/login", () => {
  it("説明の文、LINE の注意、確認日を出し、Google で入るボタンがある", async () => {
    mount("/login");
    expect(await screen.findByText("Google かメールのリンクで入ります。パスワードはいりません")).toBeTruthy();
    expect(screen.getByText("LINE の中で開くと Google が使えないことがあります。そのときはメールのリンクで入ってください")).toBeTruthy();
    expect(screen.getByText(/確認日/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google で入る" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ログインのリンクを送る" })).toBeTruthy();
  });

  it("確認日は定数 LOGIN_TEXT_CHECKED_ON。入っていればその日付を出す", () => {
    expect(LOGIN_TEXT_CHECKED_ON === null || /^\d{4}-\d{2}-\d{2}$/.test(LOGIN_TEXT_CHECKED_ON)).toBe(true);
    render(<LoginText checkedOn="2026-11-07" />);
    expect(screen.getByText("確認日 2026-11-07")).toBeTruthy();
  });

  it("画面の文に禁止語がない", async () => {
    const { container } = mount("/login");
    await screen.findByRole("button", { name: "Google で入る" });
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });

  it("メールを入れてリンクを送る。招待コードのない /login の url は /login", async () => {
    mount("/login");
    fireEvent.change(await screen.findByLabelText("メールアドレス"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインのリンクを送る" }));
    await screen.findByText(/メールを送りました/);
    expect(firebaseAuth.sendSignInLinkToEmail).toHaveBeenCalledWith(
      auth,
      "me@example.test",
      expect.objectContaining({ url: `${location.origin}/login` }),
    );
  });

  it("Google: redeemInvite を呼ばず、claim がなければ招待コードの入力欄へ進む", async () => {
    firebaseAuth.signInWithPopup.mockImplementation(async () => {
      calls.push("signInWithPopup");
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));

    expect(await screen.findByLabelText("招待コード")).toBeTruthy();
    expect(redeem.fn).not.toHaveBeenCalled();
    expect(calls).toEqual(["signInWithPopup", "getIdToken:true"]);
  });

  it("招待コードの欄の下に、見本の農場への案内を出す。文に禁止語がない", async () => {
    firebaseAuth.signInWithPopup.mockImplementation(async () => {
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    const { container } = mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    await screen.findByLabelText("招待コード");
    expect(screen.getByText(/招待コードは運営者から受け取ります/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "見本の農場で試す" }).getAttribute("href")).toBe("/sample");
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });

  it("Google: すでに会員なら /todo へ進む", async () => {
    pendingMember = true;
    claimMember = false;
    firebaseAuth.signInWithPopup.mockImplementation(async () => {
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    await waitFor(() => expect(at()).toBe("/todo"));
    expect(redeem.fn).not.toHaveBeenCalled();
  });

  it("Google: 用意が済んでいれば、押した操作の流れの中（await の前）で signInWithPopup を呼ぶ", async () => {
    firebaseAuth.signInWithPopup.mockImplementation(() => new Promise(() => {})); // 結果は待たない
    mount("/login");
    const button = await screen.findByRole("button", { name: "Google で入る" });
    await new Promise((r) => setTimeout(r, 0)); // 表示のとき始めた Firebase の用意が済むのを待つ
    fireEvent.click(button);
    expect(firebaseAuth.signInWithPopup).toHaveBeenCalledTimes(1); // await を挟まず、その場で
    expect(firebaseAuth.signInWithPopup.mock.calls[0]![0]).toBe(auth);
  });

  it("Google: 用意がまだなら、用意ができてから signInWithPopup を呼ぶ", async () => {
    firebaseAuth.signInWithPopup.mockImplementation(() => new Promise(() => {}));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    await waitFor(() => expect(firebaseAuth.signInWithPopup).toHaveBeenCalledTimes(1));
  });

  it("Google のポップアップが止められたら、もう一度押す案内と符号を出し、redeemInvite も呼ばない", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("blocked"), { code: "auth/popup-blocked" }));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    expect(
      await screen.findByText("ログインの窓が開けませんでした。もう一度「Google で入る」を押してください（auth/popup-blocked）"),
    ).toBeTruthy();
    expect(redeem.fn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Google で入る" })).toBeTruthy(); // 画面は生きている
  });

  it("Google の失敗は、メールのリンクの案内の後ろに符号を添える", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("x"), { code: "auth/unauthorized-domain" }));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    expect(await screen.findByText("メールのリンクで入ってください（auth/unauthorized-domain）")).toBeTruthy();
  });

  it("Google の失敗に code がなければ、今までの文だけ（符号なし）", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(new Error("boom"));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("メールのリンクで入ってください");
  });

  it("Google の失敗の code が auth/ で始まらなければ、符号は添えない", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("x"), { code: "me@example.test" }));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("メールのリンクで入ってください");
  });

  it("Google の窓を自分で閉じたときは「ログインをやめました」だけ（符号なし）", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("x"), { code: "auth/popup-closed-by-user" }));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("ログインをやめました");
  });

  it("Google の窓の重ね押し（auth/cancelled-popup-request）では文を出さない", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("x"), { code: "auth/cancelled-popup-request" }));
    mount("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    await waitFor(() => expect(firebaseAuth.signInWithPopup).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole("button", { name: "Google で入る" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ログイン済みで claim がなければ、招待コードの入力欄を出す。入れると redeemInvite、getIdToken(true) の順で /settings/farm", async () => {
    auth.currentUser = makeUser();
    mount("/login");
    fireEvent.change(await screen.findByLabelText("招待コード"), { target: { value: " MYCODE " } });
    fireEvent.click(screen.getByRole("button", { name: "このコードで入る" }));
    await waitFor(() => expect(at()).toBe("/settings/farm"));
    expect(calls).toEqual(["redeemInvite", "getIdToken:true"]);
    expect(redeem.fn).toHaveBeenCalledWith("redeemInvite", { code: "MYCODE" });
  });

  it("コードが使えないときの文は『このコードは使えません』だけ（理由を分けない）", async () => {
    redeem.fn.mockRejectedValue(Object.assign(new Error("long server message"), { code: "functions/resource-exhausted" }));
    auth.currentUser = makeUser();
    mount("/login");
    fireEvent.change(await screen.findByLabelText("招待コード"), { target: { value: "WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "このコードで入る" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("このコードは使えません");
    expect(at()).toBe("/login");
  });

  it("メールのリンクで開いたら、端末にメールがなければ聞き直し、入れてから会員にする", async () => {
    window.history.replaceState({}, "", "/login?oobCode=abc&mode=signIn");
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    firebaseAuth.signInWithEmailLink.mockImplementation(async (_a: unknown, email: string) => {
      calls.push(`signInWithEmailLink:${email}`);
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/login?oobCode=abc&mode=signIn");

    fireEvent.change(await screen.findByLabelText("ログインに使うメールアドレス"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "つづける" }));

    expect(await screen.findByLabelText("招待コード")).toBeTruthy(); // claim がないので入力欄
    expect(calls).toEqual(["signInWithEmailLink:me@example.test", "getIdToken:true"]);
  });
});

describe("/join/:code", () => {
  it("Google で入るボタンがあり、メールのリンクの url に招待コードが入る", async () => {
    mount("/join/CODE123");
    expect(await screen.findByRole("button", { name: "Google で入る" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインのリンクを送る" }));
    await screen.findByText(/メールを送りました/);
    expect(firebaseAuth.sendSignInLinkToEmail).toHaveBeenCalledWith(
      auth,
      "me@example.test",
      expect.objectContaining({ url: `${location.origin}/join/CODE123` }),
    );
  });

  it("Google: signInWithPopup、redeemInvite、getIdToken(true)、/settings/farm の順", async () => {
    firebaseAuth.signInWithPopup.mockImplementation(async () => {
      calls.push("signInWithPopup");
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/join/CODE123");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    await waitFor(() => expect(at()).toBe("/settings/farm"));
    expect(calls).toEqual(["signInWithPopup", "redeemInvite", "getIdToken:true"]);
    expect(redeem.fn).toHaveBeenCalledWith("redeemInvite", { code: "CODE123" });
  });

  it("Google のポップアップの失敗は redeemInvite を呼ばず、メールのリンクを案内する", async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(Object.assign(new Error("x"), { code: "auth/popup-blocked" }));
    mount("/join/CODE123");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    expect(await screen.findByText("ログインの窓が開けませんでした。もう一度「Google で入る」を押してください（auth/popup-blocked）")).toBeTruthy();
    expect(redeem.fn).not.toHaveBeenCalled();
    expect(at()).toBe("/join/CODE123");
  });

  it("メールのリンクで開く: signInWithEmailLink、redeemInvite、getIdToken(true)、/settings/farm の順。端末のメールがあれば聞かない", async () => {
    window.history.replaceState({}, "", "/join/CODE123?oobCode=abc&mode=signIn");
    localStorage.setItem(EMAIL_KEY, "me@example.test");
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    firebaseAuth.signInWithEmailLink.mockImplementation(async () => {
      calls.push("signInWithEmailLink");
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/join/CODE123?oobCode=abc&mode=signIn");
    await waitFor(() => expect(at()).toBe("/settings/farm"));
    expect(calls).toEqual(["signInWithEmailLink", "redeemInvite", "getIdToken:true"]);
  });

  it("メールのリンクで開く: 別の端末（localStorage が空）ならメールを聞き直す。招待コードは保たれる", async () => {
    window.history.replaceState({}, "", "/join/CODE123?oobCode=abc&mode=signIn");
    firebaseAuth.isSignInWithEmailLink.mockReturnValue(true);
    firebaseAuth.signInWithEmailLink.mockImplementation(async () => {
      calls.push("signInWithEmailLink");
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/join/CODE123?oobCode=abc&mode=signIn");
    fireEvent.change(await screen.findByLabelText("ログインに使うメールアドレス"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "つづける" }));
    await waitFor(() => expect(at()).toBe("/settings/farm"));
    expect(redeem.fn).toHaveBeenCalledWith("redeemInvite", { code: "CODE123" });
  });

  it("コードが使えないときは『このコードは使えません』だけ。会員にはならず、画面にとどまる", async () => {
    redeem.fn.mockRejectedValue(Object.assign(new Error("expired"), { code: "functions/failed-precondition" }));
    firebaseAuth.signInWithPopup.mockImplementation(async () => {
      auth.currentUser = makeUser();
      return { user: auth.currentUser };
    });
    mount("/join/BAD");
    fireEvent.click(await screen.findByRole("button", { name: "Google で入る" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("このコードは使えません");
    expect(at()).toBe("/join/BAD");
  });

  it("ログイン済みで会員でない人が開くと、そのコードで入るボタンを出す", async () => {
    auth.currentUser = makeUser();
    mount("/join/CODE123");
    fireEvent.click(await screen.findByRole("button", { name: "このコードで入る" }));
    await waitFor(() => expect(at()).toBe("/settings/farm"));
    expect(calls).toEqual(["redeemInvite", "getIdToken:true"]);
  });
});

// 入る方法の並び（2026-11-07 精査 J1・J2）。いちばん手早い Google を主のボタンにして先に置き、メールのリンクは「または」の後
describe("入る方法の並びと、リンクを送った後の文", () => {
  const LINE_NOTE = "LINE の中で開くと Google が使えないことがあります。そのときはメールのリンクで入ってください";
  /** a が b より前にある（文書の順） */
  const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  for (const page of ["/join/CODE123", "/login"]) {
    it(`${page}: Google で入る（主のボタン）→ または → LINE の注 → メール欄 → ログインのリンクを送る（二次のボタン）`, async () => {
      mount(page);
      const google = await screen.findByRole("button", { name: "Google で入る" });
      const or = screen.getByText("または");
      const note = screen.getByText(LINE_NOTE);
      const input = screen.getByLabelText("メールアドレス");
      const send = screen.getByRole("button", { name: "ログインのリンクを送る" });
      expect(before(google, or)).toBe(true);
      expect(before(or, note)).toBe(true);
      expect(before(note, input)).toBe(true);
      expect(before(input, send)).toBe(true);
      expect(google.classList.contains("btn-primary")).toBe(true);
      expect(send.classList.contains("btn-primary")).toBe(false);
      expect(screen.getAllByText(LINE_NOTE)).toHaveLength(1); // 注は 1 回だけ
    });
  }

  it("/join/:code: h1 の下に、会員になると使えることを書く", async () => {
    mount("/join/CODE123");
    const h1 = await screen.findByRole("heading", { level: 1, name: "招待コードで登録" });
    const lead = h1.nextElementSibling;
    expect(lead?.textContent).toBe("入ると、農場の設定・死亡や消毒の記録・対策項目・AI への相談が使えます。パスワードはいりません");
    expect(screen.queryByText(/招待されたので/)).toBeNull();
  });

  it("リンクを送った後の文は、枠付き・太字の 1 文（role=status）", async () => {
    mount("/join/CODE123");
    fireEvent.change(await screen.findByLabelText("メールアドレス"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ログインのリンクを送る" }));
    const sent = await screen.findByText(/メールを送りました/);
    expect(sent.textContent).toBe("メールを送りました。届いたリンクをおしてください。届かないときは迷惑メールも見てください");
    expect(sent.getAttribute("role")).toBe("status");
    expect(sent.classList.contains("auth-sent")).toBe(true);
    // jsdom は css を当てないので、規則を読んで確かめる。色は theme.css の変数
    const css = fs.readFileSync(path.join(import.meta.dirname, "auth.css"), "utf8");
    const rule = css.match(/\.auth-sent\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/border:\s*2px solid var\(--[a-z0-9-]+\)/);
    expect(rule).toMatch(/font-weight:\s*700/);
  });
});

describe("RequireMember", () => {
  function store(mode: RecordStore["mode"]): RecordStore {
    return { mode } as RecordStore;
  }
  function gate(mode: RecordStore["mode"], initial = "/settings/farm") {
    const routes: RouteObject[] = [
      {
        path: "/settings/farm",
        element: (
          <RecordStoreProvider value={store(mode)}>
            <RequireMember>
              <p>会員の中身</p>
            </RequireMember>
          </RecordStoreProvider>
        ),
      },
      { path: "/login", element: <LocationProbe /> },
    ];
    return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [initial] })} />);
  }

  it("見本の農場（sample）は素通し。Firebase を読まない", async () => {
    gate("sample");
    expect(await screen.findByText("会員の中身")).toBeTruthy();
    expect(listeners.size).toBe(0);
  });

  it("未ログインは /login へ。location.search を保つ", async () => {
    gate("firestore", "/settings/farm?emulator=1");
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe("/login?emulator=1"));
  });

  it("claim がなければ招待コードの入力欄", async () => {
    auth.currentUser = makeUser();
    gate("firestore");
    expect(await screen.findByLabelText("招待コード")).toBeTruthy();
    expect(screen.queryByText("会員の中身")).toBeNull();
  });

  it("招待コードの欄の下に、コードの受け取り方と見本の農場への案内を出す（コードがない人の行き止まりにしない）", async () => {
    auth.currentUser = makeUser();
    gate("firestore");
    await screen.findByLabelText("招待コード");
    expect(screen.getByText(/招待コードは運営者から受け取ります/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "見本の農場で試す" }).getAttribute("href")).toBe("/sample");
  });

  it("会員なら中身を出す", async () => {
    claimMember = true;
    auth.currentUser = makeUser();
    gate("firestore");
    expect(await screen.findByText("会員の中身")).toBeTruthy();
  });

  it("claim がなくて招待コードを入れ、通ると中身が出る（再読み込みなし）", async () => {
    auth.currentUser = makeUser();
    gate("firestore");
    fireEvent.change(await screen.findByLabelText("招待コード"), { target: { value: "GOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "このコードで入る" }));
    expect(await screen.findByText("会員の中身")).toBeTruthy();
    expect(calls).toEqual(["redeemInvite", "getIdToken:true"]);
  });

  it("ログイン状態を確かめられなければ、招待コードではなく読めなかったと伝える", async () => {
    auth.currentUser = makeUser();
    auth.currentUser.getIdTokenResult.mockRejectedValue(new Error("network"));
    gate("firestore");
    expect((await screen.findByRole("alert")).textContent).toMatch(/確かめられませんでした/);
    expect(screen.queryByLabelText("招待コード")).toBeNull();
  });

  // 端末に残す会員の印（決定 15）。メニューの出し分けだけに使う
  it("会員と確かめられたら会員の印を付け、未ログインと分かったら外す", async () => {
    claimMember = true;
    auth.currentUser = makeUser();
    gate("firestore");
    await screen.findByText("会員の中身");
    expect(localStorage.getItem(MEMBER_KEY)).toBe("1");
    cleanup();
    auth.currentUser = null;
    gate("firestore");
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe("/login"));
    expect(localStorage.getItem(MEMBER_KEY)).toBeNull();
  });

  it("ログインしていても claim がなければ会員の印を外す", async () => {
    localStorage.setItem(MEMBER_KEY, "1");
    auth.currentUser = makeUser();
    gate("firestore");
    await screen.findByLabelText("招待コード");
    expect(localStorage.getItem(MEMBER_KEY)).toBeNull();
  });

  it("ログイン状態を確かめられないときは、会員の印を外さない（通信の失敗は会員でないことではない）", async () => {
    localStorage.setItem(MEMBER_KEY, "1");
    auth.currentUser = makeUser();
    auth.currentUser.getIdTokenResult.mockRejectedValue(new Error("network"));
    gate("firestore");
    await screen.findByRole("alert");
    expect(localStorage.getItem(MEMBER_KEY)).toBe("1");
  });

  it("見本の農場は Firebase を読まないので、会員の印に触らない", async () => {
    localStorage.setItem(MEMBER_KEY, "1");
    gate("sample");
    await screen.findByText("会員の中身");
    expect(localStorage.getItem(MEMBER_KEY)).toBe("1");
  });
});
