import type { OfficialGuidance } from "@hpai/shared/guidance/official";
import type { ReactNode } from "react";
import { SourceLine } from "../../ui/SourceLine";

export const NOTES_HEADING = "このページからのお願い";

/**
 * 「鶏を飼っていない方へ」の 1 つの節（§11）。国の機関の文は出典と確認日つきで、県のページはリンクだけで示す。
 * 作品側の文（notes）は、公式の文と見分けがつくよう、「このページからのお願い」の下にだけ置く。
 * id は topic と同じ（/area の本文などから /public#topic でここに来る）。
 */
export function GuidanceSection({ guidance, notes, children }: { guidance: OfficialGuidance; notes?: readonly string[]; children?: ReactNode }) {
  const { topic, heading, statements, links } = guidance;
  const headingId = `${topic}-heading`;
  return (
    <section id={topic} data-topic={topic} className="guidance" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {statements.map((s, i) => (
        <div key={i} data-role="official" className="guidance-statement">
          <blockquote>
            <p>{s.text}</p>
          </blockquote>
          <SourceLine title={s.sourceTitle} url={s.sourceUrl} checkedOn={s.checkedOn} />
        </div>
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
    </section>
  );
}
