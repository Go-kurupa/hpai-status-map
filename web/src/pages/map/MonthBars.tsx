import type { MonthBar } from "./seasonView";
import { TEXT } from "./texts";

const nf = new Intl.NumberFormat("ja-JP");

/** 月ごとの件数と羽数。表にして、棒の長さは件数に比例。羽数の分からない事例は数を書く */
export function MonthBars({ months, loaded, allUnchecked, past }: { months: readonly MonthBar[]; loaded: boolean; allUnchecked?: boolean; past?: boolean }) {
  if (!loaded) {
    return (
      <section className="month-bars">
        <h2>月ごとの件数と羽数</h2>
        <p>まだ読めていません。</p>
      </section>
    );
  }
  if (allUnchecked) {
    return (
      <section className="month-bars">
        <h2>月ごとの件数と羽数</h2>
        <p>{TEXT.listNoneChecked}</p>
      </section>
    );
  }
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <section className={past ? "month-bars is-past" : "month-bars"}>
      <h2>月ごとの件数と羽数</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">月</th>
            <th scope="col">件数</th>
            <th scope="col">羽数</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{m.month} 月</th>
              <td>
                <span className="month-bar-track" aria-hidden="true">
                  <span className="month-bar-fill" style={{ width: `${(m.count / max) * 100}%` }} />
                </span>
                {m.count} 件
              </td>
              <td>
                {nf.format(m.headCount)} 羽
                {m.unknownHeadCases > 0 ? <small>（羽数の分からない事例 {m.unknownHeadCases} 件）</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
