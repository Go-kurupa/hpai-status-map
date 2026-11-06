// /trends の「渡り鳥の飛来（季節の参考）」の枠。読むのは静的ファイル（/migration/summary.json）だけで、Claude も Firestore も呼ばない。
// 農場の危険度や警報ではない。環境省の調査の水鳥の数を、同じ地点の過去の同じ時期と並べただけで、「多い」「少ない」の判定も予測もしない。
// 地図の部品（WebGL）は使わない。幅 360px で横にはみ出さないよう、表ではなく地点ごとの縦の並びにする。
import { useEffect, useState } from "react";
import { parseMigrationSummary, type MigrationArrival, type MigrationSite, type MigrationSummary } from "./migrationTypes";
import "./migration.css";

type Load = { s: "loading" } | { s: "none" } | { s: "failed" } | { s: "ready"; v: MigrationSummary };

async function load(): Promise<Load> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}migration/summary.json`);
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
    const v = parseMigrationSummary(json);
    return v === null ? { s: "failed" } : { s: "ready", v };
  } catch {
    return { s: "failed" };
  }
}

/** "2026-10-14" → "10 月 14 日" */
export function mdLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日`;
}
/** "2026-10-14" → "2026 年 10 月 14 日" */
function ymdLabel(iso: string): string {
  return `${Number(iso.slice(0, 4))} 年 ${mdLabel(iso)}`;
}
const num = (n: number): string => n.toLocaleString("ja-JP");

/**
 * 過去の同じ時期の幅（帯）、中央値（縦線）、今季の最新（点）を 1 本の目盛りに並べる（設計書 2026-11-06-trends-redesign §4.5）。
 * 目盛りは地点ごと（その地点の最大の値が右端）。判定の言葉は付けない。数は下の文にある。
 */
export function RangeStrip({ s }: { s: MigrationSite }) {
  const b = s.baseline;
  if (!b) return null;
  const top = Math.max(b.max, s.latestTotal, 1);
  const x = (v: number): number => 4 + (v / top) * 292;
  return (
    <svg className="migration-range" viewBox="0 0 300 20" aria-hidden="true" focusable="false">
      <line x1="4" x2="296" y1="10" y2="10" className="migration-range-axis" />
      <rect x={x(b.min)} y="4" width={Math.max(2, x(b.max) - x(b.min))} height="12" rx="3" className="migration-range-band" />
      <line x1={x(b.median)} x2={x(b.median)} y1="1" y2="19" className="migration-range-median" />
      <circle cx={x(s.latestTotal)} cy="10" r="5" className="migration-range-now" />
    </svg>
  );
}

function RangeKey() {
  return (
    <p className="migration-range-key" aria-hidden="true">
      <span className="k-band">過去の同じ時期の幅</span>
      <span className="k-median">中央値</span>
      <span className="k-now">今季の最新</span>
    </p>
  );
}

/** "2025-10-02" → 9 月 1 日からの日数（年をまたがない秋の調査だけを並べる） */
const dayOfAutumn = (iso: string): number => {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return [0, 30, 61, 91][m - 9]! + d - 1;
};

/** 飛来の早さを時間軸に並べる。帯は過去の初記録日の幅、点は今季（まだならその旨） */
function ArrivalTimeline({ arrivals }: { arrivals: MigrationArrival[] }) {
  const rows = arrivals
    .map((a) => ({ a, past: a.past.flatMap((p) => (p.date && Number(p.date.slice(5, 7)) >= 9 && Number(p.date.slice(5, 7)) <= 12 ? [dayOfAutumn(p.date)] : [])) }))
    .filter((r) => r.past.length > 0);
  if (rows.length === 0) return null;
  const all = rows.flatMap((r) => [...r.past, ...(r.a.currentDate ? [dayOfAutumn(r.a.currentDate)] : [])]);
  const lo = Math.max(0, Math.min(...all) - 7);
  const hi = Math.min(121, Math.max(...all) + 7);
  /** 0〜100（%）。目盛りの文字は図の外の HTML に出す（SVG の中の文字は縮んで小さくなるため） */
  const X = (d: number): number => ((d - lo) / Math.max(1, hi - lo)) * 100;
  const ticks = (
    [
      ["9/1", 0],
      ["10/1", 30],
      ["11/1", 61],
      ["12/1", 91],
    ] as [string, number][]
  ).filter(([, d]) => d >= lo && d <= hi);
  return (
    <ul className="migration-timeline" aria-hidden="true">
      {rows.map(({ a, past }) => (
        <li key={`${a.siteId}-${a.species}-${a.threshold}`}>
          <span className="migration-tl-name">
            {a.siteName}の{a.species}
          </span>
          <span className="migration-tl-track">
            <svg viewBox="0 0 100 16" preserveAspectRatio="none" focusable="false">
              {ticks.map(([t, d]) => (
                <line key={t} x1={X(d)} x2={X(d)} y1="0" y2="16" className="migration-range-axis" vectorEffect="non-scaling-stroke" />
              ))}
              <rect x={X(Math.min(...past))} y="3" width={Math.max(1, X(Math.max(...past)) - X(Math.min(...past)))} height="10" className="migration-range-band" />
              {a.currentDate ? <rect x={X(dayOfAutumn(a.currentDate)) - 1} y="1" width="2" height="14" className="migration-range-now" /> : null}
            </svg>
            {a.currentDate ? null : <span className="migration-tl-still">今季はまだ</span>}
          </span>
        </li>
      ))}
      <li>
        <span />
        <span className="migration-tl-ticks">
          {ticks.map(([t, d]) => (
            <span key={t} style={{ left: `${X(d)}%` }}>
              {t}
            </span>
          ))}
        </span>
      </li>
    </ul>
  );
}

function SiteItem({ s, baselineCount }: { s: MigrationSite; baselineCount: number }) {
  const b = s.baseline;
  return (
    <li className="migration-site">
      <h3>{s.name}</h3>
      <RangeStrip s={s} />
      <p>
        今季の最新（{mdLabel(s.latestDate)}の調査）: <strong>{num(s.latestTotal)} 羽</strong>
      </p>
      {s.unreported > 0 ? (
        <p>この地点は{mdLabel(s.latestDate)}の調査が最新です（報告が未着の回が {s.unreported} 回あります）。</p>
      ) : null}
      {b ? (
        <p>
          過去 {b.n} シーズンの同じ時期: {num(b.min)} 〜 {num(b.max)} 羽（中央値 {num(b.median)} 羽）。
          {b.n < baselineCount ? `調査の近い回がそろった ${b.n} シーズンだけです。` : ""}
        </p>
      ) : (
        <p>過去の同じ時期と比べられる回がそろいませんでした。</p>
      )}
    </li>
  );
}

function ArrivalItem({ a }: { a: MigrationArrival }) {
  const dated = a.past.filter((p) => p.date !== null);
  const early = dated.filter((p) => p.atFirstSurvey).length;
  const sorted = dated.map((p) => p.date as string).sort((x, y) => (x.slice(5) < y.slice(5) ? -1 : 1));
  return (
    <li className="migration-site">
      <h3>
        {a.siteName}の{a.species}（1 回の調査で {num(a.threshold)} 羽以上）
      </h3>
      <p>
        今季:{" "}
        {a.currentDate ? <strong>{mdLabel(a.currentDate)}の調査で初めて記録</strong> : <>まだ記録がありません（{mdLabel(a.latestSurveyDate)}の調査まで）</>}
      </p>
      {sorted.length > 0 ? (
        <p>
          過去 {a.past.length} シーズンのうち {dated.length} シーズンで記録があり、初めて記録した調査日は {mdLabel(sorted[0]!)} 〜 {mdLabel(sorted[sorted.length - 1]!)} でした。
          {early > 0 ? `${early} シーズンは最初の調査の回で既に超えていたため、実際はもっと早かった可能性があります。` : ""}
        </p>
      ) : (
        <p>過去のシーズンでは、この羽数に届いた記録がありません。</p>
      )}
    </li>
  );
}

export default function MigrationSection() {
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

  if (state.s === "loading") return <p role="status">渡り鳥の飛来の参考を読み込んでいます</p>;
  if (state.s === "none")
    return (
      <section className="migration" aria-labelledby="migration-title">
        <h2 id="migration-title">渡り鳥の飛来（季節の参考）</h2>
        <p>この集計は、まだ作られていません。</p>
      </section>
    );
  if (state.s === "failed")
    return (
      <section className="migration" aria-labelledby="migration-title">
        <h2 id="migration-title">渡り鳥の飛来（季節の参考）</h2>
        <p role="alert">渡り鳥の飛来の集計を読み込めませんでした。時間をおいて開き直してください。</p>
      </section>
    );

  const { sites, arrivals, sourceUrl, baselineSeasons } = state.v;
  const asOf = sites.reduce((m, s) => (s.latestDate > m ? s.latestDate : m), "");
  const fetchedOn = sites.reduce((m, s) => (s.fetchedAt > m ? s.fetchedAt : m), "");
  const first = baselineSeasons[0];
  const last = baselineSeasons[baselineSeasons.length - 1];

  return (
    <section className="migration" aria-labelledby="migration-title">
      <h2 id="migration-title">渡り鳥の飛来（季節の参考）</h2>
      <p>環境省が全国の定点で数えた水鳥（ガン・ハクチョウ・カモ類）の数を、同じ地点の過去の同じ時期と並べました。季節の進みの目安です。水鳥の数は、種ごとの羽数と、種まで分からなかった「カモ類」などの羽数を足したものです。</p>

      <p className="migration-caveat">農場の危険度や警報ではありません。この数から、ご自分の農場や地域の状況は分かりません。</p>
      <ul className="migration-notes migration-small">
        <li>調査の回ごとの数は、年によって大きく揺れます。数え方の範囲や調査日のずれにも左右されます。</li>
        <li>感染の情報は含みません。鳥インフルエンザの検査の結果とは別の調査です。</li>
        <li>調査から公開まで、数日から 2 週間ほどかかります。下の日付は調査の日で、今日の様子ではありません。</li>
        <li>これからの飛来や発生を予測するものではありません。</li>
      </ul>

      {sites.length === 0 ? (
        <p>載せられる地点がありません。</p>
      ) : (
        <p>
          最も新しい調査日: <strong>{ymdLabel(asOf)}</strong>（データの取得日 {ymdLabel(fetchedOn)}）。調査日は地点ごとに違い、下に地点ごとの日付を付けています。
        </p>
      )}

      <h3 className="migration-sub">地点ごとの水鳥の数</h3>
      <p>北から南の順です。図の目盛りは地点ごとに違います（羽数の桁が地点で違うため）。</p>
      <RangeKey />
      <details className="migration-more">
        <summary>比べ方と、載せている地点</summary>
        <p>
          比べるのは {first}〜{last} 年秋のシーズンのうち、今季の最新の調査日に近い日（前後 7 日以内）の調査です。国指定鳥獣保護区の地点と、岡山県の 1 地点のうち、過去の一覧にも連続して載っている地点を候補にし、過去の同じ時期の中央値が 100 羽未満の地点は載せていません。ツルが主な出水・高尾野も、ツルは水鳥の合計に入らず水鳥の数が小さいため載せていません。載っていない地点は「調べていない」「いない」という意味ではありません。
        </p>
      </details>
      <ul className="migration-list migration-grid">
        {sites.map((s) => (
          <SiteItem key={s.id} s={s} baselineCount={baselineSeasons.length} />
        ))}
      </ul>

      {arrivals.length > 0 ? (
        <>
          <h3 className="migration-sub">飛来の早さ</h3>
          <p>地点と種を絞り、1 回の調査で決めた羽数に初めて届いた調査日を、過去のシーズンの幅と並べました。調査は 2 週間ほどの間隔なので、日付の精度はその程度です。図の帯は過去のシーズンの初めて記録した日の幅、赤い縦線は今季です。</p>
          <ArrivalTimeline arrivals={arrivals} />
          <ul className="migration-list migration-grid">
            {arrivals.map((a) => (
              <ArrivalItem key={`${a.siteId}-${a.species}-${a.threshold}`} a={a} />
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="migration-sub">出典</h3>
      <p>
        出典:{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          環境省「渡り鳥の飛来状況」
        </a>
        （{sourceUrl}）。
      </p>
      <p className="migration-small">
        この作品が地点ごとの Excel ファイルから水鳥の合計を求め、過去のシーズンと並べるよう加工しました（編集・加工の主体: この作品の作者）。加工した結果は環境省が作成したものではありません。水鳥の合計は、ガン・ヒシクイ・ハクチョウ・カモ・アイサの種の羽数と、「カモ類」「ハクチョウ類」「ガン類」などの種まで分からなかった羽数の和で、ツル、カモメ、家禽のアイガモなどは含みません。空欄は 0 羽として足しています。水鳥の欄に数が 1 つもない回は、数の記録がない回として扱います。
      </p>
    </section>
  );
}
