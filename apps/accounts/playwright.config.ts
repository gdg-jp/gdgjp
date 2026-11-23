import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6173 : 5173;
const BASE_URL = `http://localhost:${PORT}`;
const RP_PORT = process.env.CI ? 6174 : 5174;
const RP_URL = `http://localhost:${RP_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: process.env.CI
        ? `cd ../tinyurl && node ../../scripts/run-e2e-dev.mjs ${RP_PORT}`
        : "pnpm --dir ../tinyurl dev",
      url: `${RP_URL}/api/auth/me`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: process.env.CI ? `node ../../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
      url: BASE_URL,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
