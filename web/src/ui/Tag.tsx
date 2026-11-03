import type { ReactNode } from "react";

export type TagTone = "lv1" | "lv2" | "lv3" | "lv4" | "neutral";

export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
