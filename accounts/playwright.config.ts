import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6173 : 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Both specs share one dev server and its Vite dependency optimizer cache.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? `node ../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    url: BASE_URL,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
