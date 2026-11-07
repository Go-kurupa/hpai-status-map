// 今日のやることの 1 行（2026-11-07 A）。形は 1 種類: [印] 文（小さな補足） … [押すもの]。
// 印は文字（☐ ⏲ ☑）と色（theme の変数）の両方で示し、読み上げには名前（まだ・後でやる・済み）を渡す。
// 読めない行・期限なし・今の資料にないカードは ☐ にも ☑ にもしない（未入力や済みに見せない）。
import type { ReactNode } from "react";
import { TODAY_TEXT } from "./texts";

/** todo＝まだ、later＝後でやる、done＝済み。unknown＝読めない、info＝期限なしなど（どちらも集計に数えない） */
export type TodayMark = "todo" | "later" | "done" | "unknown" | "info";

const GLYPH: Record<TodayMark, string> = { todo: "☐", later: "⏲", done: "☑", unknown: "？", info: "－" };

/** 開いたときの並びの重み。まだ（と読めない行）→ 後でやる → 済み → 期限なしなど */
export const MARK_RANK: Record<TodayMark, number> = { todo: 0, unknown: 0, later: 1, done: 2, info: 3 };

export const COUNTED: ReadonlySet<TodayMark> = new Set(["todo", "later", "done"]);

export function TodayRow({
  mark,
  markLabel,
  text,
  textLink,
  sub,
  act,
  more,
}: {
  mark: TodayMark;
  /** 印の名前。既定は まだ・後でやる・済み・読み込めませんでした */
  markLabel?: string;
  text: ReactNode;
  /** 文の後ろに続ける小さなリンク（消毒の「出典」） */
  textLink?: ReactNode;
  sub?: ReactNode;
  /** 押すもの（スマホの幅では文の下に回る） */
  act?: ReactNode;
  /** 行の下に足すもの（メモ、くわしく、知らせ） */
  more?: ReactNode;
}) {
  const label = markLabel ?? (mark === "info" ? "" : TODAY_TEXT.mark[mark]);
  return (
    <li className={`today-row is-${mark}`}>
      <span className="today-mark" role="img" aria-label={label}>
        {GLYPH[mark]}
      </span>
      <div className="today-text">
        <p className="today-main">
          <span className="today-title">{text}</span>
          {textLink ? <> {textLink}</> : null}
        </p>
        {sub ? <p className="todo-note today-sub">{sub}</p> : null}
      </div>
      {act ? <div className="today-act">{act}</div> : null}
      {more ? <div className="today-more">{more}</div> : null}
    </li>
  );
}
