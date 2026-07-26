import { defineConfig, devices } from "@playwright/test";

const PORT = 5175;
const BASE_URL = `http://localhost:${PORT}`;
const ACCOUNTS_URL = "http://localhost:5173";
const HEALTH_URL = `${BASE_URL}/app-icon.png`;

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
      command: "pnpm --dir ../accounts dev",
      url: ACCOUNTS_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      // The app root redirects into the OIDC flow. Probe a static asset so
      // readiness does not require an initialized Accounts database or client.
      url: HEALTH_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
