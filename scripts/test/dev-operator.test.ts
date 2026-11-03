import { describe, expect, it, vi } from "vitest";
import { actionsFor } from "@hpai/shared/read/review";
import type { ReviewItem } from "@hpai/shared/read/types";
import { buildSamples, checkEmulatorEnv, devUrl, runDevOperator } from "../dev-operator";

const NOW = new Date("2026-11-05T03:00:00Z");
const EMU = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };

describe("checkEmulatorEnv（模擬環境の変数がなければ止まる）", () => {
  it("2 つの変数がそろっていれば null", () => {
    expect(checkEmulatorEnv(EMU)).toBeNull();
  });
  it.each([
    ["Firestore の変数がない", { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }],
    ["Auth の変数がない", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
    ["どちらもない", {}],
    ["空の値", { FIRESTORE_EMULATOR_HOST: "", FIREBASE_AUTH_EMULATOR_HOST: "" }],
  ])("%s は理由を返す", (_n, env) => {
    expect(checkEmulatorEnv(env)).toMatch(/模擬環境/);
  });
  it("本番の project を指していれば止まる", () => {
    expect(checkEmulatorEnv({ ...EMU, GCLOUD_PROJECT: "real-project" })).toMatch(/demo-/);
    expect(checkEmulatorEnv({ ...EMU, GCLOUD_PROJECT: "demo-hpai" })).toBeNull();
  });
});

describe("buildSamples", () => {
  const samples = buildSamples(NOW);
  const items = samples.filter((s) => s.path.startsWith("reviewQueue/")).map((s) => s.data as ReviewItem);

  it("箱の見本は、文書、入口の提案、7 種類の知らせを含み、未解決で、id が重ならない", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => i.resolvedAt === null)).toBe(true);
    expect(items.filter((i) => i.kind === "document").length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.kind === "entrance_proposal")).toBe(true);
    const alerts = items.flatMap((i) => (i.kind === "alert" ? [i.alert] : []));
    expect([...alerts].sort()).toEqual(["agent_run_failed", "app_only_confirmed", "case_stalled", "mail_failing", "national_missing", "negation_candidate", "watch_failing"]);
    for (const i of items) expect(actionsFor(i).length).toBeLessThanOrEqual(2);
  });
  it("書く場所は reviewQueue と、操作を試すための documents、cases、sources だけ（farms を作らない）", () => {
    for (const s of samples) expect(s.path).toMatch(/^(reviewQueue|documents|cases|sources)\//);
  });
  it("実在の人や農場を使わない（example.test と架空の値だけ）", () => {
    const text = JSON.stringify(samples);
    expect(text).not.toMatch(/@(?!example\.test)/);
    for (const i of items) if (i.kind === "document") expect(i.url).toMatch(/^https:\/\/example\.test\//);
  });
});

describe("devUrl", () => {
  it("?emulator=1&devToken= の URL を作る（LAN の IP で）", () => {
    expect(devUrl("192.168.3.21", "tok en")).toBe("http://192.168.3.21:5173/operator?emulator=1&devToken=tok%20en");
  });
});

describe("runDevOperator", () => {
  function fakeAdmin() {
    const writes: string[] = [];
    return {
      writes,
      auth: {
        createUser: vi.fn(async (_p: { uid: string; email: string }) => ({ uid: "dev-operator" })),
        setCustomUserClaims: vi.fn(async () => {}),
        createCustomToken: vi.fn(async (_uid: string, _claims: Record<string, unknown>) => "CUSTOM"),
        getUser: vi.fn(async () => {
          throw Object.assign(new Error("none"), { code: "auth/user-not-found" });
        }),
      },
      db: { set: vi.fn(async (path: string) => void writes.push(path)) },
    };
  }

  it("環境の変数がなければ何も作らず 2 を返す", async () => {
    const admin = fakeAdmin();
    const out: string[] = [];
    const code = await runDevOperator({ env: {}, admin, now: () => NOW, host: "h", write: (s) => out.push(s) });
    expect(code).toBe(2);
    expect(admin.auth.createUser).not.toHaveBeenCalled();
    expect(admin.db.set).not.toHaveBeenCalled();
    expect(out.join("")).toMatch(/模擬環境/);
  });
  it("利用者を作って operator の claim と custom token を作り、箱に見本を入れて URL を出す", async () => {
    const admin = fakeAdmin();
    const out: string[] = [];
    const code = await runDevOperator({ env: EMU, admin, now: () => NOW, host: "192.168.3.21", write: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(admin.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ uid: "dev-operator", email: expect.stringMatching(/@example\.test$/) }));
    expect(admin.auth.setCustomUserClaims).toHaveBeenCalledWith("dev-operator", { operator: true });
    expect(admin.auth.createCustomToken).toHaveBeenCalledWith("dev-operator", { operator: true });
    expect(admin.writes.some((p) => p.startsWith("reviewQueue/"))).toBe(true);
    expect(out.join("")).toContain("http://192.168.3.21:5173/operator?emulator=1&devToken=CUSTOM");
  });
});
