import type { ChecklistClass } from "@hpai/shared/types";
import type { ReactNode } from "react";
import { Tag } from "./Tag";

/**
 * やること（設計書 §7）の 3 分類の枠。線の種類で見分ける。
 * always は --fg の実線、if_in_zone は --lv1 の太線、good_to_check は --muted の破線と「義務ではありません」。
 * id を渡すと、目次の飛び先にする（押したときに焦点を移せるよう tabIndex -1 も付ける）。消毒の記録の画面は渡さない。
 * level は見出しの段。既定は h2。「確認リスト」の見出し（h2）の中に置くときは 3（2026-11-08）。消毒の記録の画面は h2 のまま。
 */
export function ClassBlock({
  cls,
  heading,
  id,
  level = 2,
  children,
}: {
  cls: ChecklistClass;
  heading: string;
  id?: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <section className={`class-block class-${cls}`} id={id} tabIndex={id ? -1 : undefined}>
      <H>
        {heading}
        {cls === "good_to_check" ? <Tag tone="neutral">義務ではありません</Tag> : null}
      </H>
      {children}
    </section>
  );
}
