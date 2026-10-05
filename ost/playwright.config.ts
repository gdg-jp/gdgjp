import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6185 : 5185;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? `node ../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    // Wait on the TCP port, not an HTTP 200 — every route either redirects to
    // sign-in or 404s without a seeded event.
    port: PORT,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: !process.env.CI,
    // Cold `@cloudflare/vite-plugin` + dep optimization can exceed 2 min.
    timeout: 240_000,
  },
});
