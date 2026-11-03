import { defineConfig, devices } from "@playwright/test";

// 画面の試験は本番と同じ build（mode=e2e の dist-e2e）を vite preview で配る。
// 実行: web/ で `browser-guard run -- npx playwright test`
const PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      "npx tsx ../scripts/copy-web-data.ts",
      "npx vite build --mode e2e --outDir dist-e2e",
      `npx vite preview --outDir dist-e2e --host 0.0.0.0 --port ${PORT} --strictPort`,
    ].join(" && "),
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
