import type { OfficialGuidance } from "@hpai/shared/guidance/official";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { SourceLine } from "../../ui/SourceLine";
import { Illust } from "./Illust";
import type { StatementNote } from "./pageNotes";

export const NOTES_HEADING = "このページからのお願い";
export const LEAD_HEADING = "要点（作品側のまとめ。国の文ではありません）";

/**
 * 「鶏を飼っていない方へ」の 1 つの節（§11）。国の機関の文は出典と確認日つきで、県のページはリンクだけで示す。
 * 作品側の文（notes）は、公式の文と見分けがつくよう、「このページからのお願い」の下にだけ置く。
 * id は topic と同じ（/area の本文などから /public#topic でここに来る）。
 * lead（すること 1 行）は見出しの直後に、国の文と違う見た目と見出しで置く。related は作品のほかの画面へのリンク。
 */
export function GuidanceSection({
  guidance,
  notes,
  statementNotes,
  lead,
  related,
  children,
}: {
  guidance: OfficialGuidance;
  notes?: readonly string[];
  /** 国の文の直後に添える、出典つきの注（作品側の要約）。引用の枠とは別の見た目 */
  statementNotes?: readonly StatementNote[];
  /** 見出しの直後の、すること 1 行（作品側のまとめ） */
  lead?: string;
  related?: ReadonlyArray<{ to: string; label: string }>;
  children?: ReactNode;
}) {
  const { topic, heading, statements, links } = guidance;
  const headingId = `${topic}-heading`;
  return (
    <section id={topic} data-topic={topic} className="guidance" aria-labelledby={headingId}>
      <h2 id={headingId} className="illust-heading">
        <Illust name={topic} />
        <span>{heading}</span>
      </h2>
      {lead ? (
        <aside data-role="section-lead" className="guidance-lead" aria-label={`${heading}の要点（国の文ではない、作品側のまとめ）`}>
          <h3>{LEAD_HEADING}</h3>
          <p>{lead}</p>
        </aside>
      ) : null}
      {statements.map((s, i) => (
        <Fragment key={i}>
          <div data-role="official" className="guidance-statement">
            <blockquote>
              <p>{s.text}</p>
            </blockquote>
            <SourceLine title={s.sourceTitle} url={s.sourceUrl} checkedOn={s.checkedOn} />
          </div>
          {(statementNotes ?? [])
            .filter((n) => s.text.includes(n.after))
            .map((n) => (
              <aside key={n.after} data-role="sourced-note" className="guidance-sourced-note" aria-label="国の文ではない、作品側の要約">
                <h3>作品側の要約（国の文ではありません）</h3>
                <p>{n.text}</p>
                <SourceLine title={n.sourceTitle} url={n.sourceUrl} checkedOn={n.checkedOn} />
              </aside>
            ))}
        </Fragment>
      ))}
      {links && links.length > 0 ? (
        <div className="guidance-links">
          <h3>県などのページ（リンクだけを置いています）</h3>
          <ul>
            {links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notes && notes.length > 0 ? (
        <div data-role="page-notes" className="guidance-notes">
          <h3>{NOTES_HEADING}</h3>
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {children}
      {related && related.length > 0 ? (
        <p className="guidance-related">
          <span className="guidance-related-label">関係する画面:</span>
          {related.map((r) => (
            <Link key={r.to} to={r.to}>
              {r.label}
            </Link>
          ))}
        </p>
      ) : null}
    </section>
  );
}
