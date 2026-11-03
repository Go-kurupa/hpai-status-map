import type { ChecklistClass } from "@hpai/shared/types";
import type { ReactNode } from "react";
import { Tag } from "./Tag";

/**
 * やること（設計書 §7）の 3 分類の枠。線の種類で見分ける。
 * always は --fg の実線、if_in_zone は --lv1 の太線、good_to_check は --muted の破線と「義務ではありません」。
 */
export function ClassBlock({ cls, heading, children }: { cls: ChecklistClass; heading: string; children: ReactNode }) {
  return (
    <section className={`class-block class-${cls}`}>
      <h2>
        {heading}
        {cls === "good_to_check" ? <Tag tone="neutral">義務ではありません</Tag> : null}
      </h2>
      {children}
    </section>
  );
}
