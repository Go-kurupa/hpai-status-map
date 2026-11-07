import { jstDateOf } from "@hpai/shared/dates";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useDataSource } from "../../data/context";
import { Button } from "../../ui/Button";
import "./poster.css";

// 貼り紙（§11）。農場の入口に貼る A4。平時から貼れるよう、発生とは読めない文にする。
// 県や家保の看板に似せない（「告」の字、法律の条文、罰則、役所の書式は入れない）。農場名、社名、住所は入れず、
// 連絡先は手書きの空欄にする。「安全」「安心」と書かない。病名は書かない（索引 Q15-6 の既定）。
// 文字の大きさは poster.css の変数。目安は 見出し 100pt、小見出し 48pt、本文 32pt だが、A4 1 枚に収まる大きさにしている。

/** 難しい漢字の上に読みを付ける */
function R({ base, rt }: { base: string; rt: string }) {
  return (
    <ruby>
      {base}
      <rt>{rt}</rt>
    </ruby>
  );
}

/** 1 行 18 文字以内（読みは数えない）。行ごとに別の要素にして、紙の上で行が割れないようにする */
function Line({ children }: { children: ReactNode }) {
  return (
    <p className="poster-line" data-testid="poster-line">
      {children}
    </p>
  );
}

/** "2026-11-04" → "2026 年 11 月 4 日" */
function printDate(d: Date): string {
  const [y, m, day] = jstDateOf(d).split("-");
  return `${Number(y)} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

function qrSvg(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ scalable: true, margin: 0 });
}

export default function PosterPage() {
  const ds = useDataSource();
  // 印刷の直前に日付を取り直す（画面を開いたまま日をまたいでも、印刷日が古くならない）
  const [now, setNow] = useState(() => ds.now());
  useEffect(() => {
    const refresh = () => setNow(ds.now());
    window.addEventListener("beforeprint", refresh);
    return () => window.removeEventListener("beforeprint", refresh);
  }, [ds]);

  const url = `${window.location.origin}/public`;
  const svg = useMemo(() => qrSvg(url), [url]);

  return (
    <div className="poster-page">
      <div className="poster-controls">
        <h1>掲示用の貼り紙</h1>
        <p>A4 の紙に印刷して、農場の入口に貼ります。連絡先は、印刷した紙に手で書き込んでください。</p>
        <p>
          QR コードは、このサイトの <Link to="/public">鶏を飼っていない方へ</Link> のページにつながります。
        </p>
        <Button variant="primary" onClick={() => window.print()}>
          印刷する
        </Button>
      </div>

      <article className="poster-sheet" data-testid="poster-sheet" aria-label="貼り紙の見本">
        <h2 className="poster-heading" data-testid="poster-heading">
          <R base="防疫" rt="ぼうえき" />
          のため
          <br />
          <R base="立入" rt="たちいり" />
          <R base="禁止" rt="きんし" />
        </h2>
        <p className="poster-sub">
          <R base="許可" rt="きょか" />
          のない方は入れません
        </p>

        <div className="poster-body">
          <Line>
            鶏の<R base="病気" rt="びょうき" />
            を人や車が運ぶのを
          </Line>
          <Line>
            <R base="防" rt="ふせ" />
            ぐため、
            <R base="立入" rt="たちいり" />
            をお断りしています。
          </Line>
          <Line>
            <R base="見学" rt="けんがく" />
            や写真も、ご
            <R base="遠慮" rt="えんりょ" />
            ください。
          </Line>
          <Line>用のある方は、入る前に、</Line>
          <Line>
            ここに
            <R base="連絡" rt="れんらく" />
            してください。
          </Line>
        </div>

        <div className="poster-contact" data-testid="poster-contact">
          <span className="poster-contact-label">
            <R base="連絡先" rt="れんらくさき" />
          </span>
          <span className="poster-contact-blank" aria-hidden="true" />
        </div>

        <div className="poster-qr-row">
          {/* svg は qrcode-generator が URL から作る図形だけ（利用者や外部の入力の HTML は入らない） */}
          <div className="poster-qr" data-testid="poster-qr" data-url={url} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="poster-qr-caption">
            <p>鶏を飼っていない方へ</p>
            <p>くわしい説明は、こちら</p>
          </div>
        </div>

        <p className="poster-date">
          印刷日 {printDate(now)}
        </p>
      </article>
    </div>
  );
}
