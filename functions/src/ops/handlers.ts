import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { z } from "zod";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import type { Invite, RuntimeSettings, Source, SourceKind, SourceSeed } from "@hpai/shared/types";
import { db } from "../admin";
import { readRuntimeSettings, readUsageMonth, usageMonthKey } from "../usage/settings";
import { checkBearer } from "./auth";

// 手元から本番を管理する opsAdmin の中身（契約 1.7）。応答にもログにも、Secret、招待コード（作った 1 度を除く）、email を出さない。

export type OpRequest =
  | { op: "set-claims"; email: string; operator?: boolean; member?: boolean }
  | { op: "create-invite"; kind: "signup"; maxUses: number }
  | { op: "seed-sources" }
  | { op: "set-setting"; key: string; value: unknown }
  | { op: "usage-status" };

export type OpResult =
  | { ok: true; op: "set-claims"; claims: string[] }
  | { ok: true; op: "create-invite"; code: string; maxUses: number }
  | { ok: true; op: "seed-sources"; added: number; skipped: number; total: number }
  | { ok: true; op: "set-setting"; key: string; value: unknown }
  | { ok: true; op: "usage-status"; month: string; estimatedJpy: number; hardLimitJpy: number };

/** 呼び出し側に返してよい失敗。message は固定の文で、入力の値を含めない。 */
export class OpError extends Error {
  constructor(
    readonly status: 400 | 500,
    message: string,
  ) {
    super(message);
    this.name = "OpError";
  }
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

const SOURCE_KINDS = ["maff_press", "maff_season", "moe", "pref_fixed", "pref_rss", "pref_press_list"] as const satisfies readonly SourceKind[];

const RequestSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("set-claims"), email: z.email().max(320), operator: z.boolean().optional(), member: z.boolean().optional() })
    .strict()
    .refine((r) => r.operator === true || r.member === true, { path: ["operator"] }),
  z
    .object({ op: z.literal("create-invite"), kind: z.literal("signup"), maxUses: z.number().int().min(1).max(1000) })
    .strict(),
  z.object({ op: z.literal("seed-sources") }).strict(),
  z.object({ op: z.literal("set-setting"), key: z.string().min(1).max(100), value: z.unknown() }).strict(),
  z.object({ op: z.literal("usage-status") }).strict(),
]);

const SourceSeedSchema = z.object({
  prefCode: z.string().regex(/^[0-9]{2}$/).nullable(),
  url: z.url(),
  kind: z.enum(SOURCE_KINDS),
  confirmedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().nullable(),
});

function parseRequest(raw: unknown): OpRequest {
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    // 値は出さず、どの項目かだけを返す。
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "op"))].join(", ");
    throw new OpError(400, `入力が正しくありません（${fields}）`);
  }
  return parsed.data as OpRequest;
}

export async function handleOp(body: OpRequest, opts: { sourcesPath?: string; now?: () => Date } = {}): Promise<OpResult> {
  const req = parseRequest(body);
  switch (req.op) {
    case "set-claims":
      return setClaims(req);
    case "create-invite":
      return createInvite(req);
    case "seed-sources":
      return seedSources(opts.sourcesPath);
    case "set-setting":
      return setSetting(req);
    case "usage-status":
      return usageStatus((opts.now ?? (() => new Date()))());
  }
}

// ── set-claims: 既存の claim を残して足す ──

async function setClaims(req: Extract<OpRequest, { op: "set-claims" }>): Promise<OpResult> {
  const auth = getAuth();
  let uid: string;
  let existing: Record<string, unknown>;
  try {
    const user = await auth.getUserByEmail(req.email);
    uid = user.uid;
    existing = user.customClaims ?? {};
  } catch (e) {
    if (errorCode(e) === "auth/user-not-found") throw new OpError(400, "その利用者がいません");
    throw e;
  }
  const claims: Record<string, unknown> = { ...existing };
  if (req.operator) claims.operator = true;
  if (req.member) claims.member = true;
  await auth.setCustomUserClaims(uid, claims);
  return { ok: true, op: "set-claims", claims: Object.keys(claims).sort() };
}

// ── create-invite: 平文を 1 度だけ返し、保存は指紋（sha256(code.trim())）だけ ──

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 紛らわしい 0 O 1 I L を除く
const CODE_LENGTH = 12;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

async function createInvite(req: Extract<OpRequest, { op: "create-invite" }>): Promise<OpResult> {
  const code = generateCode();
  const invite: Invite = { kind: req.kind, farmId: null, maxUses: req.maxUses, usedBy: [], expiresAt: null };
  await db.collection("invites").doc(sha256Hex(code.trim())).create(invite);
  return { ok: true, op: "create-invite", code, maxUses: req.maxUses };
}

// ── seed-sources: 同梱の sources.json から足す。既存の行は触らない ──

function loadSeeds(sourcesPath: string | undefined): SourceSeed[] {
  const file = sourcesPath ?? path.join(__dirname, "data", "sources.json");
  try {
    return z.array(SourceSeedSchema).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    throw new OpError(500, "同梱の sources.json を読めません");
  }
}

async function seedSources(sourcesPath: string | undefined): Promise<OpResult> {
  const seeds = loadSeeds(sourcesPath);
  const rows = seeds.map((seed): Source => {
    const id = sha256Hex(seed.url).slice(0, 24);
    return {
      ...seed,
      id,
      group: (parseInt(id.slice(0, 8), 16) % 3) as 0 | 1 | 2,
      enabled: true,
      lastCheckedAt: null,
      lastOkAt: null,
      etag: null,
      lastModified: null,
      fingerprint: null,
      failureCount: 0,
    };
  });

  let added = 0;
  const CHUNK = 20;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const results = await Promise.all(
      rows.slice(i, i + CHUNK).map(async (row) => {
        try {
          await db.collection("sources").doc(row.id).create(row);
          return true;
        } catch (e) {
          if (isAlreadyExists(e)) return false;
          throw e;
        }
      }),
    );
    added += results.filter(Boolean).length;
  }
  return { ok: true, op: "seed-sources", added, skipped: rows.length - added, total: rows.length };
}

// ── usage-status: 今月の費用と止める線を読むだけ（setup-agent --unpause が、上限を越えたまま戻さないために使う）──
// 月の境と換算は、定期実行を止める側（agent/runs.ts）と同じ関数を使う。Secret も個人情報も返さない。

async function usageStatus(now: Date): Promise<OpResult> {
  const [settings, month] = await Promise.all([readRuntimeSettings(), readUsageMonth(now)]);
  return { ok: true, op: "usage-status", month: usageMonthKey(now), estimatedJpy: month.estimatedJpy, hardLimitJpy: settings.hardLimitJpy };
}

// ── set-setting: usage/settings。無ければ既定値で作る ──

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const SETTING_CHECKS: { [K in keyof RuntimeSettings]: (v: unknown) => boolean } = {
  softLimitJpy: (v) => finite(v) && v >= 0,
  hardLimitJpy: (v) => finite(v) && v >= 0,
  jpyPerUsd: (v) => finite(v) && v > 0,
  autoPublishEnabled: (v) => typeof v === "boolean",
  primaryModel: (v) => typeof v === "string" && v !== "",
  primaryEffort: (v) => typeof v === "string" && ["low", "medium", "high", "xhigh", "max"].includes(v),
  secondModel: (v) => typeof v === "string" && v !== "",
};

async function setSetting(req: Extract<OpRequest, { op: "set-setting" }>): Promise<OpResult> {
  const { key, value } = req;
  if (!Object.hasOwn(SETTING_CHECKS, key)) throw new OpError(400, "知らない設定のキーです");
  if (!SETTING_CHECKS[key as keyof RuntimeSettings](value)) throw new OpError(400, "設定の値の型または範囲が違います");

  const ref = db.collection("usage").doc("settings");
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, { ...DEFAULT_RUNTIME_SETTINGS, ...(snap.exists ? snap.data() : {}), [key]: value });
  });
  return { ok: true, op: "set-setting", key, value };
}

// ── HTTP の入口 ──

/** express の Request / Response のうち、使う部分だけ。試験で偽物を渡せる。 */
export interface OpsReq {
  method: string;
  get(name: string): string | undefined;
  body: unknown;
}
export interface OpsRes {
  status(code: number): OpsRes;
  json(body: unknown): unknown;
}

export async function serveOps(req: OpsReq, res: OpsRes, expectedToken: string, opts: { sourcesPath?: string; now?: () => Date } = {}): Promise<void> {
  if (!checkBearer(req.get("authorization"), expectedToken)) {
    res.status(401).json({ ok: false, error: "認証できません" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST だけです" });
    return;
  }
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "本文は JSON のオブジェクトにしてください" });
    return;
  }
  try {
    res.status(200).json(await handleOp(body as OpRequest, opts));
  } catch (e) {
    if (e instanceof OpError) {
      res.status(e.status).json({ ok: false, error: e.message });
      return;
    }
    // 原因の文には email などが入りうるので、code だけを残す。
    logger.error("opsAdmin failed", { code: errorCode(e) ?? "unknown" });
    res.status(500).json({ ok: false, error: "内部エラーです" });
  }
}

function errorCode(e: unknown): string | number | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function isAlreadyExists(e: unknown): boolean {
  const code = errorCode(e);
  return code === 6 || code === "already-exists";
}
