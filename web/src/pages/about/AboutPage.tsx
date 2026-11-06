import { useEffect } from "react";
import { Link } from "react-router";
import { OPERATOR_NOTE } from "../../ui/AppShell";
import { operatorName, PrivacyContent } from "../privacy/PrivacyPage";
import { PRIVACY_NOTICE, PRIVACY_REVIEWED_ON } from "../privacy/privacyNotice";
import ResultsPage from "../results/ResultsPage";
import { ABOUT_TEXT, DATA_SOURCES, JUDGE_LINKS } from "./aboutTexts";

export type AboutSection = "judges" | "operator" | "sources" | "ai" | "privacy";
const ORDER: AboutSection[] = ["judges", "operator", "sources", "ai", "privacy"];
const anchor = (s: AboutSection) => `about-${s}`;

/**
 * このサイトについて（設計書 2026-11-06-ui-frame 3 章、決定 12・16）。審査員の方への入口、運営者、データの出典、AI の読み取りの確かさと費用
 * （今までの /results）、集める情報と消し方（今までの /privacy）を 1 画面に。focus を渡すと、開いたときにその節へ送る
 * （/results と /privacy の URL を残すため）
 */
export default function AboutPage({ focus }: { focus?: AboutSection }) {
  useEffect(() => {
    if (!focus) return;
    // 試験の結果の読み込みで高さが変わるので、描き終えてから送る
    const id = window.setTimeout(() => document.getElementById(anchor(focus))?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(id);
  }, [focus]);
  const operator = operatorName();
  const operatorParagraphs = PRIVACY_NOTICE.find((s) => s.heading === "運営者")?.paragraphs ?? [];
  return (
    <div className="about">
      <h1>{ABOUT_TEXT.title}</h1>
      <p>{ABOUT_TEXT.lead}</p>
      <nav aria-label={ABOUT_TEXT.tocLabel} className="privacy-toc">
        <ul>
          {ORDER.map((s) => (
            <li key={s}>
              <a href={`#${anchor(s)}`}>{ABOUT_TEXT.sections[s]}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section id={anchor("judges")} aria-labelledby={`${anchor("judges")}-h`}>
        <h2 id={`${anchor("judges")}-h`}>{ABOUT_TEXT.sections.judges}</h2>
        <p>{ABOUT_TEXT.judgesLead}</p>
        <ul className="about-judges">
          {JUDGE_LINKS.map((l) => (
            <li key={l.to}>
              {l.to.startsWith("#") ? (
                <a href={l.to} className="tap-link">
                  {l.label}
                </a>
              ) : (
                <Link to={l.to} className="tap-link">
                  {l.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section id={anchor("operator")} aria-labelledby={`${anchor("operator")}-h`}>
        <h2 id={`${anchor("operator")}-h`}>{ABOUT_TEXT.sections.operator}</h2>
        {operatorParagraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p>{operator === null ? "運営者名は、まだ入っていません。" : `運営者: ${operator}`}</p>
        <p>{OPERATOR_NOTE}</p>
      </section>

      <section id={anchor("sources")} aria-labelledby={`${anchor("sources")}-h`}>
        <h2 id={`${anchor("sources")}-h`}>{ABOUT_TEXT.sections.sources}</h2>
        <p>{ABOUT_TEXT.sourcesLead}</p>
        <ul className="about-sources">
          {DATA_SOURCES.map((d) => (
            <li key={d.name}>
              <strong>{d.name}</strong>
              <span>{d.use}</span>
              {d.url ? (
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="tap-link">
                  {d.url}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p>{ABOUT_TEXT.sourcesMore}</p>
      </section>

      <section id={anchor("ai")} aria-labelledby={`${anchor("ai")}-h`}>
        <h2 id={`${anchor("ai")}-h`}>{ABOUT_TEXT.sections.ai}</h2>
        <ResultsPage embedded />
      </section>

      <section id={anchor("privacy")} aria-labelledby={`${anchor("privacy")}-h`}>
        <h2 id={`${anchor("privacy")}-h`}>{ABOUT_TEXT.sections.privacy}</h2>
        <PrivacyContent reviewedOn={PRIVACY_REVIEWED_ON} embedded />
      </section>
    </div>
  );
}
