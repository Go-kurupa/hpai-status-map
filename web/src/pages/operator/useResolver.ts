// 1 項目の操作の実行。実行中と成功の後は、もう押せない（同じ操作を 2 度送らない）。失敗したら理由を出し、もう一度押せる。
import type { ResolveRequest, ResolveResponse } from "@hpai/shared/read/review";
import { useCallback, useRef, useState } from "react";
import { errorText } from "./operatorText";

export type ResolveFn = (req: ResolveRequest) => Promise<ResolveResponse>;

export function useResolver(resolve: ResolveFn) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  const run = useCallback(
    async (req: ResolveRequest) => {
      if (locked.current) return;
      locked.current = true;
      setPhase("busy");
      setError(null);
      try {
        await resolve(req);
        setPhase("done"); // 一覧から消えるまで押せないまま
      } catch (e) {
        setError(errorText(e));
        setPhase("idle");
        locked.current = false;
      }
    },
    [resolve],
  );

  return { phase, error, run, disabled: phase !== "idle" };
}
