import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * `Authorization: Bearer <値>` が expected と一致するか。opsAdmin と mcpInternal が使う（契約 3.7）。
 * 両方を sha256 にしてから定数時間で比べるので、長さが違っても例外にならず、長さも漏れない。
 * expected が空のときは、空の Bearer とも一致させない。
 */
export function checkBearer(header: string | undefined, expected: string): boolean {
  if (typeof header !== "string" || expected === "") return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const given = header.slice(prefix.length);
  if (given === "") return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}
