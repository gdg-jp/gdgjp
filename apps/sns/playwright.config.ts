import { defineConfig, devices } from "@playwright/test";

const port = process.env.CI ? 6178 : 5178;
const accountsPort = process.env.CI ? 6173 : 5173;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: process.env.CI
        ? `cd ../accounts && node ../../scripts/run-e2e-dev.mjs ${accountsPort}`
        : "pnpm --dir ../accounts dev",
      url: `http://localhost:${accountsPort}`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 120_000,
    },
    {
      command: process.env.CI ? `node ../../scripts/run-e2e-dev.mjs ${port}` : "pnpm dev",
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 120_000,
    },
  ],
});
