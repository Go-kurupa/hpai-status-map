import { setGlobalOptions } from "firebase-functions/v2/options";

// 第 2 世代の既定。関数ごとのタイムアウト、メモリ、Secret は所有のタスクが書く。
setGlobalOptions({ region: "asia-northeast1", maxInstances: 5 });
