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

/** 開発（dev server）か ?emulator=1 は模擬環境、それ以外は Hosting の設定 */
export function resolveFirebaseMode(search: string, isDev: boolean): "emulator" | "hosting" {
  if (isDev) return "emulator";
  return new URLSearchParams(search).get("emulator") === "1" ? "emulator" : "hosting";
}

const REGION = "asia-northeast1";
let handles: Promise<FirebaseHandles> | null = null;

async function init(): Promise<FirebaseHandles> {
  const mode = resolveFirebaseMode(location.search, import.meta.env.DEV);
  if (mode === "emulator") {
    // 利用者は別の機械から開くので、接続先は開いたホストの名前にする（localhost にしない）
    const host = location.hostname;
    const app = initializeApp({ projectId: "demo-hpai" });
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
