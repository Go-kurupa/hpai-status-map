// 仮の記録の口。M-01 がこのファイルを置き換える。routes.tsx の根が使う。
// firebase/* と ../../firebase は動的 import だけにする（型は import type）。静的に読むと公開の画面に Firebase が載る。
import type { Firestore } from "firebase/firestore";
import type { RecordStore } from "../../data/types";

function notReady(): Promise<never> {
  return Promise.reject(new Error("準備中"));
}

function createProvisionalStore(): RecordStore {
  return {
    mode: "firestore",
    getFarm: async () => null,
    saveFarm: notReady,
    listHouses: async () => [],
    saveHouse: notReady,
    listDeaths: async () => [],
    saveDeath: notReady,
    listChecks: async () => [],
    saveCheck: notReady,
    getCaseDraft: async () => null,
    isMailStopped: async () => false,
  };
}

/** 各メソッドの中で getFirebase() と uid を読む（M-01 で実装）。未ログインの getFarm は null */
export function createFirestoreRecordStore(): RecordStore {
  return createProvisionalStore();
}

/** 試験用（M-01 で実装） */
export function createFirestoreRecordStoreWith(_db: Firestore, _uid: string): RecordStore {
  return createProvisionalStore();
}
