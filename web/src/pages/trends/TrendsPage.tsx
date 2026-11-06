// /trends: 全国の傾向（X-27、設計書 §2、§4 の C、§7）。国の疫学調査チームの現地調査の概要を、3 つの項目に揃えて数えた結果。
// 読むのは静的ファイル（/trends/summary.json）だけで、Claude も Firestore も呼ばない。
// 事例や市町村と結びつけない【決定】。集計がまだなければ「準備中です」のまま。
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Placeholder } from "../../ui/Placeholder";
import MigrationRoutes from "./MigrationRoutes";
import MigrationSection from "./MigrationSection";
import TrendsInsights from "./TrendsInsights";
import { parseTrendInsights, type TrendInsights } from "./insightsTypes";
import { parseTrendSummary, type TrendSummary } from "./types";

function BackLinks() {
  return (
    <p>
      <Link to="/" className="tap-link">地図にもどる</Link>　<Link to="/results" className="tap-link">試験の結果を見る</Link>
    </p>
  );
}

type Load = { s: "loading" } | { s: "none" } | { s: "failed" } | { s: "ready"; v: TrendSummary; insights: TrendInsights | null };

/** 深掘りの集計（/trends/insights.json、設計書 2026-11-06-trends-redesign）。無い、読めない、形が違うときは null で、今の表示に戻る */
async function loadInsights(): Promise<TrendInsights | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}trends/insights.json`);
    if (!res.ok) return null;
    return parseTrendInsights(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}

async function load(): Promise<Load> {
  try {
    const insights = loadInsights();
    const res = await fetch(`${import.meta.env.BASE_URL}trends/summary.json`);
    if (res.status === 404) return { s: "none" };
    if (!res.ok) return { s: "failed" };
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // ファイルが無いときに index.html を返す配信は、まだ集計していない扱い
      return (res.headers.get("content-type") ?? "").includes("text/html") ? { s: "none" } : { s: "failed" };
    }
    const v = parseTrendSummary(json);
    return v === null ? { s: "failed" } : { s: "ready", v, insights: await insights };
  } catch {
    return { s: "failed" };
  }
}

/** "2026-11-08T10:00:00+09:00" → "2026-11-08 10:00"。書いてある時刻をそのまま出す */
function formatAt(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** 2025 → "2025/26 シーズン" */
const seasonLabel = (season: number): string => `${season}/${String((season + 1) % 100).padStart(2, "0")} シーズン`;

export default function TrendsPage() {
  const [state, setState] = useState<Load>({ s: "loading" });

  useEffect(() => {
    let off = false;
    void load().then((r) => {
      if (!off) setState(r);
    });
    return () => {
      off = true;
    };
  }, []);

  if (state.s === "loading") return <p role="status">全国の傾向を読み込んでいます</p>;
  // 渡り鳥の枠は別のファイルを読む。現地調査の集計が無くても、枠だけは出す
  if (state.s === "none")
    return (
      <div>
        <Placeholder title="全国の傾向" />
        <MigrationSection />
        <MigrationRoutes />
        <BackLinks />
      </div>
    );
  if (state.s === "failed")
    return (
      <div>
        <h1>全国の傾向</h1>
        <p role="alert">集計を読み込めませんでした。時間をおいて開き直してください。</p>
        <MigrationSection />
        <MigrationRoutes />
        <BackLinks />
      </div>
    );

  const { generatedAt, seasons, sourceUrls } = state.v;
  if (state.insights)
    return (
      <div className="trends">
        <h1>全国の傾向</h1>
        <p>国の疫学調査チームが発生農場で行った現地調査の概要から、国の報告書で多かった 3 つの項目を数えました。{formatAt(state.insights.generatedAt)} 時点。</p>
        <TrendsInsights v={state.insights} />
        <details className="tr-sources">
          <summary>数え方と出典</summary>
          <p>自由記述を Claude が項目に揃え、根拠の文で照合できたものだけを数えました。全件を人が確かめたものではありません。</p>
          <p>事例ごとの現地調査の概要に書かれた指摘だけを数えています。事例や市町村とは結びつけていません。</p>
          <ul>
            {sourceUrls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer">
                  農林水産省 シーズンごとの鳥インフルエンザの情報（疫学調査の結果）: {u}
                </a>
              </li>
            ))}
          </ul>
        </details>
        <MigrationSection />
        <MigrationRoutes />
        <BackLinks />
      </div>
    );
  return (
    <div className="trends">
      <h1>全国の傾向</h1>
      <p>全国の傾向です。国の疫学調査チームが発生農場で行った現地調査の概要から、国の報告書で多かった 3 つの項目を数えました。</p>
      <p>自由記述を Claude が項目に揃えた結果で、全件を人が確かめたものではありません。</p>
      <p>事例ごとの現地調査の概要に書かれた指摘だけを数えています。「外部事業者の専用の衣服や靴」は、概要の多くが「外部の業者も専用の衣服や靴に替えて入る」と書いており、不備と書かれた事例は少なく、国の報告書の集計（半数以上の農場）より少なく出ます。数え方が違います。</p>
      <p>事例や市町村とは結びつけていません。</p>
      <p>{formatAt(generatedAt)} 時点</p>

      {seasons.map((s) => (
        <section key={s.season}>
          <h2>{seasonLabel(s.season)}</h2>
          <p>読めた現地調査の概要: {s.surveyed} 件</p>
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">あったと書かれていた</th>
                <th scope="col">触れていなかった</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.key}>
                  <th scope="row">{i.label}</th>
                  <td className="num">{i.issueCount} 件</td>
                  <td className="num">{i.notMentionedCount} 件</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ))}

      <h2>出典</h2>
      <ul>
        {sourceUrls.map((u) => (
          <li key={u}>
            <a href={u} target="_blank" rel="noreferrer">
              農林水産省 シーズンごとの鳥インフルエンザの情報（疫学調査の結果）: {u}
            </a>
          </li>
        ))}
      </ul>

      <MigrationSection />
      <MigrationRoutes />
      <BackLinks />
    </div>
  );
}
