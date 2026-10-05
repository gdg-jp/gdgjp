import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.CI ? 6182 : 5182;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // These fixture-rendering tests need only Vite modules, not a working Accounts session.
  webServer: {
    command: process.env.CI ? `node ../scripts/run-e2e-dev.mjs ${PORT}` : "pnpm dev",
    url: `${BASE_URL}/e2e/ui-harness.tsx`,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
