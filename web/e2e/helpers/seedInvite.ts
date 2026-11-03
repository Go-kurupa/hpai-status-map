// 画面の試験（E2E）が使う招待コードの作り方。模擬環境の Firestore に、指紋の ID で書く（M-05、X-23 も使う）。
// firebase-admin は web の依存にないので、模擬環境の REST を使う（Authorization: Bearer owner はルールを通らない書き込み）。
// 本番には届かない: 接続先は模擬環境の host だけで、プロジェクトは demo-hpai に固定。
import { generateInviteCode, hashInviteCode } from "../../../functions/src/farm/inviteCode";

const PROJECT = "demo-hpai";

export interface SeedInviteOptions {
  kind?: "signup" | "farm";
  farmId?: string | null;
  maxUses?: number;
  expiresAt?: string | null;
  /** 模擬環境の Firestore。既定は FIRESTORE_EMULATOR_HOST か 127.0.0.1:8080 */
  host?: string;
}

function firestoreHost(opts: SeedInviteOptions): string {
  const host = opts.host ?? process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080";
  // 本番を指していたら止める（模擬環境は http のホスト:ポートだけ）
  if (!/^[A-Za-z0-9.-]+:\d+$/.test(host) || host.endsWith("googleapis.com")) {
    throw new Error(`模擬環境の host ではありません: ${host}`);
  }
  return host;
}

/** 招待を 1 つ作り、平文のコードを返す。保存は指紋の ID だけ */
export async function seedInvite(opts: SeedInviteOptions = {}): Promise<string> {
  const code = generateInviteCode();
  const fields = {
    kind: { stringValue: opts.kind ?? "signup" },
    farmId: opts.farmId ? { stringValue: opts.farmId } : { nullValue: null },
    maxUses: { integerValue: String(opts.maxUses ?? 5) },
    usedBy: { arrayValue: { values: [] } },
    expiresAt: opts.expiresAt ? { stringValue: opts.expiresAt } : { nullValue: null },
  };
  const res = await fetch(
    `http://${firestoreHost(opts)}/v1/projects/${PROJECT}/databases/(default)/documents/invites?documentId=${hashInviteCode(code)}`,
    { method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`招待を作れませんでした（${res.status}）`);
  return code;
}

/** 模擬環境の Auth に届いた、メールのログインのリンク（宛先ごとの最新）。ブラウザの別の文脈で開く */
export async function latestSignInLink(email: string, opts: { host?: string } = {}): Promise<string> {
  const host = opts.host ?? process.env["FIREBASE_AUTH_EMULATOR_HOST"] ?? "127.0.0.1:9099";
  if (!/^[A-Za-z0-9.-]+:\d+$/.test(host)) throw new Error(`模擬環境の host ではありません: ${host}`);
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/oobCodes`);
  if (!res.ok) throw new Error(`oobCodes を読めませんでした（${res.status}）`);
  const body = (await res.json()) as { oobCodes?: Array<{ email: string; requestType: string; oobLink: string }> };
  const mine = (body.oobCodes ?? []).filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN");
  const last = mine.at(-1);
  if (!last) throw new Error("ログインのリンクが届いていません");
  return last.oobLink;
}
