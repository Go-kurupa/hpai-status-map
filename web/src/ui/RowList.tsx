// 1 行 1 操作の一覧（記録の画面の入力の行。対策項目の今日のやること TodayRow と同じ組み方）。
// 形: [印] 見出し（小さな補足） … [押すもの]。印は文字と色の両方で示し、読み上げには名前を渡す。
// スマホの幅では押すものを見出しの下に回す。
import type { ReactNode } from "react";

/** todo＝未入力、done＝記録済み、yes＝できている、no＝できていない、off＝空舎など（数えない） */
export type RowMark = "todo" | "done" | "yes" | "no" | "off";

const GLYPH: Record<RowMark, string> = { todo: "☐", done: "☑", yes: "○", no: "×", off: "－" };

export const ROW_MARK_LABEL: Record<RowMark, string> = {
  todo: "未入力",
  done: "記録済み",
  yes: "できている",
  no: "できていない",
  off: "対象外",
};

export function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="row-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function RowItem({
  mark,
  markLabel,
  title,
  sub,
  act,
  more,
}: {
  mark: RowMark;
  /** 印の名前。既定は ROW_MARK_LABEL */
  markLabel?: string;
  title: ReactNode;
  sub?: ReactNode;
  act?: ReactNode;
  /** 行の下に足すもの（結果、畳んだ説明） */
  more?: ReactNode;
}) {
  return (
    <li className={`row-item is-${mark}`}>
      <span className="row-mark" role="img" aria-label={markLabel ?? ROW_MARK_LABEL[mark]}>
        {GLYPH[mark]}
      </span>
      <div className="row-text">
        <p className="row-title">{title}</p>
        {sub ? <p className="row-sub">{sub}</p> : null}
      </div>
      {act ? <div className="row-act">{act}</div> : null}
      {more ? <div className="row-more">{more}</div> : null}
    </li>
  );
}
