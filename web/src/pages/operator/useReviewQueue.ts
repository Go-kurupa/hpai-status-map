// 運営者の確認の箱（reviewQueue）の購読。operator の claim があるときだけ購読する（claim は getIdTokenResult で読む）。
// 読むのは reviewQueue だけ（farms は読まない）。読み込み中、読めなかった、claim なし、ログインなしは、空の一覧と区別する。
import { toJstIso } from "@hpai/shared/dates";
import type { ReviewItem } from "@hpai/shared/read/types";
import type { IsoDateTime } from "@hpai/shared/types";
import { signInWithCustomToken } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getFirebase, resolveFirebaseMode } from "../../firebase";

export type ReviewQueueState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "no-claim" }
  | { status: "error" }
  | { status: "ready"; items: ReviewItem[]; asOf: IsoDateTime | null };

/** 模擬環境のときだけ、URL の devToken を返す（本番の設定では使わない。scripts/dev-operator.ts が URL を作る） */
export function devTokenOf(search: string, isDev: boolean): string | null {
  if (resolveFirebaseMode(search, isDev) !== "emulator") return null;
  const t = new URLSearchParams(search).get("devToken");
  return t !== null && t !== "" ? t : null;
}

export function useReviewQueue(): ReviewQueueState {
  const [state, setState] = useState<ReviewQueueState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let unsubAuth: (() => void) | null = null;
    let unsubSnap: (() => void) | null = null;
    let seq = 0;
    let first = true;
    const stopSnap = () => {
      unsubSnap?.();
      unsubSnap = null;
    };
    const fail = () => {
      if (cancelled) return;
      stopSnap();
      setState({ status: "error" });
    };

    void (async () => {
      let handles: Awaited<ReturnType<typeof getFirebase>>;
      try {
        handles = await getFirebase();
      } catch {
        fail();
        return;
      }
      if (cancelled) return;
      const { auth, db } = handles;

      try {
        const token = devTokenOf(location.search, import.meta.env.DEV);
        if (token !== null) {
          await auth.authStateReady();
          if (auth.currentUser === null) await signInWithCustomToken(auth, token);
        }
      } catch {
        fail();
        return;
      }
      if (cancelled) return;

      const evaluate = async (user: Awaited<ReturnType<typeof getFirebase>>["auth"]["currentUser"]) => {
        const mine = ++seq;
        if (user === null) {
          stopSnap();
          setState({ status: "signed-out" });
          return;
        }
        let operator = false;
        try {
          const force = first; // claim の付与の直後でも取り込めるよう、開いたときに 1 度だけ作り直す
          first = false;
          operator = (await user.getIdTokenResult(force)).claims["operator"] === true;
        } catch {
          if (mine === seq) fail();
          return;
        }
        if (cancelled || mine !== seq) return;
        if (!operator) {
          stopSnap();
          setState({ status: "no-claim" });
          return;
        }
        if (unsubSnap !== null) return; // すでに購読している（トークンの更新で呼ばれた）
        const q = query(collection(db, "reviewQueue"), where("resolvedAt", "==", null), orderBy("createdAt", "desc"));
        unsubSnap = onSnapshot(
          q,
          (snap) => {
            if (!cancelled) setState({ status: "ready", items: snap.docs.map((d) => d.data() as ReviewItem), asOf: toJstIso(new Date()) });
          },
          () => fail(),
        );
      };

      unsubAuth = auth.onIdTokenChanged((user) => {
        void evaluate(user);
      });
    })();

    return () => {
      cancelled = true;
      unsubAuth?.();
      stopSnap();
    };
  }, []);

  return state;
}
