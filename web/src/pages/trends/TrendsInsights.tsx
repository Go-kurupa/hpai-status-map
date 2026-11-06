// /trends の「発生農場で見つかったこと」（設計書 2026-11-06-trends-redesign §4、作者の決定: 案 C、要点に割合）。
// 要点 → 項目の帯（シーズンで切り替え）→ 押すと詳しい欄。PC では右の欄、スマホ（64rem 未満）では押した帯のすぐ下に出す。
// 発生した農場の記録で、発生していない農場との比べではない。この断りは要点の枠から外さない。
import { useState } from "react";
import { Link } from "react-router";
import { useNarrow } from "../map/useNarrow";
import { isSuppressed, type InsightCounts, type InsightNoticing, type InsightSeason, type TrendInsights } from "./insightsTypes";
import { TREND_LABELS, type TrendKey } from "./types";
import "./trends.css";

/** 2025 → "2025/26" */
export const seasonShort = (s: number): string => `${s}/${String((s + 1) % 100).padStart(2, "0")}`;

/** 189 / 246 → "約 8 割"。割合は 1 割きざみに丸める */
export function wari(n: number, d: number): string {
  if (d === 0) return "";
  const w = Math.round((n / d) * 10);
  return w === 0 ? "1 割未満" : w === 10 && n < d ? "9 割以上" : w === 10 ? "すべて" : `約 ${w} 割`;
}

const ORDER: readonly TrendKey[] = ["rodent_signs", "wall_net_damage", "external_clothing"];
const count = (s: InsightSeason, k: TrendKey): InsightCounts => s.items.find((i) => i.key === k)!;

function Stack({ c, small }: { c: InsightCounts; small?: boolean }) {
  const t = c.issue + c.noIssue + c.notMentioned;
  const w = (v: number): string => `${t === 0 ? 0 : (v / t) * 100}%`;
  return (
    <span className={small ? "tr-stack tr-stack-small" : "tr-stack"} aria-hidden="true">
      <i className="tr-yes" style={{ width: w(c.issue) }} />
      <i className="tr-no" style={{ width: w(c.noIssue) }} />
      <i className="tr-none" style={{ width: w(c.notMentioned) }} />
    </span>
  );
}

function Key() {
  return (
    <p className="tr-key" aria-hidden="true">
      <span className="tr-key-yes">あったと書かれていた</span>
      <span className="tr-key-no">なかったと書かれていた</span>
      <span className="tr-key-none">触れていない</span>
    </p>
  );
}

function Points({ v }: { v: TrendInsights }) {
  const t = v.total;
  const r = count(t, "rodent_signs");
  const w = count(t, "wall_net_damage");
  const c = count(t, "external_clothing");
  const general = v.reportQuotes.find((q) => q.about === "general");
  return (
    <section className="tr-points" aria-labelledby="tr-points-title">
      <h2 id="tr-points-title">要点（過去 {v.seasons.length} シーズンの発生農場）</h2>
      <ul>
        <li>
          現地調査の概要 <strong>{t.surveyed}</strong> 件のうち、ねずみの痕跡があったと書かれていたのは <strong>{r.issue}</strong> 件（{wari(r.issue, t.surveyed)}）
        </li>
        <li>
          壁やネットの破損があったと書かれていたのは <strong>{w.issue}</strong> 件（{wari(w.issue, t.surveyed)}）
        </li>
        <li>
          外部事業者の専用の衣服や靴は、不備ありが <strong>{c.issue}</strong> 件（{wari(c.issue, t.surveyed)}）、不備なしと書かれていたのが <strong>{c.noIssue}</strong> 件（{wari(c.noIssue, t.surveyed)}）
        </li>
      </ul>
      <p className="tr-caveat">発生した農場の記録です。発生していない農場との比べはありません。数は、発生の原因を示すものではありません。</p>
      {general ? (
        <p className="tr-report">
          国の報告書（{seasonShort(general.season)}）: 「{general.text}」
        </p>
      ) : null}
    </section>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="tr-hbars">
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.label}>
            <span className="tr-hbar-label">{r.label}</span>
            <span className="tr-hbar-track" aria-hidden="true">
              <i style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="tr-hbar-val">{r.count} 件</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ v, k }: { v: TrendInsights; k: TrendKey }) {
  const ph = v.phrases.find((p) => p.key === k);
  const quotes = v.reportQuotes.filter((q) => q.about === k);
  return (
    <div className="tr-detail" id={`tr-detail-${k}`}>
      <h3>{TREND_LABELS[k]}</h3>
      <div className="tr-seasons">
        <h4>シーズンごと</h4>
        <ul>
          {[...v.seasons].reverse().map((s) => {
            const c = count(s, k);
            return (
              <li key={s.season}>
                <span className="tr-season-label">{seasonShort(s.season)}</span>
                <Stack c={c} small />
                <span className="tr-season-num">
                  {c.issue} ／ {s.surveyed} 件
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {ph ? (
        <>
          <Bars title={`根拠の 1 文に出てきた語（あった ${ph.base} 件の内訳）`} rows={ph.words} />
          <p className="tr-note">1 文が複数の語に入ります。どの語にも当たらなかった文が {ph.unmatched} 件あります。概要の全文を数えたものではありません。</p>
        </>
      ) : null}
      {k === "rodent_signs" ? (
        <p className="tr-note">
          根拠の文の出どころ: 調査のときに見つかった {v.rodentSource.survey} 件、農場の人の話（「時々見かける」など）{v.rodentSource.interview} 件、どちらとも読めない {v.rodentSource.unclear} 件。
        </p>
      ) : null}
      {k === "wall_net_damage" ? <p className="tr-note">鶏舎のほか、堆肥舎などの破損も入っています。</p> : null}
      {k === "external_clothing" ? (
        <p className="tr-note">
          国の報告書は「半数以上の農場で不備」と書いています。現地調査の概要の多くは「外部の業者も専用の衣服や靴に替えて入る」と書いており、不備と書かれた事例は少なく出ます。数え方が違います。
        </p>
      ) : null}
      {v.groups.map((g) => (
        <table className="tr-group" key={g.dimension}>
          <caption>{g.dimension === "housing" ? "飼い方" : "用途"}ごと（{v.seasons.length} シーズン合計。あったと書かれていた ／ 件数）</caption>
          <tbody>
            {g.rows.map((r) => {
              const c = r.issue[k];
              return (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{isSuppressed(c) ? `伏せています ／ ${r.total} 件` : `${c} ／ ${r.total} 件（${wari(c, r.total)}）`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      {v.groups.some((g) => g.rows.some((r) => isSuppressed(r.issue[k]))) ? <p className="tr-note">数が小さい欄は、事例が特定されないよう伏せています。</p> : null}
      {quotes.length > 0 ? (
        <div className="tr-quotes">
          <h4>国の報告書の言い方</h4>
          {quotes.map((q) => (
            <blockquote key={q.text}>
              <p>「{q.text}」</p>
              <footer>
                <a href={q.reportUrl} target="_blank" rel="noopener noreferrer">
                  農林水産省「{q.reportTitle}」
                </a>
              </footer>
            </blockquote>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 段階 2（設計書 §4.4）。通報の早さ・遅さの評価はしない。6 シーズン合計だけ */
function Noticing({ n }: { n: InsightNoticing }) {
  return (
    <section className="tr-noticing" aria-labelledby="tr-noticing-title">
      <h2 id="tr-noticing-title">発生農場はどう気づいたか</h2>
      <p>
        同じ現地調査の概要 {n.read} 件から、通報までの経緯と周りの様子を読み取りました。通報の早さや遅さを評価するものではありません。
      </p>
      <div className="tr-noticing-grid">
        {n.fields.map((f) => (
          <div key={f.key} className="tr-noticing-field">
            <Bars title={f.label} rows={f.values.map((x) => ({ label: x.label, count: x.count }))} />
            {f.unverified > 0 ? <p className="tr-note">根拠の文を原文で確かめられなかった {f.unverified} 件は数えていません。</p> : null}
          </div>
        ))}
      </div>
      <p className="tr-note">
        日々の死亡数を記録しておくと、普段との違いに気づきやすくなります。<Link to="/sample/record/deaths" className="tap-link">死亡数の記録を見本で試す</Link>
      </p>
    </section>
  );
}

export default function TrendsInsights({ v }: { v: TrendInsights }) {
  const [season, setSeason] = useState<number | "all">("all");
  const [selected, setSelected] = useState<TrendKey | null>("rodent_signs");
  const narrow = useNarrow();
  const shown = season === "all" ? v.total : v.seasons.find((s) => s.season === season)!;

  const rows = ORDER.map((k) => {
    const c = count(shown, k);
    const open = selected === k;
    return (
      <li key={k} className={open ? "tr-row tr-row-open" : "tr-row"}>
        <button type="button" aria-expanded={open} aria-controls={`tr-detail-${k}`} onClick={() => setSelected(open && narrow ? null : k)}>
          <span className="tr-row-head">
            <span className="tr-row-label">{TREND_LABELS[k]}</span>
            <span className="tr-row-more">{open ? (narrow ? "閉じる" : "表示中") : "くわしく"}</span>
          </span>
          <Stack c={c} />
          <span className="tr-row-nums">
            あった {c.issue} 件 ／ なかった {c.noIssue} 件 ／ 触れていない {c.notMentioned} 件（{shown.surveyed} 件中）
          </span>
        </button>
        {narrow && open ? <Detail v={v} k={k} /> : null}
      </li>
    );
  });

  return (
    <>
      <Points v={v} />
      <section className="tr-findings" aria-labelledby="tr-findings-title">
        <h2 id="tr-findings-title">発生農場で見つかったこと</h2>
        <div className="tr-grid">
          <div className="tr-main">
            <div className="tr-chips" role="group" aria-label="シーズン">
              {(["all", ...[...v.seasons].map((s) => s.season).sort((a, b) => a - b)] as const).map((s) => (
                <button key={s} type="button" aria-pressed={season === s} onClick={() => setSeason(s)}>
                  {s === "all" ? `${v.seasons.length} シーズン合計` : seasonShort(s)}
                </button>
              ))}
            </div>
            <Key />
            <ul className="tr-rows">{rows}</ul>
            <details className="tr-table">
              <summary>数の表を見る</summary>
              <div className="table-scroll">
                <table className="data-table">
                  <caption>{season === "all" ? `${v.seasons.length} シーズン合計` : `${seasonShort(season)} シーズン`}（読めた概要 {shown.surveyed} 件）</caption>
                  <thead>
                    <tr>
                      <th scope="col">項目</th>
                      <th scope="col">あったと書かれていた</th>
                      <th scope="col">なかったと書かれていた</th>
                      <th scope="col">触れていなかった</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ORDER.map((k) => {
                      const c = count(shown, k);
                      return (
                        <tr key={k}>
                          <th scope="row">{TREND_LABELS[k]}</th>
                          <td className="num">{c.issue} 件</td>
                          <td className="num">{c.noIssue} 件</td>
                          <td className="num">{c.notMentioned} 件</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
          {!narrow ? (
            <aside className="tr-side" aria-live="polite" aria-label="くわしく">
              {selected ? <Detail v={v} k={selected} /> : <p className="tr-note">左の項目を押すと、ここにくわしい内容が出ます。</p>}
            </aside>
          ) : null}
        </div>
      </section>
      {v.noticing ? <Noticing n={v.noticing} /> : null}
    </>
  );
}
