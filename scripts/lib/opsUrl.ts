// opsAdmin と probeEntrances へ Bearer を付けて送る URL の検査（S-11）。Bearer を平文で出さないため、https だけ許す。
// ローカルの模擬環境の http://localhost と http://127.0.0.1 だけ例外。Bearer を付けて送る経路は、すべてこの検査を通す。

export function isAllowedOpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** 断るときの文。値は出さない（URL に何が入っているか分からない）。 */
export const urlRefused = (name: string): string =>
  `${name} は https:// で始まる URL にしてください（模擬環境は http://localhost か http://127.0.0.1 だけ許します）`;
