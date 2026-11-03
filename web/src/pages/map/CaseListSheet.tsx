import { PREFS } from "@hpai/shared/pref";
import type { IsoDate } from "@hpai/shared/types";
import { useId, useState } from "react";
import { DETECTION_LIMIT_NOTE, WILD_ZONE_NOTE, type ListRow, type WildBirdRow } from "./listRows";
import { SURVEILLANCE_NOTE, TEXT } from "./texts";

export interface CaseListSheetProps {
  rows: readonly ListRow[];
  /** 野鳥の行。null は出さない（過去のシーズンは野鳥を読んでいない） */
  birds: readonly WildBirdRow[] | null;
  /** false は「まだ読めていない」。0 件とは違う */
  loaded: boolean;
  /** 見回りで確認できていない県の数（今季）。1 以上なら「報告はありません」と断定しない。47 は「まだ確認できていません」。過去のシーズンは 0 */
  unwatchedCount: number;
}

function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

/** "2026-11-02" → "2026 年 11 月 2 日" */
function fullDate(d: IsoDate): string {
  const [y, m, day] = d.split("-");
  return `${Number(y)} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

function Sources({ urls }: { urls: readonly string[] }) {
  const web = urls.filter(isWebUrl);
  return (
    <>
      {web.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="case-source">
          {TEXT.listSource}
          {web.length > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
    </>
  );
}

function CaseRow({ r }: { r: ListRow }) {
  // 確認中は県名、確認中、リンクだけ（公表の前の読み取りを出さない。§12）
  const parts = r.reviewing
    ? [r.prefName, r.label]
    : [
        `${r.prefName} ${r.muniName ?? ""}`.trim(),
        r.label,
        r.date ? fullDate(r.date) : null,
        r.headCount === null ? "羽数の記載なし" : `${r.headCount.toLocaleString("ja-JP")} 羽`,
      ];
  return (
    <li className="case-row" data-reviewing={r.reviewing ? "true" : undefined}>
      {parts.filter((p): p is string => p !== null).join("　")} <Sources urls={r.sourceUrls} />
    </li>
  );
}

/**
 * 発生の一覧。閉じると 1 行で、押して開ける。農場の特徴や不備の項目は持たない（§12）。
 * 開くと、検知の限り（§9.2）、野鳥の区域との違い（§5）、監視強化区域の説明を添える。
 */
export function CaseListSheet({ rows, birds, loaded, unwatchedCount }: CaseListSheetProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const count = rows.length;
  const noneChecked = unwatchedCount >= PREFS.length && count === 0;
  // 確認できていない県があるうちは、件数を「確認できた範囲では N 件」にする（0 件を「発生なし」と読ませない）
  const countLabel = noneChecked ? TEXT.listNoneCheckedShort : unwatchedCount > 0 ? `${TEXT.listPartialLabel} ${count} 件` : `${count} 件`;
  return (
    <section className="case-list">
      <button type="button" className="case-list-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {TEXT.listClosed}（{loaded ? countLabel : TEXT.listNotLoaded}）<span aria-hidden="true">{open ? " ▲" : " ▼"}</span>
      </button>
      {open ? (
        <div id={id} className="case-list-body">
          {!loaded ? (
            <p role="status">{TEXT.listLoadingBody}</p>
          ) : count === 0 ? (
            <p>
              {noneChecked
                ? TEXT.listNoneChecked
                : unwatchedCount > 0
                  ? `${TEXT.listEmptyPartial}（${unwatchedCount} 県は確認できていません）。`
                  : TEXT.listEmpty}
            </p>
          ) : (
            <ul className="case-rows" aria-label={TEXT.listAria}>
              {rows.map((r) => (
                <CaseRow key={r.id} r={r} />
              ))}
            </ul>
          )}
          {birds !== null && birds.length > 0 ? (
            <>
              <h3 className="case-list-sub">{TEXT.listBirdsHeading}</h3>
              <ul className="case-rows" aria-label={TEXT.listBirdsAria}>
                {birds.map((b) => (
                  <li key={b.id} className="case-row">
                    {[`${b.prefName} ${b.muniName ?? ""}`.trim(), b.species, b.label, fullDate(b.date)].filter((p): p is string => !!p).join("　")}{" "}
                    <Sources urls={[b.sourceUrl]} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <ul className="case-notes">
            {[DETECTION_LIMIT_NOTE, WILD_ZONE_NOTE, SURVEILLANCE_NOTE].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
