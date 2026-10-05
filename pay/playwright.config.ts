import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5180", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // These fixture-rendering tests need only Vite modules, not a working Accounts session.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5180/e2e/ui-harness.tsx",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
