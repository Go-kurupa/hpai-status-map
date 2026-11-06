// 本番を出し直すと、部品のファイル名（assets/ExplorePage-xxxx.js など）が替わる。出し直す前から開いていた画面が古いファイルを読みに行くと、
// 読み込みに失敗して「表示中に問題が起きました」になる（11/7 作者が「条件で見る」で出会った）。そのときは画面を 1 回だけ読み込み直す。
// 直後にもう一度失敗したら繰り返さない（止まらない読み込み直しにしない）。読み込み直した時刻は、このタブの中（sessionStorage）にだけ置く

const KEY = "hpai.stale-chunk-reload.v1";
/** この間に 2 回目の失敗が起きたら、読み込み直さない */
const GUARD_MS = 60_000;

/** 動的な読み込み（React.lazy の import()）の失敗か。ブラウザごとの文の違いを見分ける */
export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
}

interface Deps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: number;
}

/** 読み込み直したら true。直前に読み込み直していたら何もせず false */
export function reloadOnceForStaleChunk({ storage, reload, now }: Deps): boolean {
  // 記録がなければ、前回の読み込み直しはないものとして扱う
  let last = Number.NEGATIVE_INFINITY;
  try {
    const saved = storage.getItem(KEY);
    if (saved !== null && Number.isFinite(Number(saved))) last = Number(saved);
  } catch {
    // 保存できない端末でも読み込み直しはする（繰り返しの止めは効かないが、ふつうは 1 回で直る）
  }
  if (now - last < GUARD_MS) return false;
  try {
    storage.setItem(KEY, String(now));
  } catch {
    // 同上
  }
  reload();
  return true;
}

/** 画面の入口で 1 度だけ呼ぶ。Vite が動的な読み込みの失敗を知らせる vite:preloadError で読み込み直す */
export function installStaleChunkReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    const reloaded = reloadOnceForStaleChunk({ storage: window.sessionStorage, reload: () => window.location.reload(), now: Date.now() });
    // 読み込み直すときは、例外の画面を出さない
    if (reloaded) event.preventDefault();
  });
}
