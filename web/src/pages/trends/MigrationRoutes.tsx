// /trends の「渡りの経路（環境省の図）」の枠。静的な部品で、通信も読み込みの状態もない。
// 図は環境省のページの図 1〜5 を改変せずに自前で配信する（環境省のサーバーから直接読み込まない）。
// 過去の追跡をまとめた図で、今の位置でも、農場の危険度でもない。この断りを図ごとの説明にも入れる。
// 個別の追跡の図は「無断転用不可」なので載せず、リンクで案内する。
import "./migration.css";

const SOURCE_TITLE = "環境省「渡り鳥の飛来経路について」";
const SOURCE_URL = "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/ap_wr_transit/wataridori_hiraikeiro.html";
const TRACKING_TITLE = "環境省「ハクチョウ・カモ類の飛来経路及び移動状況について」";
const TRACKING_URL = "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/migration_route.html";
const NOT_CURRENT = "過去の追跡をまとめた図で、今飛んでいる位置ではありません。";

export interface RouteFigure {
  file: string;
  species: string;
  /** 環境省のページの図の名前（原文） */
  name: string;
  /** 環境省のページの注記（原文。全角の数字もそのまま） */
  autumnNote: string;
  width: number;
  height: number;
}

export const ROUTE_FIGURES: readonly RouteFigure[] = [
  { file: "zu1.jpg", species: "オナガガモ", name: "図1．オナガガモの飛来経路", autumnNote: "秋の渡り開始9～10月頃", width: 852, height: 832 },
  { file: "zu2.jpg", species: "マガモ", name: "図2．マガモの飛来経路", autumnNote: "秋の渡り開始8月下旬～10月頃", width: 950, height: 983 },
  { file: "zu3.jpg", species: "ヒドリガモ", name: "図3．ヒドリガモの飛来経路", autumnNote: "秋の渡り開始9月～10月頃", width: 948, height: 983 },
  { file: "zu4.jpg", species: "オオハクチョウ", name: "図4．オオハクチョウの飛来経路", autumnNote: "秋の渡り開始9月下旬～10月頃", width: 948, height: 983 },
  { file: "zu5.png", species: "ユリカモメ", name: "図5．ユリカモメの飛来経路", autumnNote: "秋の渡り開始８月～10月頃", width: 835, height: 879 },
];

function Figure({ f }: { f: RouteFigure }) {
  const src = `${import.meta.env.BASE_URL}migration/routes/${f.file}`;
  return (
    <figure className="migration-route">
      <img
        src={src}
        alt={`${f.species}の渡りの経路を東アジアの地図に描いた環境省の図。紫の矢印が春の渡り、赤の矢印が秋の渡り、黄緑の楕円が主な中継地と滞在地で、楕円の横に時期が書いてあります。`}
        width={f.width}
        height={f.height}
        loading="lazy"
      />
      <figcaption>
        <p>
          <strong>{f.name}</strong>
        </p>
        <p>{f.autumnNote}</p>
        <p>{NOT_CURRENT}</p>
        <p>
          出典:{" "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {SOURCE_TITLE}
          </a>
        </p>
        <p>
          <a className="tap-link" href={src} target="_blank" rel="noopener noreferrer">
            {f.species}の図を原寸で開く（別のタブ）
          </a>
        </p>
      </figcaption>
    </figure>
  );
}

export default function MigrationRoutes() {
  return (
    <section className="migration-routes" aria-labelledby="migration-routes-title">
      <h2 id="migration-routes-title">渡りの経路（環境省の図）</h2>
      <p>環境省が公開している渡りの経路の図 5 枚を、改変せずに載せています。</p>
      <ul className="migration-notes">
        <li>{NOT_CURRENT}</li>
        <li>追跡できた個体の数は限られます。</li>
        <li>農場の危険度や、これから飛ぶ経路を示すものではありません。</li>
      </ul>

      {ROUTE_FIGURES.map((f) => (
        <Figure key={f.file} f={f} />
      ))}

      <h3 className="migration-sub">出典</h3>
      <p>
        出典:{" "}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {SOURCE_TITLE}
        </a>
        （{SOURCE_URL}）。
      </p>
      <p>
        個体ごとの追跡の図は、ここには載せていません。環境省のページで見られます:{" "}
        <a href={TRACKING_URL} target="_blank" rel="noopener noreferrer">
          {TRACKING_TITLE}
        </a>
        （{TRACKING_URL}）。
      </p>
    </section>
  );
}
