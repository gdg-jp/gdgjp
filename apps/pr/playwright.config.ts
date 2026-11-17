import { defineConfig, devices } from "@playwright/test";

const isolated = Boolean(process.env.PR_E2E_PERSIST_TO);
if (process.env.CI && !isolated) {
  throw new Error("Run PR E2E through pnpm test:e2e to isolate persistence");
}
const PORT = isolated || process.env.CI ? 6191 : 5191;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  timeout: 45_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    locale: "ja-JP",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: isolated ? `node ../../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    port: PORT,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: !isolated && !process.env.CI,
    timeout: 240_000,
  },
});
