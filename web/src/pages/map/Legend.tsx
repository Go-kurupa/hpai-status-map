import { useId } from "react";
import { BIRD_BOX, BIRD_POINTS, BIRD_R } from "./birdIcon";
import { TEXT } from "./texts";

/** 野鳥の印の見本（地図と同じ鳥の形） */
export function BirdSwatch({ confirmed }: { confirmed: boolean }) {
  const c = BIRD_BOX / 2;
  return (
    <svg className={confirmed ? "swatch-bird is-confirmed" : "swatch-bird"} width="24" height="24" viewBox={`0 0 ${BIRD_BOX} ${BIRD_BOX}`} aria-hidden="true">
      <circle cx={c} cy={c} r={confirmed ? BIRD_R : BIRD_R - 0.9} className="swatch-bird-disc" />
      <polygon points={BIRD_POINTS} className="swatch-bird-shape" />
    </svg>
  );
}

/**
 * 地図の見方（2026-11-07 作者の決定 ア）。養鶏場などの発生・野鳥・そのほかの 3 段に分け、赤は養鶏場の発生、墨の鳥は野鳥と読めるようにする。
 * 疑いは斜線、確定は単色、全国の広さでは県ごとの件数の札。確認できていない県は灰色の斜線。鶏舎の場所を決めていれば、その印も
 */
export function Legend({ isCurrent, hasFarm = false }: { isCurrent: boolean; hasFarm?: boolean }) {
  const past = isCurrent ? "" : " is-past";
  const id = useId();
  return (
    <div className="map-legend" role="group" aria-label={TEXT.legendAria}>
      <div className="map-legend-group">
        <p className="map-legend-h" aria-hidden="true" id={`${id}-farm`}>
          {TEXT.legendGroupFarm}
        </p>
        <ul aria-labelledby={`${id}-farm`}>
          <li>
            <span className={`swatch swatch-hatch${past}`} aria-hidden="true" />
            疑い
          </li>
          <li>
            <span className={`swatch swatch-solid${past}`} aria-hidden="true" />
            確定
          </li>
          <li>
            <span className={`swatch-badge${past}`} aria-hidden="true">
              3
            </span>
            {TEXT.legendPrefCount}
          </li>
        </ul>
      </div>
      <div className="map-legend-group">
        <p className="map-legend-h" aria-hidden="true" id={`${id}-bird`}>
          {TEXT.legendGroupBird}
        </p>
        <ul aria-labelledby={`${id}-bird`}>
          <li>
            <BirdSwatch confirmed={false} />
            検査中
          </li>
          <li>
            <BirdSwatch confirmed />
            高病原性の確定
          </li>
        </ul>
      </div>
      <div className="map-legend-group">
        <p className="map-legend-h" aria-hidden="true" id={`${id}-other`}>
          {TEXT.legendGroupOther}
        </p>
        <ul aria-labelledby={`${id}-other`}>
          <li>
            <span className="swatch swatch-unwatched" aria-hidden="true" />
            確認できていない県
          </li>
          {hasFarm ? (
            <li>
              <span className="swatch swatch-farm" aria-hidden="true" />
              {TEXT.legendFarm}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
