// 配信停止リンクの署名（M-02）。鍵は Secret（UNSUBSCRIBE_SECRET）。呼ぶ側が handler の中で .value() で読んで渡す。
// 署名は (farmId, uid) の組に対する HMAC-SHA256 の base64url。組の区切りが曖昧にならないよう JSON 配列にして署名する。
import { createHmac, timingSafeEqual } from "node:crypto";

function mac(farmId: string, uid: string, key: string): string {
  if (typeof key !== "string" || key === "") throw new Error("配信停止の鍵が空です");
  return createHmac("sha256", key).update(JSON.stringify(["unsubscribe", farmId, uid])).digest("base64url");
}

export function signUnsubscribe(farmId: string, uid: string, secret: string): string {
  return mac(farmId, uid, secret);
}

/** 署名が合うか。壊れた入力や長さの違いでも例外にせず false（一定時間で比べる）。 */
export function verifyUnsubscribe(farmId: string, uid: string, sig: string, secret: string): boolean {
  if (typeof sig !== "string" || typeof farmId !== "string" || typeof uid !== "string") return false;
  try {
    const expected = Buffer.from(mac(farmId, uid, secret), "utf8");
    const given = Buffer.from(sig, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
