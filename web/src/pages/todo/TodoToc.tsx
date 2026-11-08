// 対策項目の目次（2026-11-08 レビュー 1 周目の設計 §1）。見出しのある節が 4 つ以上のとき（段階 1）だけ、題の行の下に出す。
// 札は番号・節の名前・添える状態（町の名前や項目数）。色は増やさず、確認リストの枠の線の種類を札の左の縦線に写す。
// 押すと、その節へ動かして焦点を移す（読み上げでも、どこへ来たか分かる）。帯に隠れない余白は theme.css の scroll-padding-top。
import type { ChecklistClass } from "@hpai/shared/types";
import type { MouseEvent } from "react";
import { TODO_TEXT } from "./texts";

export interface TocEntry {
  /** 飛び先の節の id */
  id: string;
  label: string;
  /** 札の右に添える状態（「6 項目」など） */
  note?: string;
  /** 確認リストの枠なら、その種類（札の左の縦線を枠の線に合わせる） */
  cls?: ChecklistClass;
}

/** 目次を出す最少の節の数。これより少ないときは、画面が短いので出さない */
export const TOC_MIN = 4;

function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return; // 節がないときは、ふつうのリンクとして動かす
  e.preventDefault();
  target.scrollIntoView?.({ block: "start" });
  target.focus({ preventScroll: true });
}

export function TodoToc({ entries }: { entries: TocEntry[] }) {
  if (entries.length < TOC_MIN) return null;
  return (
    // 名前は見える見出しから取る（読み上げで「目次」が 2 回続かないように）
    <nav className="todo-toc" aria-labelledby="todo-toc-label">
      <p className="todo-toc-label" id="todo-toc-label">
        {TODO_TEXT.tocLabel}
      </p>
      <ol>
        {entries.map((t, n) => (
          <li key={t.id}>
            <a href={`#${t.id}`} className={t.cls ? `toc-${t.cls}` : undefined} onClick={(e) => jump(e, t.id)}>
              <span className="todo-toc-num" aria-hidden="true">
                {n + 1}
              </span>
              <span className="todo-toc-name">{t.label}</span>
              {t.note ? (
                <>
                  {" "}
                  <span className="todo-toc-note">{t.note}</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
