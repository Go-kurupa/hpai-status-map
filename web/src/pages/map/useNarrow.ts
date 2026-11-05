import { useSyncExternalStore } from "react";

/** map.css のスマホの組み方と同じ境目。地図の前に出すものを、この幅だけ減らす */
const NARROW_QUERY = "(max-width: 63.99rem)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const isNarrow = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/** 幅 64rem 未満か。幅を調べられない環境では PC の組み方にする */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrow);
}
