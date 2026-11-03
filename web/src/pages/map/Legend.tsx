import { TEXT } from "./texts";

/** 地図の見方。疑いは斜線、確定は単色、野鳥は別の印、確認できていない県は斜線の灰色 */
export function Legend({ isCurrent }: { isCurrent: boolean }) {
  const past = isCurrent ? "" : " is-past";
  return (
    <ul className="map-legend" aria-label={TEXT.legendAria}>
      <li>
        <span className={`swatch swatch-hatch${past}`} aria-hidden="true" />
        疑い
      </li>
      <li>
        <span className={`swatch swatch-solid${past}`} aria-hidden="true" />
        確定
      </li>
      <li>
        <span className="swatch swatch-ring" aria-hidden="true" />
        野鳥の検査中
      </li>
      <li>
        <span className="swatch swatch-square" aria-hidden="true" />
        野鳥の確定
      </li>
      <li>
        <span className="swatch swatch-unwatched" aria-hidden="true" />
        確認できていない県
      </li>
    </ul>
  );
}
