import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const app = getApps()[0] ?? initializeApp();

export const db = getFirestore(app);

/** 既定のバケット。Storage は全拒否で、サーバーだけが使う。 */
export function bucket(name?: string) {
  return getStorage(app).bucket(name);
}
