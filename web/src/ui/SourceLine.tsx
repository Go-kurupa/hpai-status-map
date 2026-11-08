import type { IsoDate } from "@hpai/shared/types";

export function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

/** 出典の 1 行。http(s) 以外の URL はリンクにしない */
export function SourceLine({ title, url, checkedOn }: { title: string; url: string; checkedOn?: IsoDate }) {
  return (
    <p className="source-line">
      出典:{" "}
      {isWebUrl(url) ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}
      {checkedOn ? `（確認日 ${checkedOn}）` : null}
    </p>
  );
}
