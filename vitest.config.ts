import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 対象を指定した実行は --passWithNoTests=false を付ける（取り決め 1.4）
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: "shared", include: ["shared/test/**/*.test.ts"] } },
      { test: { name: "functions", include: ["functions/test/*.test.ts"] } },
      {
        test: {
          name: "functions-emul",
          include: ["functions/test/emul/*.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      { test: { name: "scripts", include: ["scripts/test/**/*.test.ts"] } },
      {
        test: {
          name: "rules",
          include: ["firestore-tests/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
