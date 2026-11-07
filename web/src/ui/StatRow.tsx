// 状態の数字の札（記録と設定の画面の上に並べる。2026-11-07 業務画面の作り直し）。
// 読み込み中は「…」、読めなかったら「読み込めませんでした」と出し、0 と言わない。
// 注意が要る札（基準に達した可能性、未登録など）だけ tone="alert" で赤い枠にする。色だけに頼らず、文でも示す。
// 大きな値は 2〜6 文字の語か数字にし、理由は note に書く。
// class は .stat-tiles（theme.css）。地図の札（.stat-row）とは別の部品なので、同じ class を使わない。
import type { ReactNode } from "react";

export type StatValue = { status: "loading" } | { status: "failed" } | { status: "ok"; value: ReactNode; unit?: string };

export const STAT_TEXT = { loading: "…", failed: "読み込めませんでした" } as const;

export function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="stat-tiles" aria-label={label}>
      {children}
    </ul>
  );
}

export function StatTile({
  label,
  value,
  note,
  tone = "normal",
  href,
}: {
  label: string;
  value: StatValue;
  /** 数字の下の小さな 1 行（「1 鶏舎は未入力」、「あと 28 日」など）。リンクも置ける */
  note?: ReactNode;
  tone?: "normal" | "alert";
  /** 札を押したときに移る先（同じ画面の節の #id など） */
  href?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value.status === "loading" ? (
          STAT_TEXT.loading
        ) : value.status === "failed" ? (
          <span className="stat-failed">{STAT_TEXT.failed}</span>
        ) : (
          <>
            {value.value}
            {value.unit ? <span className="stat-unit">{value.unit}</span> : null}
          </>
        )}
      </span>
    </>
  );
  return (
    <li className={`stat-tile${tone === "alert" ? " is-alert" : ""}`}>
      {href ? (
        <a className="stat-link" href={href}>
          {body}
        </a>
      ) : (
        body
      )}
      {note ? <span className="stat-note">{note}</span> : null}
    </li>
  );
}
