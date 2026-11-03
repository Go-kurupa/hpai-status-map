// ログイン中の利用者と、会員の claim。onIdTokenChanged で見る（getIdToken(true) の後にも届く）。
import type { Auth, User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFirebase } from "../../firebase";

export interface AuthState {
  user: User | null;
  member: boolean;
  /** 最初の状態が決まるまで true */
  loading: boolean;
  /** ログインの状態を確かめられなかった（通信など）。このとき member は false だが「会員でない」とは言えない */
  error: boolean;
  /** いまの利用者と claim を読み直す（会員になった直後など） */
  refresh(): Promise<void>;
}

type Snapshot = Pick<AuthState, "user" | "member" | "loading" | "error">;

async function snapshotOf(user: User | null): Promise<Snapshot> {
  if (!user) return { user: null, member: false, loading: false, error: false };
  try {
    const token = await user.getIdTokenResult();
    return { user, member: token.claims["member"] === true, loading: false, error: false };
  } catch {
    return { user, member: false, loading: false, error: true };
  }
}

export function useAuthUser(): AuthState {
  const [state, setState] = useState<Snapshot>({ user: null, member: false, loading: true, error: false });
  const authRef = useRef<Auth | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    getFirebase().then(
      ({ auth }) => {
        if (cancelled) return;
        authRef.current = auth;
        unsubscribe = auth.onIdTokenChanged((u) => {
          void snapshotOf(u).then((s) => {
            if (!cancelled) setState(s);
          });
        });
      },
      () => {
        if (!cancelled) setState({ user: null, member: false, loading: false, error: true });
      },
    );
    return () => {
      cancelled = true;
      alive.current = false;
      unsubscribe?.();
    };
  }, []);

  const refresh = useCallback(async () => {
    const auth = authRef.current;
    if (!auth) return;
    const s = await snapshotOf(auth.currentUser);
    if (alive.current) setState(s);
  }, []);

  return { ...state, refresh };
}
