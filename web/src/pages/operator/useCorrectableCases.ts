// 運営者が段階の日付を直せる事例の一覧（Q-n）。今季の事例を購読し、確認中と再現は除く（サーバーも同じ事例を拒む）。
// 条件は season だけにして、残りは画面側で絞る（複合の index を増やさない）。cases は誰でも読める。
import { currentSeason } from "@hpai/shared/season";
import type { Case } from "@hpai/shared/types";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getFirebase } from "../../firebase";

export type CorrectableCasesState = { status: "loading" } | { status: "error" } | { status: "ready"; cases: Case[] };

/** 段階の日付を直せる事例だけにして、最初の日付の新しい順に並べる。 */
export function correctableCases(cases: readonly Case[]): Case[] {
  const firstOf = (c: Case): string => Object.values(c.stages).map((s) => s.date).sort()[0] ?? "";
  return cases
    .filter((c) => (c.confirmState === "auto" || c.confirmState === "national" || c.confirmState === "operator") && Object.keys(c.stages).length > 0)
    .sort((a, b) => firstOf(b).localeCompare(firstOf(a)) || a.id.localeCompare(b.id));
}

export function useCorrectableCases(now: () => Date): CorrectableCasesState {
  const [state, setState] = useState<CorrectableCasesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null | undefined = null;
    void (async () => {
      try {
        const { db } = await getFirebase();
        if (cancelled) return;
        const q = query(collection(db, "cases"), where("season", "==", currentSeason(now())));
        unsub = onSnapshot(
          q,
          (snap) => {
            if (!cancelled) setState({ status: "ready", cases: correctableCases(snap.docs.map((d) => ({ ...(d.data() as Case), id: d.id }))) });
          },
          () => {
            if (!cancelled) setState({ status: "error" });
          },
        );
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [now]);

  return state;
}
