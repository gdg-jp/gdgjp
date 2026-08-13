import { defineConfig, devices } from "@playwright/test";

const PORT = 5179;
const BASE_URL = `http://localhost:${PORT}`;
const IDP_PORT = Number(process.env.CONNPASS_E2E_IDP_PORT ?? 5181);
const IDP_URL = `http://127.0.0.1:${IDP_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { accept: "application/json" },
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ./e2e/mock-idp.mjs",
      url: `${IDP_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: "pnpm exec wrangler d1 migrations apply gdgjp-connpass-db --local && pnpm dev",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        CONNPASS_E2E_ACCOUNTS_URL: IDP_URL,
      },
    },
  ],
});
