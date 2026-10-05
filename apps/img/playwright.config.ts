import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6175 : 5175;
const BASE_URL = `http://localhost:${PORT}`;
const ACCOUNTS_PORT = process.env.CI ? 6173 : 5173;
const ACCOUNTS_URL = `http://localhost:${ACCOUNTS_PORT}`;
const HEALTH_URL = `${BASE_URL}/api/auth/me`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: process.env.CI
        ? `cd ../accounts && node ../../scripts/run-e2e-dev.mjs ${ACCOUNTS_PORT}`
        : "pnpm --dir ../accounts dev",
      url: ACCOUNTS_URL,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: process.env.CI ? `node ../../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
      // Warm the Cloudflare dev proxy before parallel tests hit it. Static
      // assets bypass its lazy initialization and allow duplicate local runtimes.
      // Anonymous session inspection needs neither an Accounts client nor D1.
      url: HEALTH_URL,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
