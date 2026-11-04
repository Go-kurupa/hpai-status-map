// このファイルは動的 import だけで読む（`await import("./firebase")`）。静的に読むと公開の画面に Firebase が載る。
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
}

/** build の種類。vite の環境の DEV と MODE だけを見る（試験で値を差し込める）。 */
export interface BuildEnv {
  DEV: boolean;
  MODE: string;
}

/**
 * 開発（dev server）は模擬環境。E2E の build（mode=e2e）は ?emulator=1 のときだけ模擬環境。
 * 本番の build は ?emulator=1 が付いても無視して、Hosting の設定を使う（本番のリンクに付けられても、模擬環境の口に繋がない）。
 */
export function resolveFirebaseMode(search: string, env: BuildEnv): "emulator" | "hosting" {
  if (env.DEV) return "emulator";
  if (env.MODE !== "e2e") return "hosting";
  return new URLSearchParams(search).get("emulator") === "1" ? "emulator" : "hosting";
}

/**
 * 模擬環境の app の設定。キーが無いと getAuth が auth/invalid-api-key で例外になり、
 * メールの送信が通信に出る前に失敗する。模擬環境は値を見ないので、秘密ではない名前を置く。
 */
export const EMULATOR_APP_OPTIONS: FirebaseOptions = { projectId: "demo-hpai", apiKey: "demo-hpai-emulator" };

const REGION = "asia-northeast1";
let handles: Promise<FirebaseHandles> | null = null;

async function init(): Promise<FirebaseHandles> {
  const mode = resolveFirebaseMode(location.search, import.meta.env);
  if (mode === "emulator") {
    // 利用者は別の機械から開くので、接続先は開いたホストの名前にする（localhost にしない）
    const host = location.hostname;
    const app = initializeApp(EMULATOR_APP_OPTIONS);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const functions = getFunctions(app, REGION);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectFunctionsEmulator(functions, host, 5001);
    return { app, auth, db, functions };
  }
  const res = await fetch("/__/firebase/init.json");
  if (!res.ok) throw new Error(`Firebase の設定を読めませんでした（${res.status}）`);
  const config = (await res.json()) as FirebaseOptions;
  const app = getApps()[0] ?? initializeApp(config);
  return { app, auth: getAuth(app), db: getFirestore(app), functions: getFunctions(app, REGION) };
}

/** 初期化は 1 度だけ。失敗したら次の呼び出しでやり直せる */
export function getFirebase(): Promise<FirebaseHandles> {
  if (!handles) {
    handles = init().catch((e: unknown) => {
      handles = null;
      throw e;
    });
  }
  return handles;
}
