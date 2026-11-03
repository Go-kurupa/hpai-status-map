import { defineSecret, defineString } from "firebase-functions/params";

// Secret（Secret Manager）。値は handler の中で .value() で読む。表示しない。
// deploy は全 param を解決するので、最初の deploy の前に全部を入れる。本番に仮の値を入れない。
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
export const UNSUBSCRIBE_SECRET = defineSecret("UNSUBSCRIBE_SECRET");
export const OPS_TOKEN = defineSecret("OPS_TOKEN");
export const INTERNAL_MCP_TOKEN = defineSecret("INTERNAL_MCP_TOKEN");

// 設定（functions/.env.<project>）。
export const GMAIL_USER = defineString("GMAIL_USER");
export const OPERATOR_EMAIL = defineString("OPERATOR_EMAIL");
export const APP_URL = defineString("APP_URL");
// 後の 2 つは最初は空でよい。
export const AGENT_DEPLOYMENT_ID = defineString("AGENT_DEPLOYMENT_ID", { default: "" });
export const AGENT_EVAL_HIDE_PREFS = defineString("AGENT_EVAL_HIDE_PREFS", { default: "" });
