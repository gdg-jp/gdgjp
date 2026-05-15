import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5177",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5177",
    reuseExistingServer: !process.env.CI,
    // The wiki dev server (vite + cloudflare plugin + workerd) cold-starts
    // slower than playwright's default 60s when CI is also pulling deps;
    // give it more headroom rather than masking timeouts as test failures.
    timeout: 180_000,
  },
});
