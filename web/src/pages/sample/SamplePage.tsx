// /sample: 近くで発生した場合の見え方（審査員用の 2 本目の URL。2026-11-08 作者の決定）。
// 去年 12 月の 4 事例の再現を、見本の農場の鶏舎の場所（仮の地点）で見る。開いたときは 12月19日 津山市 疑い
// （距離の輪の中に入り、このときメールが届く）。時刻の操作と地図は、去年の再現の画面と同じ部品を使う。
import MapPage from "../map/MapPage";
import { ReplayControls } from "../replay/ReplayControls";
import { useSampleEnv } from "./SampleFrame";
import { SAMPLE_TEXT } from "./sampleTexts";

export default function SamplePage() {
  const { scenario, dataSource, spot } = useSampleEnv();
  return (
    // 操作の後ろの部分は、replay.css が地図の下へ動かす（去年の再現の画面と同じ並び）
    <div className="replay-stage">
      <ReplayControls scenario={scenario} dataSource={dataSource} spot={spot} heading={SAMPLE_TEXT.heading} />
      {/* 最初は選択地域付近（見本の農場のまわりの距離の輪が見える広さ）。去年の再現の画面の 4 事例は全国の広さのまま */}
      <MapPage nearFirst />
    </div>
  );
}
