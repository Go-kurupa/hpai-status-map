// 模擬環境用: 運営者の画面 /operator を、本番にも M-01（会員のログイン）にも頼らず確かめる（I-07）。
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx scripts/dev-operator.ts
//   （別の端末で: npx firebase emulators:start --only firestore,auth --project demo-hpai、npm run dev -w web）
//
// 模擬環境の変数がなければ何もせず止まる（本番に書かない）。利用者を作って operator の claim を付け、custom token を作り、
// reviewQueue に見本を入れ、?emulator=1&devToken= の URL を出す。URL の host は DEV_HOST（なければ開発機の LAN の IP）。
// 見本は架空の値だけ（example.test、実在の人や農場を使わない）。custom token は模擬環境でだけ通る。
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeReviewingCase } from "@hpai/shared/cases";
import { toJstIso } from "@hpai/shared/dates";
import type { DocumentRecord, ReadResult, ReviewItem } from "@hpai/shared/read/types";
import type { Case, Source } from "@hpai/shared/types";

const PROJECT = "demo-hpai";
const UID = "dev-operator";
const EMAIL = "dev-operator@example.test";
const WEB_PORT = 5173;

/** 模擬環境の外なら理由を返す（null なら続けてよい）。 */
export function checkEmulatorEnv(env: Record<string, string | undefined>): string | null {
  if (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST) {
    return "模擬環境の外です。FIRESTORE_EMULATOR_HOST と FIREBASE_AUTH_EMULATOR_HOST を模擬環境に向けて実行してください（本番には書きません）";
  }
  const project = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  if (project !== undefined && project !== "" && !project.startsWith("demo-")) {
    return `project が ${PROJECT} のような demo- で始まる名前ではありません。模擬環境の外に書かないよう止めました`;
  }
  return null;
}

export function devUrl(host: string, token: string): string {
  return `http://${host}:${WEB_PORT}/operator?emulator=1&devToken=${encodeURIComponent(token)}`;
}

const QUOTE = "令和8年11月3日、岡山県津山市の家きん農場で簡易検査の陽性を確認しました。";
const q = <T>(value: T | null) => ({ value, quote: value === null ? null : QUOTE });

export interface Sample {
  path: string;
  data: unknown;
}

/** 箱の見本と、操作を試すための周辺（文書、確認中の事例、否定の候補の事例、古い入口）。farms は作らない。 */
export function buildSamples(now: Date): Sample[] {
  const at = (minutesAgo: number) => toJstIso(new Date(now.getTime() - minutesAgo * 60_000));
  const out: Sample[] = [];
  const item = (i: ReviewItem) => out.push({ path: `reviewQueue/${i.id}`, data: i });

  // 発生の語がある文書（公開の確認中）。読み取りの結果つき
  const primary: ReadResult = {
    kind: "suspected",
    kindQuote: QUOTE,
    multipleCases: false,
    prefecture: q("岡山県"),
    municipality: q("津山市"),
    nationalNo: q(null),
    prefNo: q(null),
    birdUse: q("採卵鶏"),
    housing: q(null),
    headCount: q(12000),
    negationBasis: q(null),
    primaryStage: "suspected",
    primaryDate: { year: null, month: 11, day: 3, time: "09:30" },
    primaryDateQuote: QUOTE,
    stageEvents: [],
    radiiKm: [{ km: 3, quote: QUOTE }, { km: 10, quote: QUOTE }],
    estimates: [],
    wildBirds: [],
  };
  const url1 = "https://example.test/sample/outbreak-1";
  const doc1: DocumentRecord = {
    id: "sample-1",
    sourceId: "sample-source",
    prefCode: "33",
    url: url1,
    title: "（見本）高病原性鳥インフルエンザの疑い事例について",
    contentType: "html",
    storagePath: "raw/sample-1.html",
    fetchedAt: at(30),
    fingerprint: "0".repeat(64),
    hasTextLayer: true,
    kind: "suspected",
    readState: "review_public",
    primary,
    second: null,
    verify: { pass: false, issues: [{ field: "municipality", check: "muni_exists", mandatory: true, detail: "見本" }], droppedOptional: [], normalized: null },
    compare: { match: false, mismatches: ["primaryDate"] },
    caseId: null,
    error: null,
    reasons: ["municipality:muni_exists", "compare:primaryDate"],
  };
  out.push({ path: "documents/sample-1", data: doc1 });
  out.push({ path: "cases/rev-sample-1", data: makeReviewingCase({ documentId: "sample-1", season: 2026, prefCode: "33", sourceUrl: url1 }, now) });
  item({ id: "doc-sample-1", createdAt: at(30), resolvedAt: null, kind: "document", documentId: "sample-1", url: url1, prefCode: "33", title: doc1.title, reasons: doc1.reasons!, hasOutbreakWords: true });

  // 発生の語がない文書（公開しない）。文書の記録はない（読み取りの結果を読めない場合の見本）
  item({
    id: "doc-sample-2",
    createdAt: at(45),
    resolvedAt: null,
    kind: "document",
    documentId: "sample-2",
    url: "https://example.test/sample/notice-2",
    prefCode: "28",
    title: "（見本）家畜防疫に関するお知らせ",
    reasons: ["auto_publish_off", "multiple_cases"],
    hasOutbreakWords: false,
  });

  // 入口の提案（古い入口も sources に置く）
  const oldUrl = "https://example.test/sample/old-entrance";
  const old: Source = {
    id: "sample-old-source",
    prefCode: "33",
    url: oldUrl,
    kind: "pref_fixed",
    confirmedOn: "2026-10-01",
    note: "見本",
    group: 0,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 3,
  };
  out.push({ path: `sources/${old.id}`, data: old });
  item({ id: "entr-sample-1", createdAt: at(60), resolvedAt: null, kind: "entrance_proposal", prefCode: "33", oldUrl, proposedUrl: "https://example.test/sample/new-entrance", sourceKind: "pref_fixed", rationale: "（見本）年度が変わり、新しい入口に移っていました" });

  // 否定の候補（事例も置く）
  const negCase: Case = {
    id: "33203-2026-11-01-1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: "採卵鶏",
    housing: null,
    headCount: 8000,
    stages: { suspected: { date: "2026-11-01", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "candidate",
    negatedAt: null,
    confirmState: "operator",
    sourceUrls: ["https://example.test/sample/outbreak-0"],
    updatedAt: at(120),
  };
  out.push({ path: `cases/${negCase.id}`, data: negCase });

  const alert = (alertName: Extract<ReviewItem, { kind: "alert" }>["alert"], minutesAgo: number, over: { prefCode?: string | null; caseId?: string | null } = {}) =>
    item({ id: `alert-${alertName}-sample`, createdAt: at(minutesAgo), resolvedAt: null, kind: "alert", alert: alertName, prefCode: over.prefCode ?? null, caseId: over.caseId ?? null, message: "（見本）" });
  alert("negation_candidate", 90, { prefCode: "33", caseId: negCase.id });
  alert("case_stalled", 100, { prefCode: "33", caseId: negCase.id });
  alert("national_missing", 110, { prefCode: "28" });
  alert("app_only_confirmed", 120, { prefCode: "33" });
  alert("watch_failing", 130, { prefCode: "01" });
  alert("agent_run_failed", 140);
  alert("mail_failing", 150);
  return out;
}

export interface AdminLike {
  auth: {
    createUser(p: { uid: string; email: string }): Promise<{ uid: string }>;
    getUser(uid: string): Promise<unknown>;
    setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
    createCustomToken(uid: string, claims: Record<string, unknown>): Promise<string>;
  };
  db: { set(path: string, data: unknown): Promise<void> };
}

export interface RunDeps {
  env: Record<string, string | undefined>;
  admin: AdminLike;
  now(): Date;
  host: string;
  write(s: string): void;
}

/** 0: 成功、2: 模擬環境の外（何も作らない） */
export async function runDevOperator(deps: RunDeps): Promise<number> {
  const bad = checkEmulatorEnv(deps.env);
  if (bad !== null) {
    deps.write(`${bad}\n`);
    return 2;
  }
  const { auth, db } = deps.admin;
  try {
    await auth.getUser(UID);
  } catch {
    await auth.createUser({ uid: UID, email: EMAIL });
  }
  await auth.setCustomUserClaims(UID, { operator: true });
  const token = await auth.createCustomToken(UID, { operator: true });
  for (const s of buildSamples(deps.now())) await db.set(s.path, s.data);
  deps.write(`運営者の画面（模擬環境）: ${devUrl(deps.host, token)}\n`);
  deps.write("この URL は 1 時間ほどで使えなくなります。開き直すときは、もう一度このコマンドを実行してください。\n");
  return 0;
}

function lanHost(env: Record<string, string | undefined>): string {
  if (env.DEV_HOST) return env.DEV_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "localhost";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    // 模擬環境の変数を確かめてから Firebase を読む（外では何も初期化しない）
    if (checkEmulatorEnv(process.env) !== null) {
      process.exit(await runDevOperator({ env: process.env, admin: null as unknown as AdminLike, now: () => new Date(), host: "", write: (s) => process.stderr.write(s) }));
    }
    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const admin: AdminLike = {
      auth: {
        createUser: (p) => auth.createUser(p),
        getUser: (uid) => auth.getUser(uid),
        setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
        createCustomToken: (uid, claims) => auth.createCustomToken(uid, claims),
      },
      db: { set: async (p, data) => void (await firestore.doc(p).set(data as Record<string, unknown>)) },
    };
    process.exit(await runDevOperator({ env: process.env, admin, now: () => new Date(), host: lanHost(process.env), write: (s) => process.stdout.write(s) }));
  })();
}
