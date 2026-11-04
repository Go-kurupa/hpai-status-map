import type { ReactNode } from "react";

/** 畳む部品。閉じていても本文は DOM に残す（details の標準の動き） */
export function Fold({
  summary,
  children,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={["fold", className].filter(Boolean).join(" ")}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
